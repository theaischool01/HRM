// Server-only schema compatibility & Manager scoping helpers.
// Ensures all Phase P0/P1 routes, dashboards, and server functions operate cleanly
// both BEFORE and AFTER `20261111150000_p0_security_scoping_and_compliance.sql`
// is applied to the target PostgreSQL database, without relaxing security scopes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  canManageProjectInGraph,
  canReviewSubordinateOrEscalateInGraph,
  isManagerOfInGraph,
  isWorkLeadOfInGraph,
  normalizeEffectivePermissions,
  type AppRole,
  type ScopedOrgGraph,
} from "./permissions";

type Client = SupabaseClient<Database>;

export const BASE_PROJECT_SELECT =
  "id, code, client_name, name, description, start_date, end_date, project_lead_id, work_mode, shift, task_unit, hourly_task_target, daily_task_target, quality_target_pct, max_rejection_rate_pct, required_headcount, status, created_by, created_at";

export const FULL_PROJECT_SELECT =
  "id, code, client_name, name, description, department_id, project_manager_id, start_date, end_date, project_lead_id, work_mode, shift, task_unit, hourly_task_target, daily_task_target, quality_target_pct, max_rejection_rate_pct, required_headcount, status, created_by, created_at";

export type SafeProjectRow = {
  id: string;
  code: string;
  client_name: string | null;
  name: string;
  description: string | null;
  department_id: string | null;
  project_manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  project_lead_id: string | null;
  work_mode: string;
  shift: string | null;
  task_unit: string;
  hourly_task_target: number | null;
  daily_task_target: number | null;
  quality_target_pct: number | null;
  max_rejection_rate_pct: number | null;
  required_headcount: number;
  status: string;
  created_by: string | null;
  created_at: string;
};

export function isMissingSchemaResourceError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message ?? "");
  return (
    code === "42703" || // undefined_column
    code === "42P01" || // undefined_table
    code === "PGRST205" || // table missing in schema cache
    code === "PGRST204" || // column missing in schema cache
    code === "PGRST202" || // rpc missing in schema cache
    /does not exist|schema cache/i.test(message)
  );
}

export async function selectProjectsSafe(
  supabase: Client,
  projectId?: string,
): Promise<{ rows: SafeProjectRow[]; hasScopedColumns: boolean }> {
  let fullQuery = supabase
    .from("projects")
    .select(FULL_PROJECT_SELECT)
    .order("created_at", { ascending: false });
  if (projectId) fullQuery = fullQuery.eq("id", projectId);

  const fullRes = await fullQuery;
  if (!fullRes.error) {
    return {
      rows: (fullRes.data ?? []) as SafeProjectRow[],
      hasScopedColumns: true,
    };
  }

  if (!isMissingSchemaResourceError(fullRes.error)) {
    throw fullRes.error;
  }

  let baseQuery = supabase
    .from("projects")
    .select(BASE_PROJECT_SELECT)
    .order("created_at", { ascending: false });
  if (projectId) baseQuery = baseQuery.eq("id", projectId);

  const baseRes = await baseQuery;
  if (baseRes.error) throw baseRes.error;

  return {
    rows: (baseRes.data ?? []).map((p) => ({
      ...(p as Omit<SafeProjectRow, "department_id" | "project_manager_id">),
      department_id: null,
      project_manager_id: null,
    })),
    hasScopedColumns: false,
  };
}

export async function selectDepartmentManagersSafe(supabase: Client): Promise<{
  rows: { id: string; department_id: string; manager_id: string }[];
  tableExists: boolean;
}> {
  const { data, error } = await supabase
    .from("department_managers")
    .select("id, department_id, manager_id");
  if (!error) {
    return { rows: data ?? [], tableExists: true };
  }
  if (isMissingSchemaResourceError(error)) {
    return { rows: [], tableExists: false };
  }
  throw error;
}

export async function buildScopedOrgGraph(supabase: Client): Promise<{
  graph: ScopedOrgGraph;
  p0SchemaReady: boolean;
}> {
  const [deptMgrRes, projRes, { data: teamLeads }, { data: profiles }, { data: allocations }] =
    await Promise.all([
      selectDepartmentManagersSafe(supabase),
      selectProjectsSafe(supabase),
      supabase.from("project_team_leads").select("project_id, lead_id"),
      supabase.from("profiles").select("id, department_id, reporting_lead_id"),
      supabase
        .from("project_allocations")
        .select("user_id, project_id, reporting_lead_id, status")
        .neq("status", "ended"),
    ]);

  const departmentManagers = new Map<string, Set<string>>();
  for (const row of deptMgrRes.rows) {
    let set = departmentManagers.get(row.department_id);
    if (!set) {
      set = new Set();
      departmentManagers.set(row.department_id, set);
    }
    set.add(row.manager_id);
  }

  const leadsByProject = new Map<string, Set<string>>();
  for (const row of teamLeads ?? []) {
    let set = leadsByProject.get(row.project_id);
    if (!set) {
      set = new Set();
      leadsByProject.set(row.project_id, set);
    }
    set.add(row.lead_id);
  }

  const projectsMap = new Map<
    string,
    {
      id: string;
      departmentId: string | null;
      projectManagerId: string | null;
      leadUserIds: ReadonlySet<string>;
      createdBy?: string | null;
    }
  >();
  for (const proj of projRes.rows) {
    const leads = new Set(leadsByProject.get(proj.id) ?? []);
    if (proj.project_lead_id) leads.add(proj.project_lead_id);
    projectsMap.set(proj.id, {
      id: proj.id,
      departmentId: proj.department_id,
      projectManagerId: proj.project_manager_id,
      leadUserIds: leads,
      createdBy: proj.created_by,
    });
  }

  const profilesMap = new Map<
    string,
    { id: string; departmentId: string | null; reportingLeadId: string | null }
  >();
  for (const p of profiles ?? []) {
    profilesMap.set(p.id, {
      id: p.id,
      departmentId: p.department_id,
      reportingLeadId: p.reporting_lead_id,
    });
  }

  const activeAllocationsByUser = new Map<
    string,
    { projectId: string; reportingLeadId: string | null }[]
  >();
  for (const a of allocations ?? []) {
    const list = activeAllocationsByUser.get(a.user_id) ?? [];
    list.push({ projectId: a.project_id, reportingLeadId: a.reporting_lead_id });
    activeAllocationsByUser.set(a.user_id, list);
  }

  return {
    graph: {
      departmentManagers,
      profiles: profilesMap,
      projects: projectsMap,
      activeAllocationsByUser,
    },
    p0SchemaReady: deptMgrRes.tableExists && projRes.hasScopedColumns,
  };
}

/**
 * Evaluates `can_manage_project` via SQL RPC when available, or falls back to
 * identical server-side org-graph evaluation when P0 SQL migration is pending.
 */
export async function evalCanManageProjectSafe(
  supabase: Client,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const rpcRes = await supabase.rpc("can_manage_project", {
    _project_id: projectId,
    _user_id: userId,
  });
  if (!rpcRes.error) {
    return rpcRes.data === true;
  }
  if (!isMissingSchemaResourceError(rpcRes.error)) {
    throw rpcRes.error;
  }

  const [{ data: roleRows }, { graph }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    buildScopedOrgGraph(supabase),
  ]);
  const roles = (roleRows ?? []).map((r) => r.role as AppRole);
  const perms = normalizeEffectivePermissions(roles, []);
  return canManageProjectInGraph(graph, projectId, userId, perms);
}

/**
 * Evaluates `can_review_subordinate_or_escalate` via SQL RPC when available, or
 * falls back to identical server-side org-graph evaluation when P0 SQL migration is pending.
 */
export async function evalCanReviewOrEscalateSafe(
  supabase: Client,
  subjectUserId: string,
  reviewerId: string,
): Promise<boolean> {
  if (!subjectUserId || !reviewerId || subjectUserId === reviewerId) return false;

  const rpcRes = await supabase.rpc("can_review_subordinate_or_escalate", {
    _subject_user_id: subjectUserId,
    _reviewer_id: reviewerId,
  });
  if (!rpcRes.error) {
    return rpcRes.data === true;
  }
  if (!isMissingSchemaResourceError(rpcRes.error)) {
    throw rpcRes.error;
  }

  const [{ data: roleRows }, { graph }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", reviewerId),
    buildScopedOrgGraph(supabase),
  ]);
  const roles = (roleRows ?? []).map((r) => r.role as AppRole);
  return canReviewSubordinateOrEscalateInGraph(graph, subjectUserId, reviewerId, roles);
}

/**
 * Computes exact scoped userIds, projectIds, and departmentIds for a Manager or Lead
 * so server functions strictly enforce scope even if P0 RLS migration is not yet deployed.
 */
export async function resolveSupervisorScope(
  supabase: Client,
  viewerId: string,
  viewerRoles: readonly string[],
): Promise<{
  isOrgWide: boolean;
  scopedUserIds: Set<string>;
  scopedProjectIds: Set<string>;
  managedDepartmentIds: Set<string>;
  p0SchemaReady: boolean;
}> {
  const isOrgWide = viewerRoles.some(
    (r) => r === "super_admin" || r === "founder" || r === "hr" || r === "admin",
  );
  const { graph, p0SchemaReady } = await buildScopedOrgGraph(supabase);

  const managedDepartmentIds = new Set<string>();
  for (const [deptId, mgrs] of graph.departmentManagers.entries()) {
    if (mgrs.has(viewerId)) managedDepartmentIds.add(deptId);
  }

  if (isOrgWide) {
    return {
      isOrgWide: true,
      scopedUserIds: new Set(graph.profiles.keys()),
      scopedProjectIds: new Set(graph.projects.keys()),
      managedDepartmentIds,
      p0SchemaReady,
    };
  }

  const scopedUserIds = new Set<string>([viewerId]);
  for (const candidateId of graph.profiles.keys()) {
    if (candidateId === viewerId) continue;
    if (
      isWorkLeadOfInGraph(graph, candidateId, viewerId) ||
      isManagerOfInGraph(graph, candidateId, viewerId, viewerRoles)
    ) {
      scopedUserIds.add(candidateId);
    }
  }

  const scopedProjectIds = new Set<string>();
  const myAllocs = graph.activeAllocationsByUser.get(viewerId) ?? [];
  const myAllocProjects = new Set(myAllocs.map((a) => a.projectId));

  for (const [projId, proj] of graph.projects.entries()) {
    if (
      myAllocProjects.has(projId) ||
      proj.leadUserIds.has(viewerId) ||
      (viewerRoles.includes("manager") &&
        (proj.projectManagerId === viewerId ||
          proj.createdBy === viewerId ||
          (proj.departmentId != null && managedDepartmentIds.has(proj.departmentId))))
    ) {
      scopedProjectIds.add(projId);
    }
  }

  return {
    isOrgWide: false,
    scopedUserIds,
    scopedProjectIds,
    managedDepartmentIds,
    p0SchemaReady,
  };
}

