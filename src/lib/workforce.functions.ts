import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasPermission, loadActor, requirePermission, rethrowDbError } from "./actor.server";
import {
  canAccessEmployeeDocuments,
  canViewEmployeeSensitivePii,
  isExecutiveGovernanceOnly,
} from "./permissions";
import { loadProfileNames } from "./profile-names.server";
import { needsReportingLead } from "./request-routing";
import {
  isMissingSchemaResourceError,
  resolveSupervisorScope,
  selectDepartmentManagersSafe,
} from "./schema-compat.server";
import {
  canChangeWorkTypeFor,
  excludeProtectedAccounts,
  isWorkType,
  WORK_TYPE_LABELS,
  type WorkType,
} from "./work-type";
import {
  isProtectedAccountId,
  loadAnnotationContext,
  loadProfileWorkTypeAssignment,
  loadProfileWorkTypes,
  loadProtectedAccountIds,
} from "./work-type.server";
import { todayIso } from "./timezone";


const PROFILE_SELECT =
  "id, full_name, work_email, personal_email, mobile, category, designation, department_id, reporting_lead_id, joining_date, work_location, account_status, employment_status, employee_code, photo_url, date_of_birth, current_address, permanent_address, emergency_contact_name, emergency_contact_phone, skills, experience_years, institution, internship_start, internship_end, available_hours_per_day, profile_submitted_at, profile_verified_at, needs_assignment, created_at";

export type ProfileDraft = {
  fullName?: string;
  personalEmail?: string | null;
  mobile?: string | null;
  dateOfBirth?: string | null;
  currentAddress?: string | null;
  permanentAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  skills?: string[] | null;
  experienceYears?: number | null;
  institution?: string | null;
  internshipStart?: string | null;
  internshipEnd?: string | null;
  availableHoursPerDay?: number | null;
  photoUrl?: string | null;
};

/** Reference data used by every form in the portal. Protected accounts never appear in selectors. */
export const getOrgReference = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: departments }, { data: leads }, deptMgrRes, protectedIds, workTypes] =
      await Promise.all([
        context.supabase.from("departments").select("id, name, code, description").order("name"),
        context.supabase
          .from("profiles")
          .select("id, full_name, designation")
          .eq("employment_status", "active")
          .order("full_name"),
        selectDepartmentManagersSafe(context.supabase),
        loadProtectedAccountIds(context.supabase),
        loadProfileWorkTypes(context.supabase),
      ]);
    return {
      departments: departments ?? [],
      people: excludeProtectedAccounts(leads ?? [], protectedIds).map((p) => ({
        ...p,
        work_type: workTypes.map.get(p.id) ?? null,
      })),
      departmentManagers: deptMgrRes.rows.filter((dm) => !protectedIds.has(dm.manager_id)),
      departmentManagersReady: deptMgrRes.tableExists,
      workTypeSchemaReady: workTypes.schemaReady,
    };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", context.userId)
      .maybeSingle();
    if (error) rethrowDbError("Loading your profile failed", error);
    return data;
  });

/** Enriched self-profile bundle for the 6-section Unified Profile view (`/onboarding`). */
export const getMyUnifiedProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [
      actor,
      { data: profile, error },
      { data: departments },
      deptMgrRes,
      { data: directReports },
      { data: allocations },
    ] = await Promise.all([
      loadActor(supabase, userId),
      supabase.from("profiles").select(PROFILE_SELECT).eq("id", userId).maybeSingle(),
      supabase.from("departments").select("id, name, code"),
      selectDepartmentManagersSafe(supabase),
      supabase
        .from("profiles")
        .select("id")
        .eq("reporting_lead_id", userId)
        .eq("employment_status", "active"),
      supabase
        .from("project_allocations")
        .select(
          "id, project_id, role_in_project, start_date, end_date, hours_per_day, allocation_pct, daily_task_target, status, acknowledged_at, projects(id, code, name, work_mode, task_unit, status)",
        )
        .eq("user_id", userId)
        .neq("status", "ended")
        .order("created_at", { ascending: false }),
    ]);
    if (error) rethrowDbError("Loading your profile failed", error);
    if (!profile) throw new Error("Your profile could not be found.");

    const deptMap = new Map((departments ?? []).map((d) => [d.id, d]));
    const department = profile.department_id ? (deptMap.get(profile.department_id) ?? null) : null;
    const managedDepartments = deptMgrRes.rows
      .filter((dm) => dm.manager_id === userId)
      .map((dm) => deptMap.get(dm.department_id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));

    let reportingLead: { id: string; fullName: string; designation: string | null } | null = null;
    if (profile.reporting_lead_id) {
      const names = await loadProfileNames(supabase, [profile.reporting_lead_id]);
      const resolved = names.get(profile.reporting_lead_id);
      if (resolved) {
        reportingLead = {
          id: profile.reporting_lead_id,
          fullName: resolved.fullName,
          designation: resolved.designation ?? null,
        };
      }
    }

    return {
      profile,
      roles: actor.roles,
      department,
      reportingLead,
      managedDepartments,
      directReportsCount: (directReports ?? []).length,
      allocations: allocations ?? [],
      isExecutiveGovernance: isExecutiveGovernanceOnly(actor.roles),
      missingReportingLead: needsReportingLead({
        roles: actor.roles,
        employmentStatus: profile.employment_status,
        reportingLeadId: profile.reporting_lead_id,
      }),
    };
  });

/**
 * RLS + server supervisor scope decides the row set here — Founder/HR/Admin/SA see
 * the whole org, Manager sees assigned departments/projects/teams, Lead sees direct
 * reports plus themselves, an Employee sees only themselves.
 */
export const listWorkforce = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await loadActor(context.supabase, context.userId);
    const [{ data: rawProfiles, error }, { data: roles }, { data: departments }, scope, protectedIds, workTypes] =
      await Promise.all([
        context.supabase.from("profiles").select(PROFILE_SELECT).order("full_name"),
        context.supabase.from("user_roles").select("user_id, role"),
        context.supabase.from("departments").select("id, name, code"),
        actor.permissions.includes("workforce:read:all")
          ? Promise.resolve(null)
          : resolveSupervisorScope(context.supabase, context.userId, actor.roles),
        loadProtectedAccountIds(context.supabase),
        loadProfileWorkTypes(context.supabase),
      ]);
    if (error) throw error;

    // Protected system-owner accounts are never part of the Workforce Directory —
    // not even for a Super Admin viewer (their own record lives under My Profile).
    const scopedProfiles = scope
      ? (rawProfiles ?? []).filter((p) => scope.scopedUserIds.has(p.id))
      : (rawProfiles ?? []);
    const profiles = excludeProtectedAccounts(scopedProfiles, protectedIds);

    const deptMap = new Map((departments ?? []).map((d) => [d.id, d.name]));
    const roleMap = new Map<string, string[]>();
    for (const row of roles ?? []) {
      roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
    }
    const allowSensitivePii =
      actor.roles.includes("super_admin") || actor.roles.includes("hr");

    return profiles.map((profile) => {
      const personRoles = roleMap.get(profile.id) ?? [];
      const isSelf = profile.id === context.userId;
      return {
        ...profile,
        personal_email: allowSensitivePii || isSelf ? profile.personal_email : null,
        date_of_birth: allowSensitivePii || isSelf ? profile.date_of_birth : null,
        current_address: allowSensitivePii || isSelf ? profile.current_address : null,
        permanent_address: allowSensitivePii || isSelf ? profile.permanent_address : null,
        department_name: profile.department_id ? (deptMap.get(profile.department_id) ?? null) : null,
        work_type: workTypes.map.get(profile.id) ?? null,
        roles: personRoles,
        missingReportingLead: needsReportingLead({
          roles: personRoles,
          employmentStatus: profile.employment_status,
          reportingLeadId: profile.reporting_lead_id,
        }),
      };
    });
  });

export const getWorkforceMember = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A person id is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const actor = await loadActor(context.supabase, context.userId);
    if (
      data.id !== context.userId &&
      !actor.permissions.includes("workforce:read:all") &&
      !actor.permissions.includes("workforce:read:team")
    ) {
      throw new Error("This person is not visible to you.");
    }

    if (data.id !== context.userId && !actor.permissions.includes("workforce:read:all")) {
      const scope = await resolveSupervisorScope(context.supabase, context.userId, actor.roles);
      if (!scope.scopedUserIds.has(data.id)) {
        throw new Error("This person is outside your assigned department or team scope.");
      }
    }

    // Protected system-owner profiles are not reachable by URL / predictable ID.
    // Same generic message as "not found" so the ID cannot be probed.
    if (
      data.id !== context.userId &&
      !actor.roles.includes("super_admin") &&
      (await isProtectedAccountId(context.supabase, data.id))
    ) {
      throw new Error("This person is not visible to you.");
    }

    const [
      { data: rawProfile, error },
      { data: roles },
      { data: departments },
      deptMgrRes,
      { data: directReports },
      { data: allocations },
    ] = await Promise.all([
      context.supabase.from("profiles").select(PROFILE_SELECT).eq("id", data.id).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", data.id),
      context.supabase.from("departments").select("id, name, code"),
      selectDepartmentManagersSafe(context.supabase),
      context.supabase
        .from("profiles")
        .select("id")
        .eq("reporting_lead_id", data.id)
        .eq("employment_status", "active"),
      context.supabase
        .from("project_allocations")
        .select(
          "id, project_id, role_in_project, start_date, end_date, hours_per_day, allocation_pct, daily_task_target, status, acknowledged_at, projects(id, code, name, work_mode, task_unit, status)",
        )
        .eq("user_id", data.id)
        .neq("status", "ended")
        .order("created_at", { ascending: false }),
    ]);
    if (error) throw error;
    if (!rawProfile) throw new Error("This person is not visible to you.");

    const canSeeSensitivePii = canViewEmployeeSensitivePii(
      context.userId,
      data.id,
      actor.roles,
    );
    const isFounderOnly =
      actor.roles.includes("founder") && !actor.roles.some((r) => r !== "founder");

    // Redact sensitive PII fields on the server when caller is not Self, HR, or Super Admin
    const profile = {
      ...rawProfile,
      personal_email: canSeeSensitivePii ? rawProfile.personal_email : null,
      date_of_birth: canSeeSensitivePii ? rawProfile.date_of_birth : null,
      current_address: canSeeSensitivePii ? rawProfile.current_address : null,
      permanent_address: canSeeSensitivePii ? rawProfile.permanent_address : null,
      emergency_contact_name: isFounderOnly ? null : rawProfile.emergency_contact_name,
      emergency_contact_phone: isFounderOnly ? null : rawProfile.emergency_contact_phone,
    };

    const canSeeDocuments = canAccessEmployeeDocuments(
      context.userId,
      data.id,
      actor.roles,
      actor.permissions,
    );

    let documents: {
      id: string;
      doc_type: string;
      file_name: string;
      file_path: string;
      status: string;
      review_note: string | null;
      reviewed_at: string | null;
      created_at: string;
    }[] = [];

    if (canSeeDocuments) {
      const { data: docRows } = await context.supabase
        .from("documents")
        .select("id, doc_type, file_name, file_path, status, review_note, reviewed_at, created_at")
        .eq("user_id", data.id)
        .order("created_at", { ascending: false });
      documents = docRows ?? [];
    }

    const deptMap = new Map((departments ?? []).map((d) => [d.id, d]));
    const department = profile.department_id ? (deptMap.get(profile.department_id) ?? null) : null;
    const managedDepartments = deptMgrRes.rows
      .filter((dm) => dm.manager_id === data.id)
      .map((dm) => deptMap.get(dm.department_id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));

    let reportingLead: { id: string; fullName: string; designation: string | null } | null = null;
    if (profile.reporting_lead_id) {
      const names = await loadProfileNames(context.supabase, [profile.reporting_lead_id]);
      const resolved = names.get(profile.reporting_lead_id);
      if (resolved) {
        reportingLead = {
          id: profile.reporting_lead_id,
          fullName: resolved.fullName,
          designation: resolved.designation ?? null,
        };
      }
    }

    const targetRoles = (roles ?? []).map((r) => r.role);

    const [workTypeAssignment, annotation] = await Promise.all([
      loadProfileWorkTypeAssignment(context.supabase, data.id),
      loadAnnotationContext(context.supabase, data.id, todayIso()),
    ]);
    let workTypeAssignedByName: string | null = null;
    if (workTypeAssignment.assignedBy) {
      const names = await loadProfileNames(context.supabase, [workTypeAssignment.assignedBy]);
      workTypeAssignedByName = names.get(workTypeAssignment.assignedBy)?.fullName ?? null;
    }
    const annotationAllocations = annotation.allocations.filter(
      (a) => a.projectWorkType === "annotation",
    );

    return {
      profile,
      roles: targetRoles,
      documents,
      canSeeSensitivePii,
      canSeeDocuments,
      department,
      reportingLead,
      managedDepartments,
      directReportsCount: (directReports ?? []).length,
      allocations: (allocations ?? []).map((a) => ({
        ...a,
        project_work_type:
          annotation.allocations.find((x) => x.allocationId === a.id)?.projectWorkType ?? null,
      })),
      workType: {
        value: workTypeAssignment.workType,
        assignedAt: workTypeAssignment.assignedAt,
        assignedByName: workTypeAssignedByName,
        schemaReady: workTypeAssignment.schemaReady,
        canEdit: canChangeWorkTypeFor(context.userId, actor.roles, data.id),
      },
      annotation:
        workTypeAssignment.workType === "annotation"
          ? {
              contributor: annotation.contributor,
              logging: annotation.logging,
              allocations: annotationAllocations.map((a) => ({
                allocationId: a.allocationId,
                projectId: a.projectId,
                projectCode: a.projectCode,
                projectName: a.projectName,
                status: a.status,
                acknowledgedAt: a.acknowledgedAt,
                hourlyTarget: a.hourlyTarget,
                dailyTarget: a.dailyTarget,
                taskUnit: a.taskUnit,
              })),
            }
          : null,
      isExecutiveGovernance: isExecutiveGovernanceOnly(targetRoles),
      missingReportingLead: needsReportingLead({
        roles: targetRoles,
        employmentStatus: profile.employment_status,
        reportingLeadId: profile.reporting_lead_id,
      }),
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: ProfileDraft) => {
    if (input.fullName !== undefined && String(input.fullName).trim().length < 2) {
      throw new Error("Full name is required.");
    }
    if (input.mobile && !/^[+0-9\-\s()]{7,20}$/.test(input.mobile)) {
      throw new Error("Enter a valid mobile number.");
    }
    if (
      input.availableHoursPerDay != null &&
      (input.availableHoursPerDay < 1 || input.availableHoursPerDay > 24)
    ) {
      throw new Error("Available hours per day must be between 1 and 24.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "workforce:update:self");
    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch["full_name"] = data.fullName.trim();
    if (data.personalEmail !== undefined) patch["personal_email"] = data.personalEmail || null;
    if (data.mobile !== undefined) patch["mobile"] = data.mobile || null;
    if (data.dateOfBirth !== undefined) patch["date_of_birth"] = data.dateOfBirth || null;
    if (data.currentAddress !== undefined) patch["current_address"] = data.currentAddress || null;
    if (data.permanentAddress !== undefined)
      patch["permanent_address"] = data.permanentAddress || null;
    if (data.emergencyContactName !== undefined)
      patch["emergency_contact_name"] = data.emergencyContactName || null;
    if (data.emergencyContactPhone !== undefined)
      patch["emergency_contact_phone"] = data.emergencyContactPhone || null;
    if (data.skills !== undefined) patch["skills"] = data.skills ?? [];
    if (data.experienceYears !== undefined) patch["experience_years"] = data.experienceYears;
    if (data.institution !== undefined) patch["institution"] = data.institution || null;
    if (data.internshipStart !== undefined) patch["internship_start"] = data.internshipStart || null;
    if (data.internshipEnd !== undefined) patch["internship_end"] = data.internshipEnd || null;
    if (data.availableHoursPerDay !== undefined)
      patch["available_hours_per_day"] = data.availableHoursPerDay;
    if (data.photoUrl !== undefined) patch["photo_url"] = data.photoUrl || null;

    const { error } = await context.supabase
      .from("profiles")
      .update(patch as never)
      .eq("id", context.userId);
    if (error) throw error;

    await context.supabase
      .from("profiles")
      .update({ account_status: "profile_pending" })
      .eq("id", context.userId)
      .eq("account_status", "activated");

    return { ok: true };
  });

/** Employee action: lock the profile and hand it to HR for verification. */
export const submitProfileForVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "workforce:update:self");

    const [{ data: profile }, { data: documents }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, mobile, personal_email, category, account_status")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("documents").select("doc_type").eq("user_id", userId),
    ]);

    if (!profile) throw new Error("Profile not found.");

    const missing: string[] = [];
    if (!profile.full_name?.trim()) missing.push("Full name");
    if (!profile.mobile?.trim()) missing.push("Mobile number");
    if (!profile.personal_email?.trim()) missing.push("Personal email");

    const { REQUIRED_DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } = await import("./permissions");
    const uploaded = new Set((documents ?? []).map((d) => d.doc_type));
    for (const docType of REQUIRED_DOCUMENT_TYPES) {
      if (!uploaded.has(docType)) missing.push(DOCUMENT_TYPE_LABELS[docType]);
    }

    if (missing.length > 0) {
      return { ok: false as const, missing };
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        account_status: "under_verification",
        profile_submitted_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (error) throw error;

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "profile.submitted",
      entityType: "profile",
      entityId: userId,
    });

    return { ok: true as const, missing: [] as string[] };
  });

/** HR/Admin action: verify or send back a submitted profile. */
export const reviewProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; approve: boolean; note?: string }) => {
    if (!input?.userId) throw new Error("A person id is required.");
    if (!input.approve && !input.note?.trim()) {
      throw new Error("Explain what needs fixing when sending a profile back.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "documents:verify:all");

    const { error } = await supabase
      .from("profiles")
      .update(
        data.approve
          ? {
              account_status: "active",
              employment_status: "active",
              profile_verified_at: new Date().toISOString(),
              profile_verified_by: userId,
              needs_assignment: true,
            }
          : { account_status: "profile_pending", profile_submitted_at: null },
      )
      .eq("id", data.userId);
    if (error) throw error;

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: data.approve ? "profile.verified" : "profile.returned",
      entityType: "profile",
      entityId: data.userId,
      detail: { note: data.note ?? null },
    });

    return { ok: true };
  });

/** HR/Admin action: employment details that the person may not edit themselves. */
export const updateEmploymentDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      userId: string;
      designation?: string | null;
      departmentId?: string | null;
      reportingLeadId?: string | null;
      joiningDate?: string | null;
      workLocation?: string | null;
      employeeCode?: string | null;
      category?: string;
      employmentStatus?: string;
      availableHoursPerDay?: number | null;
      internshipStart?: string | null;
      internshipEnd?: string | null;
    }) => {
      if (!input?.userId) throw new Error("A person id is required.");
      if (input.reportingLeadId && input.reportingLeadId === input.userId) {
        throw new Error("A person cannot report to themselves.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "workforce:update:all");

    const actorForEdit = await loadActor(supabase, userId);
    if (
      data.userId !== userId &&
      !actorForEdit.roles.includes("super_admin") &&
      (await isProtectedAccountId(supabase, data.userId))
    ) {
      throw new Error("This person is not visible to you.");
    }

    const patch: Record<string, unknown> = {};
    if (data.designation !== undefined) patch["designation"] = data.designation || null;
    if (data.departmentId !== undefined) patch["department_id"] = data.departmentId || null;
    if (data.reportingLeadId !== undefined) {
      patch["reporting_lead_id"] = data.reportingLeadId || null;
      // Keep the "needs a reporting lead" surface honest in both directions.
      patch["needs_assignment"] = !data.reportingLeadId;
    }
    if (data.joiningDate !== undefined) patch["joining_date"] = data.joiningDate || null;
    if (data.workLocation !== undefined) patch["work_location"] = data.workLocation || null;
    if (data.employeeCode !== undefined) patch["employee_code"] = data.employeeCode || null;
    if (data.category !== undefined) patch["category"] = data.category;
    if (data.employmentStatus !== undefined) patch["employment_status"] = data.employmentStatus;
    if (data.availableHoursPerDay !== undefined)
      patch["available_hours_per_day"] = data.availableHoursPerDay;
    if (data.internshipStart !== undefined)
      patch["internship_start"] = data.internshipStart || null;
    if (data.internshipEnd !== undefined)
      patch["internship_end"] = data.internshipEnd || null;

    const { error } = await supabase
      .from("profiles")
      .update(patch as never)
      .eq("id", data.userId);
    if (error) throw error;

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "profile.employment_updated",
      entityType: "profile",
      entityId: data.userId,
      detail: patch,
    });
    return { ok: true };
  });

/**
 * HR / Admin / Super Admin action: assign an employee's Work Type (workstream).
 * Separate from role, category and employment status; audited with old -> new.
 * The DB trigger `guard_profile_work_type` enforces the same rule independently.
 */
export const setEmployeeWorkType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; workType: string | null; reason?: string | null }) => {
    if (!input?.userId) throw new Error("A person id is required.");
    if (input.workType !== null && !isWorkType(input.workType)) {
      throw new Error("Choose a valid work type.");
    }
    return {
      userId: input.userId,
      workType: input.workType as WorkType | null,
      reason: input.reason?.trim() || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const actor = await loadActor(supabase, userId);
    if (!canChangeWorkTypeFor(userId, actor.roles, data.userId)) {
      throw new Error(
        data.userId === userId
          ? "You cannot assign your own work type."
          : "Only HR, Admin or Super Admin can change an employee's work type.",
      );
    }
    if (
      data.userId !== userId &&
      !actor.roles.includes("super_admin") &&
      (await isProtectedAccountId(supabase, data.userId))
    ) {
      throw new Error("This person is not visible to you.");
    }

    const before = await loadProfileWorkTypeAssignment(supabase, data.userId);
    if (!before.schemaReady) {
      throw new Error(
        "Work Type requires applying SQL migration 20261113000000_annotation_work_type_and_protected_accounts.sql.",
      );
    }
    if (before.workType === data.workType) {
      return { ok: true, unchanged: true, workType: data.workType };
    }

    const { error } = await (supabase as unknown as import("@supabase/supabase-js").SupabaseClient)
      .from("profiles")
      .update({ work_type: data.workType })
      .eq("id", data.userId);
    if (error) rethrowDbError("Updating the work type failed", error);

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "profile.work_type_changed",
      entityType: "profile",
      entityId: data.userId,
      detail: {
        from: before.workType,
        to: data.workType,
        from_label: before.workType ? WORK_TYPE_LABELS[before.workType] : "Unclassified",
        to_label: data.workType ? WORK_TYPE_LABELS[data.workType] : "Unclassified",
        reason: data.reason,
      },
    });

    return { ok: true, unchanged: false, workType: data.workType };
  });

export const upsertDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { id?: string | null; name: string; code: string; description?: string | null }) => {
      if (!input?.name?.trim()) throw new Error("Department name is required.");
      if (!input?.code?.trim()) throw new Error("Department code is required.");
      return {
        id: input.id?.trim() || null,
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        description: input.description?.trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "org:manage:all");

    const payload = {
      name: data.name,
      code: data.code,
      description: data.description,
    };

    const { data: row, error } = data.id
      ? await supabase
          .from("departments")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabase.from("departments").insert(payload).select("*").single();
    if (error) {
      if (error.code === "23505") throw new Error("Department name or code already exists.");
      throw error;
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: data.id ? "department.updated" : "department.created",
      entityType: "department",
      entityId: row.id,
      detail: payload,
    });
    return { department: row };
  });

export const setDepartmentManagers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { departmentId: string; managerIds: string[] }) => {
    if (!input?.departmentId) throw new Error("A department id is required.");
    return {
      departmentId: input.departmentId,
      managerIds: [...new Set((input.managerIds ?? []).filter(Boolean))],
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [canOrg, canWorkforce] = await Promise.all([
      hasPermission(supabase, userId, "org:manage:all"),
      hasPermission(supabase, userId, "workforce:update:all"),
    ]);
    if (!canOrg && !canWorkforce) {
      await requirePermission(supabase, userId, "org:manage:all");
    }

    const { error: deleteError } = await supabase
      .from("department_managers")
      .delete()
      .eq("department_id", data.departmentId);
    if (deleteError) {
      if (isMissingSchemaResourceError(deleteError)) {
        throw new Error(
          "Department Manager assignments require applying SQL migration 20261111150000_p0_security_scoping_and_compliance.sql to the database.",
        );
      }
      throw deleteError;
    }

    if (data.managerIds.length > 0) {
      const { error: insertError } = await supabase.from("department_managers").insert(
        data.managerIds.map((managerId) => ({
          department_id: data.departmentId,
          manager_id: managerId,
          assigned_by: userId,
        })),
      );
      if (insertError) throw insertError;
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "department.managers_updated",
      entityType: "department",
      entityId: data.departmentId,
      detail: { managerIds: data.managerIds },
    });

    return { ok: true, managerIds: data.managerIds };
  });

export const getProfileDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("A person id is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    if (context.userId !== data.userId) {
      const actor = await loadActor(context.supabase, context.userId);
      const allowed = canAccessEmployeeDocuments(
        context.userId,
        data.userId,
        actor.roles,
        actor.permissions,
      );
      if (!allowed) {
        throw new Error(
          "Forbidden: sensitive employee documents can only be viewed by the employee, HR, or Super Admin.",
        );
      }
    }
    const { data: documents, error } = await context.supabase
      .from("documents")
      .select("id, doc_type, file_name, file_path, status, review_note, reviewed_at, created_at")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return documents ?? [];
  });

/** Option A: Send Supabase built-in password reset email (Super Admin, Admin, HR). */
export const sendEmployeePasswordResetEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("User ID is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "workforce:update:all");

    const resetActor = await loadActor(supabase, userId);
    if (
      data.userId !== userId &&
      !resetActor.roles.includes("super_admin") &&
      (await isProtectedAccountId(supabase, data.userId))
    ) {
      throw new Error("Could not find employee profile or email.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, work_email, full_name")
      .eq("id", data.userId)
      .maybeSingle();

    if (profileError || !profile?.work_email) {
      throw new Error("Could not find employee profile or email.");
    }

    const baseSiteUrl = (
      process.env["SITE_URL"] ||
      process.env["VITE_SITE_URL"] ||
      "https://hrm.theaischool.co"
    ).replace(/\/+$/, "");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(
      profile.work_email,
      {
        redirectTo: `${baseSiteUrl}/auth/reset-password`,
      },
    );

    if (resetError) {
      throw new Error(`Failed to dispatch reset email: ${resetError.message}`);
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "password.reset_email_sent",
      entityType: "user",
      entityId: data.userId,
      detail: { email: profile.work_email, method: "email_reset_link" },
    });

    return { ok: true, email: profile.work_email };
  });

/** Option B: Set temporary password directly (Super Admin ONLY). Never logged. */
export const setEmployeeTemporaryPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; temporaryPassword?: string | undefined }) => {
    if (!input?.userId) throw new Error("User ID is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Strict security check: Super Admin only
    const { data: actorRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const isSuperAdmin = (actorRoles ?? []).some((r) => r.role === "super_admin");
    if (!isSuperAdmin) {
      throw new Error("Forbidden: Setting direct temporary passwords is restricted to Super Admin.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, work_email, full_name")
      .eq("id", data.userId)
      .maybeSingle();

    if (profileError || !profile?.work_email) {
      throw new Error("Could not find employee profile.");
    }

    const tempPassword =
      data.temporaryPassword?.trim() || `TAS-Temp-${crypto.randomUUID().slice(0, 8)}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: tempPassword,
    });

    if (updateError) {
      throw new Error(`Failed to update password: ${updateError.message}`);
    }

    // Flag that the user must change password on their next login
    await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: true } as never)
      .eq("id", data.userId);

    // Write audit log WITHOUT recording the password value
    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "password.temporary_password_set",
      entityType: "user",
      entityId: data.userId,
      detail: { email: profile.work_email, method: "temporary_password_admin_override" },
    });

    return { ok: true, temporaryPassword: tempPassword, email: profile.work_email };
  });

/** Enforced password change when must_change_password is true. */
export const changeMustChangePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { newPassword: string }) => {
    const pwd = input?.newPassword ?? "";
    if (pwd.length < 8) {
      throw new Error("New password must be at least 8 characters.");
    }
    if (!/[A-Za-z]/.test(pwd) || !/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)) {
      throw new Error("New password must include at least one letter and one number or symbol.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false } as never)
      .eq("id", userId);

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "password.changed_by_user",
      entityType: "user",
      entityId: userId,
      detail: { reason: "must_change_password_cleared" },
    });

    return { ok: true };
  });

/** Voluntary self-service password change from the Unified Profile Security Settings card. */
export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { newPassword: string }) => {
    const pwd = input?.newPassword ?? "";
    if (pwd.length < 8) {
      throw new Error("New password must be at least 8 characters.");
    }
    if (!/[A-Za-z]/.test(pwd) || !/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)) {
      throw new Error("New password must include at least one letter and one number or symbol.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false } as never)
      .eq("id", userId);

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "password.changed_by_user",
      entityType: "user",
      entityId: userId,
      detail: { reason: "self_service_profile_security" },
    });

    return { ok: true };
  });

