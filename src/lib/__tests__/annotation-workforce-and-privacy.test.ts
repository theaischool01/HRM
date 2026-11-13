import { describe, expect, it } from "vitest";
import { EMPTY_METRICS, validateEodSubmission } from "../daily.server";
import {
  canChangeWorkType,
  canChangeWorkTypeFor,
  canViewProtectedProfile,
  eodModeFor,
  evaluateAnnotationAssignable,
  evaluateAnnotationContributor,
  evaluateAnnotationLogging,
  evaluateAnnotationLoggingAcross,
  excludeProtectedAccounts,
  isProtectedAccount,
  isWorkType,
  projectUsesProductionTargets,
  requiresAllocationForCheckIn,
  WORK_TYPES,
  WORK_TYPE_LABELS,
  workTypeLabel,
  type AnnotationAllocationInput,
  type AnnotationProfileInput,
} from "../work-type";

const TODAY = "2026-11-13";

function makeProfile(overrides: Partial<AnnotationProfileInput> = {}): AnnotationProfileInput {
  return {
    roles: ["employee"],
    workType: "annotation",
    accountStatus: "active",
    employmentStatus: "active",
    category: "full_time",
    ...overrides,
  };
}

function makeAllocation(overrides: Partial<AnnotationAllocationInput> = {}): AnnotationAllocationInput {
  return {
    status: "active",
    acknowledgedAt: "2026-11-01T09:00:00Z",
    startDate: "2026-11-01",
    endDate: null,
    projectWorkType: "annotation",
    projectStatus: "active",
    ...overrides,
  };
}

describe("Work Type / Workstream Classification & RBAC", () => {
  it("supports all 6 organizational work types and formats unclassified cleanly", () => {
    expect(WORK_TYPES).toEqual([
      "annotation",
      "engineering",
      "operations",
      "hr",
      "training",
      "other",
    ]);
    for (const wt of WORK_TYPES) {
      expect(isWorkType(wt)).toBe(true);
      expect(WORK_TYPE_LABELS[wt]).toBeTruthy();
    }
    expect(isWorkType(null)).toBe(false);
    expect(isWorkType("unknown")).toBe(false);
    expect(workTypeLabel(null)).toBe("Unclassified");
    expect(workTypeLabel("annotation")).toBe("Annotation");
  });

  it("allows only HR, Admin, and Super Admin to change work types, and blocks self-assignment except Super Admin", () => {
    expect(canChangeWorkType(["hr"])).toBe(true);
    expect(canChangeWorkType(["admin"])).toBe(true);
    expect(canChangeWorkType(["super_admin"])).toBe(true);
    expect(canChangeWorkType(["manager"])).toBe(false);
    expect(canChangeWorkType(["lead"])).toBe(false);
    expect(canChangeWorkType(["founder"])).toBe(false);
    expect(canChangeWorkType(["employee"])).toBe(false);

    expect(canChangeWorkTypeFor("hr-1", ["hr"], "emp-1")).toBe(true);
    expect(canChangeWorkTypeFor("admin-1", ["admin"], "emp-1")).toBe(true);
    expect(canChangeWorkTypeFor("hr-1", ["hr"], "hr-1")).toBe(false);
    expect(canChangeWorkTypeFor("admin-1", ["admin"], "admin-1")).toBe(false);
    expect(canChangeWorkTypeFor("sa-1", ["super_admin"], "sa-1")).toBe(true);
    expect(canChangeWorkTypeFor("mgr-1", ["manager"], "emp-1")).toBe(false);
    expect(canChangeWorkTypeFor("lead-1", ["lead"], "emp-1")).toBe(false);
    expect(canChangeWorkTypeFor("founder-1", ["founder"], "emp-1")).toBe(false);
  });
});

describe("Annotation Contributor & Hourly Logging Eligibility", () => {
  it("allows an active annotation full-time or intern employee with active acknowledged annotation allocation", () => {
    const fullTime = evaluateAnnotationLogging(makeProfile({ category: "full_time" }), makeAllocation(), TODAY);
    expect(fullTime.eligible).toBe(true);
    expect(fullTime.code).toBe("eligible");

    const intern = evaluateAnnotationLogging(makeProfile({ category: "intern" }), makeAllocation(), TODAY);
    expect(intern.eligible).toBe(true);
    expect(intern.code).toBe("eligible");
  });

  it("blocks annotation employees without an active annotation allocation", () => {
    const res = evaluateAnnotationLoggingAcross(makeProfile(), [], TODAY);
    expect(res.eligible).toBe(false);
    expect(res.code).toBe("no_allocation");
  });

  it("blocks annotation employees whose allocation has not been acknowledged", () => {
    const res = evaluateAnnotationLogging(
      makeProfile(),
      makeAllocation({ status: "pending_acknowledgment", acknowledgedAt: null }),
      TODAY,
    );
    expect(res.eligible).toBe(false);
    expect(res.code).toBe("allocation_not_acknowledged");
  });

  it("blocks annotation logging on inactive/paused projects or outside allocation dates", () => {
    const paused = evaluateAnnotationLogging(
      makeProfile(),
      makeAllocation({ projectStatus: "paused" }),
      TODAY,
    );
    expect(paused.eligible).toBe(false);
    expect(paused.code).toBe("project_not_active");

    const ended = evaluateAnnotationLogging(
      makeProfile(),
      makeAllocation({ endDate: "2026-11-12" }),
      TODAY,
    );
    expect(ended.eligible).toBe(false);
    expect(ended.code).toBe("allocation_out_of_dates");
  });

  it("blocks annotation employees allocated only to a non-annotation project", () => {
    const direct = evaluateAnnotationLogging(
      makeProfile(),
      makeAllocation({ projectWorkType: "engineering" }),
      TODAY,
    );
    expect(direct.eligible).toBe(false);
    expect(direct.code).toBe("project_not_annotation");

    const across = evaluateAnnotationLoggingAcross(
      makeProfile(),
      [makeAllocation({ projectWorkType: "engineering" })],
      TODAY,
    );
    expect(across.eligible).toBe(false);
    expect(across.code).toBe("no_allocation");
  });

  it("blocks Engineering, Operations, HR, Training, Other, and Unclassified employees from annotation logging", () => {
    for (const wt of ["engineering", "operations", "hr", "training", "other", null] as const) {
      const res = evaluateAnnotationLogging(makeProfile({ workType: wt }), makeAllocation(), TODAY);
      expect(res.eligible).toBe(false);
      expect(res.code).toBe("not_annotation_work_type");
    }
  });

  it("blocks HR users and HR Interns (never treats intern category alone as annotation)", () => {
    const hrUser = evaluateAnnotationLogging(
      makeProfile({ roles: ["hr"], workType: "hr" }),
      makeAllocation(),
      TODAY,
    );
    expect(hrUser.eligible).toBe(false);
    expect(hrUser.code).toBe("management_role");

    const hrIntern = evaluateAnnotationLogging(
      makeProfile({ roles: ["hr", "employee"], category: "intern", workType: "hr" }),
      makeAllocation(),
      TODAY,
    );
    expect(hrIntern.eligible).toBe(false);
    expect(hrIntern.code).toBe("management_role");
  });

  it("blocks Manager, Lead, Founder, Admin, and Super Admin from hourly annotation logging", () => {
    for (const role of ["manager", "lead", "founder", "admin", "super_admin"] as const) {
      const res = evaluateAnnotationLogging(
        makeProfile({ roles: [role, "employee"] }),
        makeAllocation(),
        TODAY,
      );
      expect(res.eligible).toBe(false);
      expect(res.code).toBe("management_role");
    }
  });

  it("blocks Trainer and Freelancer categories from annotation logging", () => {
    for (const category of ["trainer", "freelancer"] as const) {
      const res = evaluateAnnotationLogging(makeProfile({ category }), makeAllocation(), TODAY);
      expect(res.eligible).toBe(false);
      expect(res.code).toBe("category_not_eligible");
    }
  });

  it("blocks unverified accounts and inactive employment from annotation logging", () => {
    const pending = evaluateAnnotationContributor(
      makeProfile({ accountStatus: "profile_pending" }),
    );
    expect(pending.eligible).toBe(false);
    expect(pending.code).toBe("account_not_active");

    const inactive = evaluateAnnotationContributor(
      makeProfile({ employmentStatus: "inactive" }),
    );
    expect(inactive.eligible).toBe(false);
    expect(inactive.code).toBe("employment_not_active");
  });
});

describe("Annotation Project Allocation & Production Targets", () => {
  it("allows only active full-time/intern annotation employees (with no management roles) to be allocated to annotation projects", () => {
    expect(evaluateAnnotationAssignable(makeProfile({ category: "full_time" })).eligible).toBe(true);
    expect(evaluateAnnotationAssignable(makeProfile({ category: "intern", accountStatus: "profile_pending" })).eligible).toBe(true);

    expect(evaluateAnnotationAssignable(makeProfile({ workType: "engineering" })).eligible).toBe(false);
    expect(evaluateAnnotationAssignable(makeProfile({ workType: "operations" })).eligible).toBe(false);
    expect(evaluateAnnotationAssignable(makeProfile({ workType: null })).eligible).toBe(false);
    expect(evaluateAnnotationAssignable(makeProfile({ roles: ["manager"] })).eligible).toBe(false);
    expect(evaluateAnnotationAssignable(makeProfile({ roles: ["lead"] })).eligible).toBe(false);
    expect(evaluateAnnotationAssignable(makeProfile({ roles: ["hr"], category: "intern" })).eligible).toBe(false);
    expect(evaluateAnnotationAssignable(makeProfile({ category: "trainer" })).eligible).toBe(false);
    expect(evaluateAnnotationAssignable(makeProfile({ employmentStatus: "exited" })).eligible).toBe(false);
  });

  it("applies production targets exclusively to annotation projects", () => {
    expect(projectUsesProductionTargets("annotation")).toBe(true);
    expect(projectUsesProductionTargets("engineering")).toBe(false);
    expect(projectUsesProductionTargets("operations")).toBe(false);
    expect(projectUsesProductionTargets("hr")).toBe(false);
    expect(projectUsesProductionTargets("training")).toBe(false);
    expect(projectUsesProductionTargets("other")).toBe(false);
    expect(projectUsesProductionTargets(null)).toBe(false);
  });
});

describe("Attendance & EOD Separation", () => {
  it("keeps personal attendance check-in free of allocation gates for management roles and non-annotation workstreams", () => {
    expect(requiresAllocationForCheckIn({ roles: ["manager"], workType: null })).toBe(false);
    expect(requiresAllocationForCheckIn({ roles: ["hr"], workType: "hr" })).toBe(false);
    expect(requiresAllocationForCheckIn({ roles: ["admin"], workType: "operations" })).toBe(false);
    expect(requiresAllocationForCheckIn({ roles: ["super_admin"], workType: null })).toBe(false);

    expect(requiresAllocationForCheckIn({ roles: ["employee"], workType: "engineering" })).toBe(false);
    expect(requiresAllocationForCheckIn({ roles: ["employee"], workType: "operations" })).toBe(false);
    expect(requiresAllocationForCheckIn({ roles: ["employee"], workType: "hr" })).toBe(false);
    expect(requiresAllocationForCheckIn({ roles: ["employee"], workType: "training" })).toBe(false);
    expect(requiresAllocationForCheckIn({ roles: ["employee"], workType: "other" })).toBe(false);

    // Annotation and unclassified employees require acknowledged allocation
    expect(requiresAllocationForCheckIn({ roles: ["employee"], workType: "annotation" })).toBe(true);
    expect(requiresAllocationForCheckIn({ roles: ["employee"], workType: null })).toBe(true);
  });

  it("routes annotation contributors to annotation EOD mode and everyone else to general EOD mode", () => {
    expect(eodModeFor(makeProfile())).toBe("annotation");
    expect(eodModeFor(makeProfile({ workType: "engineering" }))).toBe("general");
    expect(eodModeFor(makeProfile({ roles: ["manager"] }))).toBe("general");
    expect(eodModeFor(makeProfile({ roles: ["hr"], category: "intern", workType: "hr" }))).toBe("general");
  });

  it("requires hourly task entries and coverage for annotation EOD, but allows general EOD without task entries", () => {
    const annotationProblems = validateEodSubmission({
      mode: "annotation",
      checkedIn: true,
      checkedOut: true,
      metrics: { ...EMPTY_METRICS, workedMinutes: 480, uncoveredMinutes: 480, entryCount: 0 },
      hasOpenBreak: false,
      highlights: "Worked on batch A",
      tomorrowPlan: "Continue batch B",
      openBlockers: 0,
    });
    expect(annotationProblems.some((p) => /Log at least one task entry/i.test(p))).toBe(true);
    expect(annotationProblems.some((p) => /not accounted for/i.test(p))).toBe(true);

    const generalProblems = validateEodSubmission({
      mode: "general",
      checkedIn: true,
      checkedOut: true,
      metrics: { ...EMPTY_METRICS, workedMinutes: 480, uncoveredMinutes: 480, entryCount: 0 },
      hasOpenBreak: false,
      highlights: "Sprint planning and vendor interviews",
      tomorrowPlan: "Code reviews and deployment",
      openBlockers: 0,
    });
    expect(generalProblems).toEqual([]);
  });
});

describe("Protected Super Admin Privacy & Exclusion", () => {
  it("identifies Super Admin accounts strictly by role", () => {
    expect(isProtectedAccount(["super_admin"])).toBe(true);
    expect(isProtectedAccount(["super_admin", "admin"])).toBe(true);
    expect(isProtectedAccount(["admin"])).toBe(false);
    expect(isProtectedAccount(["hr"])).toBe(false);
    expect(isProtectedAccount(["founder"])).toBe(false);
  });

  it("excludes protected Super Admin from profile rows and owner-keyed records without stripping unrelated record IDs", () => {
    const protectedIds = new Set(["user-sa-001"]);

    const profiles = [
      { id: "user-sa-001", name: "Super Admin" },
      { id: "user-emp-014", name: "Dinesh" },
    ];
    expect(excludeProtectedAccounts(profiles, protectedIds)).toEqual([
      { id: "user-emp-014", name: "Dinesh" },
    ]);

    const ownerRecords = [
      { id: "doc-1", user_id: "user-sa-001" },
      { id: "doc-2", user_id: "user-emp-014" },
      { id: "user-sa-001", user_id: "user-emp-015" }, // id collides safely, owner key is user_id
    ];
    expect(excludeProtectedAccounts(ownerRecords, protectedIds)).toEqual([
      { id: "doc-2", user_id: "user-emp-014" },
      { id: "user-sa-001", user_id: "user-emp-015" },
    ]);

    const camelRows = [
      { userId: "user-sa-001", total: 10 },
      { userId: "user-emp-014", total: 20 },
    ];
    expect(excludeProtectedAccounts(camelRows, protectedIds)).toEqual([
      { userId: "user-emp-014", total: 20 },
    ]);
  });

  it("blocks HR, Admin, Founder, Manager, Lead, and Employee from viewing Super Admin profile while preserving self-view", () => {
    for (const viewerRole of ["hr", "admin", "founder", "manager", "lead", "employee"] as const) {
      expect(
        canViewProtectedProfile({
          viewerId: "viewer-1",
          viewerRoles: [viewerRole],
          targetId: "user-sa-001",
          targetIsProtected: true,
        }),
      ).toBe(false);
    }

    expect(
      canViewProtectedProfile({
        viewerId: "user-sa-001",
        viewerRoles: ["super_admin"],
        targetId: "user-sa-001",
        targetIsProtected: true,
      }),
    ).toBe(true);
  });
});

