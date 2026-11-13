// Server-only helpers for Work Type and protected-account privacy.
//
// Every helper here is schema-tolerant: before migration 20261113000000 is
// applied, `work_type` columns do not exist, so every person/project reads as
// "unclassified" (which can never satisfy the annotation policy — fail closed).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isMissingSchemaResourceError } from "./schema-compat.server";
import {
  evaluateAnnotationContributor,
  evaluateAnnotationLogging,
  evaluateAnnotationLoggingAcross,
  isWorkType,
  type AnnotationAllocationInput,
  type AnnotationProfileInput,
  type EligibilityResult,
  type WorkType,
} from "./work-type";

type Client = SupabaseClient<Database>;

/** Loosely-typed handle for columns that are newer than the generated types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (supabase: Client) => supabase as unknown as SupabaseClient<any>;

/** Map of userId -> work type (null = unclassified). Missing column => empty map. */
export async function loadProfileWorkTypes(
  supabase: Client,
  userIds?: readonly string[],
): Promise<{ map: Map<string, WorkType | null>; schemaReady: boolean }> {
  let query = loose(supabase).from("profiles").select("id, work_type");
  if (userIds) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return { map: new Map(), schemaReady: true };
    query = query.in("id", ids);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaResourceError(error)) return { map: new Map(), schemaReady: false };
    throw error;
  }
  const map = new Map<string, WorkType | null>();
  for (const row of (data ?? []) as { id: string; work_type: string | null }[]) {
    map.set(row.id, isWorkType(row.work_type) ? row.work_type : null);
  }
  return { map, schemaReady: true };
}

export async function loadProfileWorkTypeAssignment(
  supabase: Client,
  userId: string,
): Promise<{
  workType: WorkType | null;
  assignedBy: string | null;
  assignedAt: string | null;
  schemaReady: boolean;
}> {
  const { data, error } = await loose(supabase)
    .from("profiles")
    .select("work_type, work_type_assigned_by, work_type_assigned_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaResourceError(error)) {
      return { workType: null, assignedBy: null, assignedAt: null, schemaReady: false };
    }
    throw error;
  }
  const row = data as {
    work_type: string | null;
    work_type_assigned_by: string | null;
    work_type_assigned_at: string | null;
  } | null;
  return {
    workType: isWorkType(row?.work_type) ? row!.work_type as WorkType : null,
    assignedBy: row?.work_type_assigned_by ?? null,
    assignedAt: row?.work_type_assigned_at ?? null,
    schemaReady: true,
  };
}

/** Map of projectId -> work type (null = unclassified). Missing column => empty map. */
export async function loadProjectWorkTypes(
  supabase: Client,
  projectIds?: readonly string[],
): Promise<{ map: Map<string, WorkType | null>; schemaReady: boolean }> {
  let query = loose(supabase).from("projects").select("id, work_type");
  if (projectIds) {
    const ids = [...new Set(projectIds.filter(Boolean))];
    if (ids.length === 0) return { map: new Map(), schemaReady: true };
    query = query.in("id", ids);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaResourceError(error)) return { map: new Map(), schemaReady: false };
    throw error;
  }
  const map = new Map<string, WorkType | null>();
  for (const row of (data ?? []) as { id: string; work_type: string | null }[]) {
    map.set(row.id, isWorkType(row.work_type) ? row.work_type : null);
  }
  return { map, schemaReady: true };
}

/**
 * IDs of protected (super_admin) accounts that the caller can currently see.
 * After the migration, RLS already hides them from non-Super-Admins; before it,
 * HR/Admin can still read them, so this filter is the server-side guarantee.
 */
export async function loadProtectedAccountIds(supabase: Client): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "super_admin");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.user_id));
}

/** Is a specific account protected? Uses the definer RPC when present. */
export async function isProtectedAccountId(supabase: Client, userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = await (supabase.rpc as any)("is_protected_account", { _user_id: userId });
  if (!rpc.error) return rpc.data === true;
  if (!isMissingSchemaResourceError(rpc.error)) throw rpc.error;
  const ids = await loadProtectedAccountIds(supabase);
  return ids.has(userId);
}

export type AnnotationContext = {
  profile: AnnotationProfileInput;
  allocations: (AnnotationAllocationInput & {
    allocationId: string;
    projectId: string;
    projectCode: string | null;
    projectName: string | null;
    hourlyTarget: number | null;
    dailyTarget: number | null;
    taskUnit: string | null;
  })[];
  contributor: EligibilityResult;
  logging: EligibilityResult;
  schemaReady: boolean;
};

/** Everything needed to explain annotation eligibility for one person. */
export async function loadAnnotationContext(
  supabase: Client,
  userId: string,
  onDate: string,
): Promise<AnnotationContext> {
  const [{ data: profile }, { data: roleRows }, workType, { data: allocRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("account_status, employment_status, category")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    loadProfileWorkTypeAssignment(supabase, userId),
    supabase
      .from("project_allocations")
      .select(
        "id, project_id, status, acknowledged_at, start_date, end_date, daily_task_target, projects(id, code, name, status, task_unit, hourly_task_target, daily_task_target)",
      )
      .eq("user_id", userId)
      .neq("status", "ended"),
  ]);

  const projectIds = (allocRows ?? []).map((a) => a.project_id);
  const projectTypes = await loadProjectWorkTypes(supabase, projectIds);

  const profileInput: AnnotationProfileInput = {
    roles: (roleRows ?? []).map((r) => r.role),
    workType: workType.workType,
    accountStatus: profile?.account_status ?? null,
    employmentStatus: profile?.employment_status ?? null,
    category: profile?.category ?? null,
  };

  const allocations = (allocRows ?? []).map((a) => {
    const p = a.projects as {
      code?: string;
      name?: string;
      status?: string;
      task_unit?: string;
      hourly_task_target?: number | null;
      daily_task_target?: number | null;
    } | null;
    return {
      allocationId: a.id,
      projectId: a.project_id,
      projectCode: p?.code ?? null,
      projectName: p?.name ?? null,
      projectStatus: p?.status ?? null,
      projectWorkType: projectTypes.map.get(a.project_id) ?? null,
      status: a.status,
      acknowledgedAt: a.acknowledged_at,
      startDate: a.start_date,
      endDate: a.end_date,
      hourlyTarget: p?.hourly_task_target ?? null,
      dailyTarget: a.daily_task_target ?? p?.daily_task_target ?? null,
      taskUnit: p?.task_unit ?? null,
    };
  });

  return {
    profile: profileInput,
    allocations,
    contributor: evaluateAnnotationContributor(profileInput),
    logging: evaluateAnnotationLoggingAcross(profileInput, allocations, onDate),
    schemaReady: workType.schemaReady && projectTypes.schemaReady,
  };
}

/**
 * Authoritative per-project check: the SQL policy when deployed; otherwise the
 * mirrored TS policy (fail closed — unclassified never passes).
 */
export async function assertCanLogAnnotationWork(
  supabase: Client,
  userId: string,
  projectId: string,
  onDate: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = await (supabase.rpc as any)("can_log_annotation_work", {
    _user_id: userId,
    _project_id: projectId,
    _on_date: onDate,
  });
  const ctx = await loadAnnotationContext(supabase, userId, onDate);
  const alloc = ctx.allocations.find((a) => a.projectId === projectId) ?? null;
  const local = evaluateAnnotationLogging(ctx.profile, alloc, onDate);

  if (!rpc.error) {
    if (rpc.data === true) return;
    throw new Error(local.eligible ? "Hourly annotation logging is blocked for that project." : local.reason);
  }
  if (!isMissingSchemaResourceError(rpc.error)) throw rpc.error;
  if (!local.eligible) throw new Error(local.reason);
}
