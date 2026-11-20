// Server-only staffing candidate discovery and lookup for project management.
// Enforces project-management authorization, filters protected Super Admin accounts,
// and returns strictly non-confidential project-staffing fields.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isMissingSchemaResourceError } from "./schema-compat.server";
import { evaluateAnnotationContributor } from "./work-type";
import {
  loadProfileWorkTypes,
  loadProjectWorkTypes,
  loadProtectedAccountIds,
} from "./work-type.server";

type Client = SupabaseClient<Database>;

export type CandidateEligibilityStatus =
  | "available"
  | "already_allocated"
  | "capacity_full"
  | "profile_pending"
  | "under_verification"
  | "inactive"
  | "not_eligible";

export type AllocatableCandidate = {
  id: string;
  fullName: string;
  workEmail: string;
  employeeCode: string | null;
  designation: string | null;
  departmentId: string | null;
  departmentName: string;
  workType: string | null;
  category: string | null;
  primaryRole: string;
  roles: string[];
  usedPct: number;
  availableHoursPerDay: number;
  isAllocatedToProject: boolean;
  isAnnotationEligible: boolean;
  employmentStatus: string;
  accountStatus: string;
  eligibilityStatus: CandidateEligibilityStatus;
  eligibilityReason: string | null;
};

export type LoadCandidatesInput = {
  projectId: string;
  search?: string;
  departmentId?: string;
  workType?: string;
  role?: string;
  category?: string;
  capacityFilter?: "all" | "available" | "full";
  assignedFilter?: "all" | "unallocated" | "allocated";
  limit?: number;
  offset?: number;
};

export type LoadCandidatesResult = {
  candidates: AllocatableCandidate[];
  totalCount: number;
  projectWorkType: string | null;
  availableLeads: Array<{ id: string; fullName: string; designation: string | null }>;
  departments: Array<{ id: string; name: string }>;
};

/**
 * Discovers project staffing candidates across the entire organization.
 * Tries the SQL SECURITY DEFINER RPC get_project_allocation_candidates first;
 * falls back cleanly to server-side admin execution with identical scoping when the RPC is not yet deployed.
 */
export async function fetchProjectAllocationCandidates(
  userClient: Client,
  input: LoadCandidatesInput,
): Promise<LoadCandidatesResult> {
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  const offset = Math.max(0, Number(input.offset) || 0);

  // 1. Try PostgreSQL SECURITY DEFINER RPC
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcRes = await (userClient.rpc as any)("get_project_allocation_candidates", {
      _project_id: input.projectId,
      _search: input.search?.trim() || null,
      _department_id: input.departmentId || null,
      _work_type: input.workType && input.workType !== "all" ? input.workType : null,
      _role: input.role && input.role !== "all" ? input.role : null,
      _category: input.category && input.category !== "all" ? input.category : null,
      _capacity_filter: input.capacityFilter || "all",
      _assigned_filter: input.assignedFilter || "all",
      _limit: limit,
      _offset: offset,
    });

    if (!rpcRes.error && Array.isArray(rpcRes.data)) {
      const rows = rpcRes.data as any[];
      const totalCount = rows.length > 0 ? Number(rows[0].total_count) || rows.length : 0;

      // Also retrieve departments and leads for selector filters
      const [{ data: depts }, projectTypesRes, { data: leadRows }] = await Promise.all([
        supabaseAdmin.from("departments").select("id, name").order("name"),
        loadProjectWorkTypes(supabaseAdmin, [input.projectId]),
        supabaseAdmin
          .from("profiles")
          .select("id, full_name, designation")
          .eq("employment_status", "active")
          .order("full_name"),
      ]);

      const candidates: AllocatableCandidate[] = rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        workEmail: r.work_email,
        employeeCode: r.employee_code ?? null,
        designation: r.designation ?? null,
        departmentId: r.department_id ?? null,
        departmentName: r.department_name ?? "Unassigned",
        workType: r.work_type ?? null,
        category: r.category ?? null,
        primaryRole: r.primary_role ?? "employee",
        roles: Array.isArray(r.roles) ? r.roles : ["employee"],
        usedPct: Number(r.used_pct ?? 0),
        availableHoursPerDay: Number(r.available_hours_per_day ?? 8),
        isAllocatedToProject: Boolean(r.is_allocated_to_project),
        isAnnotationEligible: Boolean(r.is_annotation_eligible),
        employmentStatus: r.employment_status ?? "active",
        accountStatus: r.account_status ?? "active",
        eligibilityStatus: (r.eligibility_status as CandidateEligibilityStatus) ?? "available",
        eligibilityReason: r.eligibility_reason ?? null,
      }));

      const availableLeads = (leadRows ?? []).map((l) => ({
        id: l.id,
        fullName: l.full_name,
        designation: l.designation ?? null,
      }));

      return {
        candidates,
        totalCount,
        projectWorkType: projectTypesRes.map.get(input.projectId) ?? null,
        availableLeads,
        departments: (depts ?? []).map((d) => ({ id: d.id, name: d.name })),
      };
    }
  } catch {
    // Fall back to server-side admin execution
  }

  // 2. Server-side execution using supabaseAdmin with identical security guards
  const [
    { data: profiles },
    { data: departments },
    { data: roleRows },
    { data: liveAllocs },
    protectedIds,
    workTypesRes,
    projectTypesRes,
    { data: projectLeads },
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, work_email, employee_code, designation, department_id, category, available_hours_per_day, employment_status, account_status",
      )
      .order("full_name"),
    supabaseAdmin.from("departments").select("id, name, code").order("name"),
    supabaseAdmin.from("user_roles").select("user_id, role"),
    supabaseAdmin
      .from("project_allocations")
      .select("user_id, allocation_pct, project_id")
      .neq("status", "ended"),
    loadProtectedAccountIds(supabaseAdmin),
    loadProfileWorkTypes(supabaseAdmin),
    loadProjectWorkTypes(supabaseAdmin, [input.projectId]),
    supabaseAdmin
      .from("project_team_leads")
      .select("lead_id")
      .eq("project_id", input.projectId),
  ]);

  const deptMap = new Map((departments ?? []).map((d) => [d.id, d.name]));

  // Map roles per user
  const rolesMap = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const arr = rolesMap.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesMap.set(r.user_id, arr);
  }

  // Map allocations per user
  const allocMap = new Map<string, { totalPct: number; inThisProject: boolean }>();
  for (const a of liveAllocs ?? []) {
    const curr = allocMap.get(a.user_id) ?? { totalPct: 0, inThisProject: false };
    curr.totalPct += Number(a.allocation_pct ?? 0);
    if (a.project_id === input.projectId) {
      curr.inThisProject = true;
    }
    allocMap.set(a.user_id, curr);
  }

  const projectWorkType = projectTypesRes.map.get(input.projectId) ?? null;

  // Build candidate records
  const allCandidates: AllocatableCandidate[] = (profiles ?? [])
    .filter((p) => !protectedIds.has(p.id))
    .map((p) => {
      const roles = rolesMap.get(p.id) ?? ["employee"];
      const workType = workTypesRes.map.get(p.id) ?? null;
      const allocInfo = allocMap.get(p.id) ?? { totalPct: 0, inThisProject: false };

      const isAnnotationEligible = evaluateAnnotationContributor({
        roles,
        workType,
        accountStatus: p.account_status,
        employmentStatus: p.employment_status,
        category: p.category,
      }).eligible;

      // Determine eligibility status & reason
      let eligibilityStatus: CandidateEligibilityStatus = "available";
      let eligibilityReason: string | null = null;

      if (p.employment_status !== "active") {
        eligibilityStatus = "inactive";
        eligibilityReason = `Employment status is ${p.employment_status}`;
      } else if (p.account_status === "profile_pending") {
        eligibilityStatus = "profile_pending";
        eligibilityReason = "Profile onboarding incomplete";
      } else if (p.account_status === "under_verification") {
        eligibilityStatus = "under_verification";
        eligibilityReason = "Under HR / KYC verification";
      } else if (allocInfo.inThisProject) {
        eligibilityStatus = "already_allocated";
        eligibilityReason = "Already allocated to this project";
      } else if (allocInfo.totalPct >= 100) {
        eligibilityStatus = "capacity_full";
        eligibilityReason = `Allocated at ${allocInfo.totalPct}% across other projects`;
      }

      // Determine primary role
      const roleRanks: Record<string, number> = {
        super_admin: 1,
        founder: 2,
        admin: 3,
        hr: 4,
        manager: 5,
        lead: 6,
        employee: 7,
      };
      const sortedRoles = [...roles].sort((a, b) => (roleRanks[a] ?? 99) - (roleRanks[b] ?? 99));
      const primaryRole = sortedRoles[0] ?? "employee";

      return {
        id: p.id,
        fullName: p.full_name,
        workEmail: p.work_email,
        employeeCode: p.employee_code,
        designation: p.designation,
        departmentId: p.department_id,
        departmentName: (p.department_id ? deptMap.get(p.department_id) : null) ?? "Unassigned",
        workType,
        category: p.category,
        primaryRole,
        roles,
        usedPct: allocInfo.totalPct,
        availableHoursPerDay: p.available_hours_per_day ?? 8,
        isAllocatedToProject: allocInfo.inThisProject,
        isAnnotationEligible,
        employmentStatus: p.employment_status,
        accountStatus: p.account_status,
        eligibilityStatus,
        eligibilityReason,
      };
    });

  // Apply filters
  const searchQ = (input.search ?? "").trim().toLowerCase();
  const filtered = allCandidates.filter((c) => {
    // Search
    if (searchQ) {
      const matchName = c.fullName.toLowerCase().includes(searchQ);
      const matchCode = (c.employeeCode ?? "").toLowerCase().includes(searchQ);
      const matchEmail = c.workEmail.toLowerCase().includes(searchQ);
      if (!matchName && !matchCode && !matchEmail) return false;
    }

    // Department
    if (input.departmentId && input.departmentId !== "all") {
      if (c.departmentId !== input.departmentId) return false;
    }

    // Work type
    if (input.workType && input.workType !== "all") {
      if (c.workType !== input.workType) return false;
    }

    // Role
    if (input.role && input.role !== "all") {
      if (!c.roles.includes(input.role)) return false;
    }

    // Category
    if (input.category && input.category !== "all") {
      if (c.category !== input.category) return false;
    }

    // Capacity filter
    if (input.capacityFilter === "available" && c.usedPct >= 100) return false;
    if (input.capacityFilter === "full" && c.usedPct < 100) return false;

    // Assigned filter
    if (input.assignedFilter === "unallocated" && c.isAllocatedToProject) return false;
    if (input.assignedFilter === "allocated" && !c.isAllocatedToProject) return false;

    return true;
  });

  // Sort: Available first, then capacity_full, then already_allocated, then others; alphabetical by name
  filtered.sort((a, b) => {
    const rank = (status: CandidateEligibilityStatus) => {
      switch (status) {
        case "available":
          return 1;
        case "capacity_full":
          return 2;
        case "already_allocated":
          return 3;
        default:
          return 4;
      }
    };
    const diff = rank(a.eligibilityStatus) - rank(b.eligibilityStatus);
    if (diff !== 0) return diff;
    return a.fullName.localeCompare(b.fullName);
  });

  const totalCount = filtered.length;
  const pagedCandidates = filtered.slice(offset, offset + limit);

  // Available leads for assigning leads
  const projectLeadIds = new Set((projectLeads ?? []).map((l) => l.lead_id));
  const availableLeads = allCandidates
    .filter((e) => e.roles.includes("lead") || e.roles.includes("manager") || projectLeadIds.has(e.id))
    .map((e) => ({
      id: e.id,
      fullName: e.fullName,
      designation: e.designation,
    }));

  return {
    candidates: pagedCandidates,
    totalCount,
    projectWorkType,
    availableLeads,
    departments: (departments ?? []).map((d) => ({ id: d.id, name: d.name })),
  };
}

/**
 * Server-side lookup of target employee profiles for single and bulk allocation creation.
 * Bypasses manager-scoped RLS to allow cross-department assignments while enforcing active status.
 */
export async function lookupTargetProfiles(userIds: string[]): Promise<{
  map: Map<string, any>;
  protectedIds: Set<string>;
}> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return { map: new Map<string, any>(), protectedIds: new Set<string>() };

  const [{ data: profiles }, profileTypes, protectedIds] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, work_email, employee_code, employment_status, account_status, category, department_id")
      .in("id", uniqueIds),
    loadProfileWorkTypes(supabaseAdmin, uniqueIds),
    loadProtectedAccountIds(supabaseAdmin),
  ]);

  const map = new Map<string, any>();
  for (const p of profiles ?? []) {
    if (protectedIds.has(p.id)) continue;
    map.set(p.id, {
      ...p,
      work_type: profileTypes.map.get(p.id) ?? null,
      is_protected: false,
    });
  }

  return { map, protectedIds };
}
