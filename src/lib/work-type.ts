// Work Type / Workstream domain rules — client-safe, pure, unit-tested.
//
// Work Type is NOT an authorization role, employment category or employment
// status. It is an HR-assigned workstream. The SQL functions
// `is_annotation_contributor`, `is_annotation_assignable` and
// `can_log_annotation_work` (migration 20261113000000) are the authoritative
// enforcement; this module mirrors them so server functions can explain *why*
// something is blocked and the UI can render the same answer.

export const WORK_TYPES = [
  "annotation",
  "engineering",
  "operations",
  "hr",
  "training",
  "other",
] as const;

export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  annotation: "Annotation",
  engineering: "Engineering",
  operations: "Operations",
  hr: "Human Resources",
  training: "Training",
  other: "Other / General",
};

export function isWorkType(value: unknown): value is WorkType {
  return typeof value === "string" && (WORK_TYPES as readonly string[]).includes(value);
}

export function workTypeLabel(value: string | null | undefined): string {
  return isWorkType(value) ? WORK_TYPE_LABELS[value] : "Unclassified";
}

/** Roles that may never log annotation hours, even if they also hold `employee`. */
export const NON_CONTRIBUTOR_ROLES = [
  "super_admin",
  "founder",
  "hr",
  "admin",
  "manager",
  "lead",
] as const;

/** Employment categories eligible for annotation production work. */
export const ANNOTATION_ELIGIBLE_CATEGORIES = ["full_time", "intern"] as const;

/** Only HR, Admin and Super Admin may assign work types (never Founder/Manager/Lead). */
export function canChangeWorkType(actorRoles: readonly string[]): boolean {
  return (
    actorRoles.includes("super_admin") || actorRoles.includes("hr") || actorRoles.includes("admin")
  );
}

/** Self-assignment is blocked for everyone except Super Admin (mirrors the DB trigger). */
export function canChangeWorkTypeFor(
  actorId: string,
  actorRoles: readonly string[],
  targetId: string,
): boolean {
  if (!canChangeWorkType(actorRoles)) return false;
  if (actorId === targetId && !actorRoles.includes("super_admin")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Protected (system-owner) accounts
// ---------------------------------------------------------------------------

/** Protected accounts are identified by role, never by a hardcoded employee ID. */
export function isProtectedAccount(roles: readonly string[]): boolean {
  return roles.includes("super_admin");
}

/**
 * Removes protected accounts from an ordinary workforce listing. Applied to every
 * directory, selector, dashboard, report and export — including when a Super
 * Admin is the viewer (governance screens use their own path).
 *
 * The owner key is `user_id`, then `userId`, then `id` (profile rows), so records
 * such as documents or requests — which carry their own `id` — are matched by owner.
 */
export function excludeProtectedAccounts<T extends { id?: string; user_id?: string; userId?: string }>(
  rows: readonly T[],
  protectedIds: ReadonlySet<string>,
): T[] {
  if (protectedIds.size === 0) return [...rows];
  return rows.filter((row) => {
    const owner = row.user_id ?? row.userId ?? row.id;
    return !owner || !protectedIds.has(owner);
  });
}

/** May `viewerId` open the profile page of `targetId`? */
export function canViewProtectedProfile(args: {
  viewerId: string;
  viewerRoles: readonly string[];
  targetId: string;
  targetIsProtected: boolean;
}): boolean {
  if (!args.targetIsProtected) return true;
  return args.viewerId === args.targetId || args.viewerRoles.includes("super_admin");
}

// ---------------------------------------------------------------------------
// Annotation eligibility
// ---------------------------------------------------------------------------

export type AnnotationProfileInput = {
  roles: readonly string[];
  workType: string | null | undefined;
  accountStatus: string | null | undefined;
  employmentStatus: string | null | undefined;
  category: string | null | undefined;
};

export type AnnotationAllocationInput = {
  status: string | null | undefined;
  acknowledgedAt: string | null | undefined;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  projectWorkType: string | null | undefined;
  projectStatus?: string | null | undefined;
};

export type EligibilityCode =
  | "eligible"
  | "not_employee_role"
  | "management_role"
  | "not_annotation_work_type"
  | "category_not_eligible"
  | "account_not_active"
  | "employment_not_active"
  | "no_allocation"
  | "allocation_not_active"
  | "allocation_not_acknowledged"
  | "allocation_out_of_dates"
  | "project_not_annotation"
  | "project_not_active";

export type EligibilityResult = {
  eligible: boolean;
  code: EligibilityCode;
  reason: string;
};

const REASONS: Record<EligibilityCode, string> = {
  eligible: "Eligible to submit hourly annotation logs.",
  not_employee_role: "Hourly annotation logging is limited to the Employee role.",
  management_role:
    "Founder, Super Admin, Admin, HR, Manager and Lead accounts review annotation work but do not log it.",
  not_annotation_work_type:
    "Your work type is not Annotation. HR assigns the Annotation work type to production contributors.",
  category_not_eligible:
    "Annotation logging is available to full-time and intern employees only (not trainers or freelancers).",
  account_not_active: "Complete onboarding and HR verification before logging annotation work.",
  employment_not_active: "Your employment status is not active.",
  no_allocation: "You have no annotation project allocation.",
  allocation_not_active: "Your annotation allocation is not active.",
  allocation_not_acknowledged: "Acknowledge your annotation project allocation before logging work.",
  allocation_out_of_dates: "Your annotation allocation does not cover today.",
  project_not_annotation: "This project is not classified as an Annotation project.",
  project_not_active: "This annotation project is not active.",
};

function result(code: EligibilityCode): EligibilityResult {
  return { eligible: code === "eligible", code, reason: REASONS[code] };
}

/** Profile-level eligibility (mirrors SQL `is_annotation_contributor`). */
export function evaluateAnnotationContributor(input: AnnotationProfileInput): EligibilityResult {
  if (input.roles.some((r) => (NON_CONTRIBUTOR_ROLES as readonly string[]).includes(r))) {
    return result("management_role");
  }
  if (!input.roles.includes("employee")) return result("not_employee_role");
  if (input.workType !== "annotation") return result("not_annotation_work_type");
  if (!(ANNOTATION_ELIGIBLE_CATEGORIES as readonly string[]).includes(input.category ?? "")) {
    return result("category_not_eligible");
  }
  if (input.accountStatus !== "active") return result("account_not_active");
  if (input.employmentStatus !== "active") return result("employment_not_active");
  return result("eligible");
}

/** Allocation-level eligibility (mirrors SQL `can_log_annotation_work`). */
export function evaluateAnnotationLogging(
  profile: AnnotationProfileInput,
  allocation: AnnotationAllocationInput | null | undefined,
  onDate: string,
): EligibilityResult {
  const base = evaluateAnnotationContributor(profile);
  if (!base.eligible) return base;
  if (!allocation) return result("no_allocation");
  if (allocation.projectWorkType !== "annotation") return result("project_not_annotation");
  if (allocation.projectStatus != null && allocation.projectStatus !== "active") {
    return result("project_not_active");
  }
  if (allocation.status === "pending_acknowledgment" || !allocation.acknowledgedAt) {
    return result("allocation_not_acknowledged");
  }
  if (allocation.status !== "active") return result("allocation_not_active");
  if ((allocation.startDate ?? onDate) > onDate) return result("allocation_out_of_dates");
  if (allocation.endDate && allocation.endDate < onDate) return result("allocation_out_of_dates");
  return result("eligible");
}

/** Best result across all of a person's allocations (any eligible one unlocks logging). */
export function evaluateAnnotationLoggingAcross(
  profile: AnnotationProfileInput,
  allocations: readonly AnnotationAllocationInput[],
  onDate: string,
): EligibilityResult {
  const base = evaluateAnnotationContributor(profile);
  if (!base.eligible) return base;
  const annotationAllocs = allocations.filter((a) => a.projectWorkType === "annotation");
  if (annotationAllocs.length === 0) return result("no_allocation");
  let firstFailure: EligibilityResult | null = null;
  for (const a of annotationAllocs) {
    const r = evaluateAnnotationLogging(profile, a, onDate);
    if (r.eligible) return r;
    firstFailure ??= r;
  }
  return firstFailure ?? result("no_allocation");
}

/** Mirrors SQL `is_annotation_assignable`: who may be allocated to an annotation project. */
export function evaluateAnnotationAssignable(input: AnnotationProfileInput): EligibilityResult {
  if (input.roles.some((r) => (NON_CONTRIBUTOR_ROLES as readonly string[]).includes(r))) {
    return result("management_role");
  }
  if (!input.roles.includes("employee")) return result("not_employee_role");
  if (input.workType !== "annotation") return result("not_annotation_work_type");
  if (!(ANNOTATION_ELIGIBLE_CATEGORIES as readonly string[]).includes(input.category ?? "")) {
    return result("category_not_eligible");
  }
  if (input.employmentStatus !== "active") return result("employment_not_active");
  return result("eligible");
}

// ---------------------------------------------------------------------------
// Attendance & EOD separation
// ---------------------------------------------------------------------------

/**
 * Should check-in require an active acknowledged allocation?
 *
 * Personal attendance is NOT gated on annotation assignment. Management roles and
 * employees explicitly classified into a non-annotation workstream check in
 * freely. Annotation and still-unclassified employees keep the pre-existing
 * "acknowledge your assignment first" rule until HR classifies them.
 */
export function requiresAllocationForCheckIn(args: {
  roles: readonly string[];
  workType: string | null | undefined;
}): boolean {
  const management = args.roles.some(
    (r) => r === "manager" || r === "admin" || r === "super_admin" || r === "hr",
  );
  if (management) return false;
  if (isWorkType(args.workType) && args.workType !== "annotation") return false;
  return true;
}

export type EodMode = "annotation" | "general";

/** Annotation contributors submit production EODs; everyone else submits a general EOD. */
export function eodModeFor(profile: AnnotationProfileInput): EodMode {
  return evaluateAnnotationContributor(profile).eligible ? "annotation" : "general";
}

/** Whether a project form should show annotation production targets. */
export function projectUsesProductionTargets(workType: string | null | undefined): boolean {
  return workType === "annotation";
}
