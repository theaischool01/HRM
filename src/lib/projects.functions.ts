import { createServerFn } from "@tanstack/react-start";
import { isProjectShift, isTaskUnit, type ProjectShiftValue } from "@/lib/enums";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasPermission, requirePermission } from "./actor.server";
import { writeAudit } from "./audit.server";
import { loadProfileNames } from "./profile-names.server";
import {
  evalCanManageProjectSafe,
  isMissingSchemaResourceError,
  resolveSupervisorScope,
  selectDepartmentManagersSafe,
  selectProjectsSafe,
} from "./schema-compat.server";
import {
  evaluateAnnotationAssignable,
  excludeProtectedAccounts,
  isWorkType,
  projectUsesProductionTargets,
  type WorkType,
} from "./work-type";
import {
  loadProfileWorkTypes,
  loadProjectWorkTypes,
  loadProtectedAccountIds,
} from "./work-type.server";

export type ProjectDraft = {
  code: string;
  name: string;
  clientName?: string | null;
  description?: string | null;
  departmentId?: string | null;
  projectManagerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  projectLeadId?: string | null;
  teamLeadIds?: string[];
  workMode?: string;
  shift?: string | null;
  taskUnit?: string;
  hourlyTaskTarget?: number | null;
  dailyTaskTarget?: number | null;
  qualityTargetPct?: number | null;
  maxRejectionRatePct?: number | null;
  requiredHeadcount?: number;
  status?: string;
  /** Work classification; required on create. */
  workType?: string;
};

async function requireProjectManage(
  supabase: Parameters<typeof requirePermission>[0],
  userId: string,
  projectId: string,
) {
  if (await hasPermission(supabase, userId, "projects:manage:all")) return;

  await requirePermission(supabase, userId, "projects:manage:team");
  const canScoped = await evalCanManageProjectSafe(supabase, projectId, userId);
  if (!canScoped) {
    throw new Error("Forbidden: you can only edit projects assigned to you or your managed departments.");
  }
}

type Client = Parameters<typeof requirePermission>[0];

/**
 * Persists projects.work_type. Schema-tolerant: before the migration the column
 * does not exist and the classification is skipped (projects stay unclassified,
 * which keeps hourly annotation logging closed — fail safe).
 */
async function persistProjectWorkType(
  supabase: Client,
  projectId: string,
  workType: WorkType,
): Promise<{ saved: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loose = supabase as unknown as import("@supabase/supabase-js").SupabaseClient<any>;
  let { error } = await loose.from("projects").update({ work_type: workType }).eq("id", projectId);
  if (error?.code === "42501") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient<any>;
    ({ error } = await admin.from("projects").update({ work_type: workType }).eq("id", projectId));
  }
  if (error) {
    if (isMissingSchemaResourceError(error)) return { saved: false };
    throw new Error(error.message || "Failed to classify the project.");
  }
  return { saved: true };
}

/** Blocks classifying a project as Annotation while non-annotation people are allocated. */
async function assertAllocationsFitAnnotation(supabase: Client, projectId: string) {
  const { data: allocs } = await supabase
    .from("project_allocations")
    .select("user_id")
    .eq("project_id", projectId)
    .neq("status", "ended");
  const userIds = [...new Set((allocs ?? []).map((a) => a.user_id))];
  if (userIds.length === 0) return;
  const [{ data: profiles }, { data: roles }, types] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, account_status, employment_status, category")
      .in("id", userIds),
    supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
    loadProfileWorkTypes(supabase, userIds),
  ]);
  const blocked = (profiles ?? []).filter(
    (p) =>
      !evaluateAnnotationAssignable({
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
        workType: types.map.get(p.id) ?? null,
        accountStatus: p.account_status,
        employmentStatus: p.employment_status,
        category: p.category,
      }).eligible,
  );
  if (blocked.length > 0) {
    throw new Error(
      `This project has allocations for people who are not annotation employees (${blocked
        .map((p) => p.full_name)
        .join(", ")}). End or reassign them before classifying it as Annotation.`,
    );
  }
}

function withoutProductionTargets<T extends Record<string, unknown>>(row: T, workType: WorkType): T {
  if (projectUsesProductionTargets(workType)) return row;
  return {
    ...row,
    hourly_task_target: null,
    daily_task_target: null,
    quality_target_pct: null,
    max_rejection_rate_pct: null,
  };
}

/** RLS + server scope decides the row set: read:all sees every project, Manager sees
 *  assigned department/project scope, a lead sees the ones they lead, an employee sees allocated projects. */
export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadActor } = await import("./actor.server");
    const actor = await loadActor(context.supabase, context.userId);
    const [projRes, { data: allocations }, scope] = await Promise.all([
      selectProjectsSafe(context.supabase),
      context.supabase
        .from("project_allocations")
        .select("id, project_id, user_id, status, allocation_pct, acknowledged_at"),
      actor.permissions.includes("projects:read:all")
        ? Promise.resolve(null)
        : resolveSupervisorScope(context.supabase, context.userId, actor.roles),
    ]);

    const visibleProjects = scope
      ? projRes.rows.filter((p) => scope.scopedProjectIds.has(p.id))
      : projRes.rows;
    const projectTypes = await loadProjectWorkTypes(
      context.supabase,
      visibleProjects.map((p) => p.id),
    );

    return visibleProjects.map((project) => {
      const rows = (allocations ?? []).filter(
        (a) => a.project_id === project.id && a.status !== "ended",
      );
      return {
        ...project,
        work_type: projectTypes.map.get(project.id) ?? null,
        allocated_count: rows.length,
        pending_ack_count: rows.filter((r) => r.acknowledged_at === null).length,
      };
    });
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A project id is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { loadActor } = await import("./actor.server");
    const actor = await loadActor(context.supabase, context.userId);
    const projRes = await selectProjectsSafe(context.supabase, data.id);
    const project = projRes.rows[0] ?? null;
    if (!project) throw new Error("This project is not visible to you.");

    if (!actor.permissions.includes("projects:read:all")) {
      const scope = await resolveSupervisorScope(context.supabase, context.userId, actor.roles);
      if (!scope.scopedProjectIds.has(project.id)) {
        throw new Error("This project is not visible to you.");
      }
    }

    const [{ data: leads }, { data: allocations }, { data: peopleAll }, protectedIds, projectTypes] =
      await Promise.all([
        context.supabase.from("project_team_leads").select("id, lead_id").eq("project_id", data.id),
        context.supabase
          .from("project_allocations")
          .select(
            "id, user_id, reporting_lead_id, role_in_project, start_date, end_date, hours_per_day, allocation_pct, daily_task_target, quality_target_pct, max_rejection_rate_pct, status, acknowledged_at, acknowledgment_note, over_allocation_override, created_at",
          )
          .eq("project_id", data.id)
          .order("created_at"),
        context.supabase.from("profiles").select("id, full_name, work_email, designation"),
        loadProtectedAccountIds(context.supabase),
        loadProjectWorkTypes(context.supabase, [data.id]),
      ]);
    const people = excludeProtectedAccounts(peopleAll ?? [], protectedIds);

    // The profiles read above is RLS-scoped, so a viewer may be missing rows for
    // people on this project. profile_names() fills in name + designation so the
    // roster never renders blank; work_email stays RLS-scoped on purpose.
    const fallback = await loadProfileNames(context.supabase, [
      project.project_lead_id,
      project.project_manager_id,
      ...(leads ?? []).map((l) => l.lead_id),
      ...(allocations ?? []).flatMap((a) => [a.user_id, a.reporting_lead_id]),
    ]);

    const direct = new Map((people ?? []).map((p) => [p.id, p]));
    const personOf = (id: string | null | undefined) => {
      if (!id) return null;
      if (protectedIds.has(id)) {
        return { id, full_name: "System Administrator", work_email: "", designation: null };
      }
      const row = direct.get(id);
      if (row?.full_name) return row;
      const named = fallback.get(id);
      if (!named) return row ?? null;
      return {
        id,
        full_name: named.fullName,
        work_email: row?.work_email ?? "",
        designation: named.designation,
      };
    };

    return {
      project: { ...project, work_type: projectTypes.map.get(project.id) ?? null },
      workTypeSchemaReady: projectTypes.schemaReady,
      projectLead: personOf(project.project_lead_id),
      projectManager: personOf(project.project_manager_id),
      teamLeads: (leads ?? []).map((l) => ({
        rowId: l.id,
        ...(personOf(l.lead_id) ?? {
          id: l.lead_id,
          full_name: "Unknown",
          work_email: "",
          designation: null,
        }),
      })),
      allocations: (allocations ?? []).map((a) => ({
        ...a,
        person: personOf(a.user_id),
        reportingLead: personOf(a.reporting_lead_id),
      })),
    };
  });


export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: ProjectDraft) => {
    if (!input?.code?.trim()) throw new Error("A project code is required.");
    if (!input?.name?.trim()) throw new Error("A project name is required.");
    if (!isWorkType(input.workType)) {
      throw new Error(
        "Choose the project work type (Annotation, Engineering, Operations, HR, Training or Other).",
      );
    }
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new Error("The end date cannot be before the start date.");
    }
    if (input.hourlyTaskTarget != null && Number(input.hourlyTaskTarget) < 0) {
      throw new Error("Hourly task target cannot be negative.");
    }
    if (input.dailyTaskTarget != null && Number(input.dailyTaskTarget) < 0) {
      throw new Error("Daily task target cannot be negative.");
    }
    if (input.qualityTargetPct != null) {
      const q = Number(input.qualityTargetPct);
      if (isNaN(q) || q < 0 || q > 100) throw new Error("Quality target must be between 0% and 100%.");
    }
    if (input.maxRejectionRatePct != null) {
      const r = Number(input.maxRejectionRatePct);
      if (isNaN(r) || r < 0 || r > 100) throw new Error("Maximum rejection rate must be between 0% and 100%.");
    }
    if (input.requiredHeadcount != null && Number(input.requiredHeadcount) < 0) {
      throw new Error("Required headcount cannot be negative.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { loadActor } = await import("./actor.server");
    const actor = await loadActor(context.supabase, context.userId);

    // 1. Account status and onboarding verification check
    if (actor.accountStatus === "profile_pending" || actor.accountStatus === "under_verification") {
      throw new Error("Complete the required account verification before creating projects.");
    }
    if (actor.accountStatus !== "active") {
      throw new Error("Your account is not active.");
    }

    // 2. Permission and Manager scoping checks
    const canAll = actor.permissions.includes("projects:manage:all");
    const canTeam = actor.permissions.includes("projects:manage:team");

    if (!canAll && !canTeam) {
      throw new Error("Forbidden: missing permission to manage projects.");
    }

    let effectiveManagerId = data.projectManagerId || null;

    if (effectiveManagerId) {
      // Validate that the assigned Project Manager has an authorized managerial/administrative role
      const { data: mgrRoleRows } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", effectiveManagerId);
      const mgrRoles = (mgrRoleRows ?? []).map((r) => r.role);
      const isEligibleMgr = mgrRoles.some(
        (r) => r === "manager" || r === "admin" || r === "super_admin",
      );
      if (!isEligibleMgr) {
        throw new Error("The selected Project Manager is not eligible.");
      }
    } else if (!canAll) {
      // For managers creating a project, default the responsible manager to themselves if not specified
      effectiveManagerId = context.userId;
    }

    // 3. Project Lead eligibility validation
    if (data.projectLeadId) {
      const { data: leadRoleRows } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.projectLeadId);
      const leadRoles = (leadRoleRows ?? []).map((r) => r.role);
      const isEligibleLead = leadRoles.some(
        (r) => r === "lead" || r === "manager" || r === "admin" || r === "super_admin",
      );
      if (!isEligibleLead) {
        throw new Error("The selected Project Lead is not eligible for this project.");
      }
    }

    // 4. Check for duplicate project code upfront
    const cleanCode = data.code.trim().toUpperCase();
    const { data: existingCode } = await context.supabase
      .from("projects")
      .select("id")
      .eq("code", cleanCode)
      .maybeSingle();
    if (existingCode) {
      throw new Error("This project code already exists.");
    }

    const workType = data.workType as WorkType;
    const baseInsert = withoutProductionTargets(
      {
        code: cleanCode,
        name: data.name.trim(),
        client_name: data.clientName?.trim() || null,
        description: data.description?.trim() || null,
        start_date: data.startDate || null,
        end_date: data.endDate || null,
        project_lead_id: data.projectLeadId || null,
        work_mode: (data.workMode ?? "remote") as "onsite" | "remote" | "hybrid",
        shift: isProjectShift(data.shift?.trim()) ? (data.shift!.trim() as ProjectShiftValue) : null,
        task_unit: isTaskUnit(data.taskUnit?.trim()) ? data.taskUnit!.trim() : "task",
        hourly_task_target: data.hourlyTaskTarget ?? null,
        daily_task_target: data.dailyTaskTarget ?? null,
        quality_target_pct: data.qualityTargetPct ?? null,
        max_rejection_rate_pct: data.maxRejectionRatePct ?? null,
        required_headcount: data.requiredHeadcount ?? 0,
        status: (data.status ?? "active") as "draft" | "active" | "on_hold" | "completed" | "archived",
        created_by: context.userId,
      },
      workType,
    );

    let { data: created, error } = await context.supabase
      .from("projects")
      .insert({
        ...baseInsert,
        department_id: data.departmentId || null,
        project_manager_id: effectiveManagerId,
      })
      .select("id, code, name")
      .single();

    if (error && isMissingSchemaResourceError(error)) {
      const retry = await context.supabase
        .from("projects")
        .insert(baseInsert)
        .select("id, code, name")
        .single();
      created = retry.data;
      error = retry.error;
    }

    // Fall back to server admin client if PostgreSQL RLS policy has not yet been migrated in live DB
    if (error?.code === "42501") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const adminRes = await supabaseAdmin
        .from("projects")
        .insert({
          ...baseInsert,
          department_id: data.departmentId || null,
          project_manager_id: effectiveManagerId,
        })
        .select("id, code, name")
        .single();
      created = adminRes.data;
      error = adminRes.error;
    }

    if (error || !created) {
      if (error?.code === "23505") throw new Error("This project code already exists.");
      throw new Error(error?.message ? String(error.message) : "Failed to create project.");
    }

    const classification = await persistProjectWorkType(context.supabase, created.id, workType);

    const teamLeadIds = (data.teamLeadIds ?? []).filter(Boolean);
    if (teamLeadIds.length) {
      let { error: leadError } = await context.supabase
        .from("project_team_leads")
        .insert(teamLeadIds.map((leadId) => ({ project_id: created.id, lead_id: leadId })));
      if (leadError?.code === "42501") {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const adminLeadRes = await supabaseAdmin
          .from("project_team_leads")
          .insert(teamLeadIds.map((leadId) => ({ project_id: created.id, lead_id: leadId })));
        leadError = adminLeadRes.error;
      }
      if (leadError) throw new Error(leadError.message || "Failed to assign project team leads.");
    }

    await writeAudit(context.supabase, {
      actorId: context.userId,
      action: "project.created",
      entityType: "project",
      entityId: created.id,
      detail: {
        code: created.code,
        name: created.name,
        work_type: workType,
        work_type_saved: classification.saved,
      },
    });

    return created;
  });

export const updateProjectStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; status: string }) => {
    if (!input?.id || !input?.status) throw new Error("A project and status are required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireProjectManage(context.supabase, context.userId, data.id);
    const { error } = await context.supabase
      .from("projects")
      .update({ status: data.status as "draft" | "active" | "on_hold" | "completed" | "archived" })
      .eq("id", data.id);
    if (error) throw error;
    await writeAudit(context.supabase, {
      actorId: context.userId,
      action: "project.status_changed",
      entityType: "project",
      entityId: data.id,
      detail: { status: data.status },
    });
    return { ok: true };
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id: string;
      name: string;
      clientName?: string | null;
      description?: string | null;
      departmentId?: string | null;
      projectManagerId?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      projectLeadId?: string | null;
      workMode?: string;
      shift?: string | null;
      taskUnit?: string;
      hourlyTaskTarget?: number | null;
      dailyTaskTarget?: number | null;
      qualityTargetPct?: number | null;
      maxRejectionRatePct?: number | null;
      requiredHeadcount?: number;
      status?: string;
      teamLeadIds?: string[];
      workType?: string | null;
    }) => {
      if (!input?.id) throw new Error("A project id is required.");
      if (!input?.name?.trim()) throw new Error("A project name is required.");
      if (input.startDate && input.endDate && input.endDate < input.startDate) {
        throw new Error("The end date cannot be before the start date.");
      }
      if (input.workType != null && !isWorkType(input.workType)) {
        throw new Error("Choose a valid project work type.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireProjectManage(supabase, userId, data.id);

    const currentTypes = await loadProjectWorkTypes(supabase, [data.id]);
    const previousType = currentTypes.map.get(data.id) ?? null;
    const nextType = (data.workType ?? previousType) as WorkType | null;
    if (nextType === "annotation" && previousType !== "annotation") {
      await assertAllocationsFitAnnotation(supabase, data.id);
    }

    const rawPatch = {
      name: data.name.trim(),
      client_name: data.clientName?.trim() || null,
      description: data.description?.trim() || null,
      start_date: data.startDate || null,
      end_date: data.endDate || null,
      project_lead_id: data.projectLeadId || null,
      work_mode: (data.workMode ?? "remote") as "onsite" | "remote" | "hybrid",
      shift: isProjectShift(data.shift?.trim()) ? (data.shift!.trim() as ProjectShiftValue) : null,
      task_unit: isTaskUnit(data.taskUnit?.trim()) ? data.taskUnit!.trim() : "task",
      hourly_task_target: data.hourlyTaskTarget ?? null,
      daily_task_target: data.dailyTaskTarget ?? null,
      quality_target_pct: data.qualityTargetPct ?? null,
      max_rejection_rate_pct: data.maxRejectionRatePct ?? null,
      required_headcount: data.requiredHeadcount ?? 0,
      ...(data.status
        ? { status: data.status as "draft" | "active" | "on_hold" | "completed" | "archived" }
        : {}),
    };
    // Production targets only apply to Annotation projects (unclassified keeps them).
    const basePatch = nextType ? withoutProductionTargets(rawPatch, nextType) : rawPatch;

    const patch = {
      ...basePatch,
      ...(data.departmentId !== undefined ? { department_id: data.departmentId || null } : {}),
      ...(data.projectManagerId !== undefined
        ? { project_manager_id: data.projectManagerId || null }
        : {}),
    };

    let { error } = await supabase.from("projects").update(patch).eq("id", data.id);
    if (error && isMissingSchemaResourceError(error)) {
      const retry = await supabase.from("projects").update(basePatch).eq("id", data.id);
      error = retry.error;
    }
    if (error) throw error;

    let workTypeSaved = false;
    if (data.workType && data.workType !== previousType) {
      ({ saved: workTypeSaved } = await persistProjectWorkType(
        supabase,
        data.id,
        data.workType as WorkType,
      ));
    }

    if (Array.isArray(data.teamLeadIds)) {
      await supabase.from("project_team_leads").delete().eq("project_id", data.id);
      const uniqueLeads = [...new Set(data.teamLeadIds.filter(Boolean))];
      if (uniqueLeads.length > 0) {
        const { error: leadErr } = await supabase
          .from("project_team_leads")
          .insert(uniqueLeads.map((leadId) => ({ project_id: data.id, lead_id: leadId })));
        if (leadErr) throw leadErr;
      }
    }

    await writeAudit(supabase, {
      actorId: userId,
      action: "project.updated",
      entityType: "project",
      entityId: data.id,
      detail: {
        ...patch,
        teamLeadIds: data.teamLeadIds,
        ...(workTypeSaved ? { work_type_from: previousType, work_type_to: data.workType } : {}),
      },
    });

    return { ok: true };
  });
