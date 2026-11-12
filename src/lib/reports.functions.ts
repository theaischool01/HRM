import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActor } from "./actor.server";
import { canExportReports, REPORT_EXPORT_ROLES } from "./permissions";
import type { ReportFilter } from "./reports.server";
import {
  resolveSupervisorScope,
  selectDepartmentManagersSafe,
  selectProjectsSafe,
} from "./schema-compat.server";
import { startOfMonthIso, todayIso } from "./timezone";

/**
 * Exports are permitted for Super Admin, Founder (read-only org-wide oversight),
 * HR, Admin, and Manager (strictly scoped to assigned departments/projects/teams).
 * Leads and Employees are rejected server-side even on hand-crafted API requests.
 */
async function requireExporter(
  supabase: Parameters<typeof loadActor>[0],
  userId: string,
) {
  const actor = await loadActor(supabase, userId);
  if (!canExportReports(actor.roles, actor.permissions)) {
    throw new Error(
      "Forbidden: attendance exports are limited to Super Admin, Founder, HR, Admin and Manager.",
    );
  }
  const hasAllAttendance = actor.permissions.includes("attendance:read:all");
  const scope = hasAllAttendance
    ? null
    : await resolveSupervisorScope(supabase, userId, actor.roles);
  return { actor, hasAllAttendance, scope };
}

function normaliseFilter(input: Partial<ReportFilter> | undefined): ReportFilter {
  const now = new Date();
  const to = input?.to ?? todayIso(now);
  const from = input?.from ?? startOfMonthIso(now);
  if (from > to) throw new Error("The start date must be before the end date.");
  return {
    from,
    to,
    projectIds: input?.projectIds?.filter(Boolean) ?? null,
    departmentIds: input?.departmentIds?.filter(Boolean) ?? null,
    categories: input?.categories?.filter(Boolean) ?? null,
    userIds: input?.userIds?.filter(Boolean) ?? null,
    workModes: input?.workModes?.filter(Boolean) ?? null,
  };
}

/** Reference lists that populate the export filter controls. */
export const getReportFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { hasAllAttendance, scope } = await requireExporter(supabase, userId);
    const [projectsRes, { data: departments }, { data: people }, managedDeptsRes] =
      await Promise.all([
        selectProjectsSafe(supabase),
        supabase.from("departments").select("id, name").order("name"),
        supabase
          .from("profiles")
          .select("id, full_name, category, department_id")
          .order("full_name"),
        hasAllAttendance
          ? Promise.resolve({ rows: [] as { department_id: string; manager_id: string }[] })
          : selectDepartmentManagersSafe(supabase),
      ]);

    const projects = scope
      ? projectsRes.rows.filter((pr) => scope.scopedProjectIds.has(pr.id))
      : projectsRes.rows;

    const scopedPeople = (people ?? []).filter((p) =>
      hasAllAttendance ? true : p.id !== userId && Boolean(scope?.scopedUserIds.has(p.id)),
    );
    let scopedDepartments = departments ?? [];
    if (!hasAllAttendance) {
      const allowedDeptIds = new Set<string>();
      for (const dm of managedDeptsRes.rows) {
        if (dm.manager_id === userId) allowedDeptIds.add(dm.department_id);
      }
      for (const pr of projects) if (pr.department_id) allowedDeptIds.add(pr.department_id);
      for (const p of scopedPeople) if (p.department_id) allowedDeptIds.add(p.department_id);
      scopedDepartments = scopedDepartments.filter((d) => allowedDeptIds.has(d.id));
    }

    return {
      projects: projects.map(({ id, code, name }) => ({ id, code, name })),
      departments: scopedDepartments,
      people: scopedPeople.map(({ id, full_name, category }) => ({ id, full_name, category })),
    };
  });

export const buildAttendanceReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { type: "employee" | "project"; filter?: Partial<ReportFilter> }) => {
      if (input?.type !== "employee" && input?.type !== "project") {
        throw new Error("Pick an export type.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { hasAllAttendance, scope } = await requireExporter(supabase, userId);
    const filter = normaliseFilter(data.filter);

    if (!hasAllAttendance && scope) {
      const allowedUsers = [...scope.scopedUserIds].filter((id) => id !== userId);
      filter.userIds = filter.userIds?.length
        ? filter.userIds.filter((id) => scope.scopedUserIds.has(id))
        : allowedUsers.length > 0
          ? allowedUsers
          : ["00000000-0000-0000-0000-000000000000"];
      if (data.type === "project") {
        const allowedProjects = [...scope.scopedProjectIds];
        filter.projectIds = filter.projectIds?.length
          ? filter.projectIds.filter((id) => scope.scopedProjectIds.has(id))
          : allowedProjects.length > 0
            ? allowedProjects
            : ["00000000-0000-0000-0000-000000000000"];
      }
    }
    const { buildEmployeeReport, buildProjectReport } = await import("./reports.server");
    const rows =
      data.type === "employee"
        ? await buildEmployeeReport(supabase, filter)
        : await buildProjectReport(supabase, filter);

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "attendance.exported",
      entityType: "report",
      entityId: data.type,
      detail: { ...filter, rows: rows.length },
    });

    return { type: data.type, filter, rows };
  });
