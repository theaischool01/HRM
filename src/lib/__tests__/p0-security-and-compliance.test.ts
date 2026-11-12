import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isAdminTier, isLeadSubmitter, routeApproval } from "../approval-routing";
import {
  evaluateWfhAuthorization,
  evaluateWfoGeofence,
  type OfficeLocation,
} from "../geo";
import {
  APP_ROLES,
  canAccessEmployeeDocuments,
  canActorAssignRole,
  canExportReports,
  canManageProjectInGraph,
  canModifyUserRoles,
  canReviewSubordinateOrEscalateInGraph,
  isManagerOfInGraph,
  isReadOnlySafePermission,
  PERMISSION_KEYS,
  type ScopedOrgGraph,
} from "../permissions";
import { daysAgoIso, istHoursMinutes, startOfMonthIso, todayIso } from "../timezone";
import { reportFileName } from "../xlsx-export";

const repoRoot = resolve(__dirname, "../../..");
const p0MigrationSql = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20261111150000_p0_security_scoping_and_compliance.sql",
  ),
  "utf8",
);

describe("P0.1 — Founder strict read-only enforcement", () => {
  it("forbids Founder from holding any write, self-mutation, review, or raw KYC permission", () => {
    const allowedForFounder = PERMISSION_KEYS.filter(isReadOnlySafePermission);
    const forbiddenForFounder = PERMISSION_KEYS.filter((k) => !isReadOnlySafePermission(k));

    // Must allow read-only oversight + scoped report exports
    expect(allowedForFounder).toContain("workforce:read:all");
    expect(allowedForFounder).toContain("attendance:read:all");
    expect(allowedForFounder).toContain("analytics:read:all");
    expect(allowedForFounder).toContain("reports:export:scoped");
    expect(allowedForFounder).toContain("documents:read:self");

    // Must reject every write, self-write, approval, and third-party KYC read permission
    const mustForbid = [
      "workforce:create:all",
      "workforce:update:self",
      "workforce:update:all",
      "workforce:deactivate:all",
      "documents:read:team",
      "documents:read:all",
      "documents:upload:self",
      "documents:verify:all",
      "invitations:create:all",
      "rbac:manage:all",
      "rbac:assign:all",
      "org:manage:all",
      "projects:manage:team",
      "projects:manage:all",
      "allocations:manage:team",
      "allocations:manage:all",
      "allocations:acknowledge:self",
      "attendance:log:self",
      "attendance:update:all",
      "tasks:log:self",
      "tasks:review:team",
      "blockers:raise:self",
      "blockers:manage:team",
      "eod:submit:self",
      "eod:review:team",
      "requests:submit:self",
      "requests:approve:lead",
      "requests:approve:hr",
      "announcements:manage:all",
      "automation:run:all",
      "import:manage:all",
    ] as const;

    for (const key of mustForbid) {
      expect(forbiddenForFounder).toContain(key);
      expect(isReadOnlySafePermission(key)).toBe(false);
    }
  });

  it("removes Founder from operational Admin approval escalations", () => {
    expect(isAdminTier(["founder"])).toBe(false);
    expect(isAdminTier(["admin"])).toBe(true);
    expect(isAdminTier(["super_admin"])).toBe(true);
    expect(isLeadSubmitter(["manager"])).toBe(true);

    const leadSubmissionRoute = routeApproval({
      submitterRoles: ["lead"],
      reportingLeadId: "manager-1",
      adminApproverIds: ["admin-1", "super-admin-1"],
    });
    expect(leadSubmissionRoute.tier).toBe("admin");
    expect(leadSubmissionRoute.approverIds).toEqual(["admin-1", "super-admin-1"]);
  });

  it("enforces attendance:update:all (never attendance:read:all) in guard_attendance_self_update", () => {
    const fnMatch = p0MigrationSql.match(
      /CREATE OR REPLACE FUNCTION public\.guard_attendance_self_update\(\)[\s\S]*?\$function\$;/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain("public.has_permission(caller, 'attendance:update:all')");
    expect(fnMatch![0]).not.toContain("attendance:read:all");
    expect(p0MigrationSql).toContain("public.has_permission(auth.uid(), 'workforce:update:self')");
  });
});

describe("P0.2 — Authorized Founder & Manager reporting and export access", () => {
  it("permits Super Admin, Founder, HR, Admin, and Manager with scoped report permissions", () => {
    expect(canExportReports(["super_admin"], [])).toBe(true);
    expect(canExportReports(["founder"], ["reports:export:scoped", "analytics:read:all"])).toBe(
      true,
    );
    expect(canExportReports(["hr"], ["reports:export:scoped"])).toBe(true);
    expect(canExportReports(["admin"], ["analytics:read:all"])).toBe(true);
    expect(canExportReports(["manager"], ["reports:export:scoped", "analytics:read:team"])).toBe(
      true,
    );
  });

  it("blocks Lead and Employee from report export access even if holding team read keys", () => {
    expect(canExportReports(["lead"], ["attendance:read:team", "analytics:read:team"])).toBe(
      false,
    );
    expect(canExportReports(["employee"], ["attendance:read:self"])).toBe(false);
    expect(canExportReports(["founder"], ["attendance:read:all"])).toBe(false);
  });
});

describe("P0.3 & P0.4 — Manager department/project/Lead isolation & operational escalation reviews", () => {
  // Build a two-department org graph:
  // - Engineering ("dept-eng") managed by "mgr-eng"
  // - Sales ("dept-sales") managed by "mgr-sales"
  const orgGraph: ScopedOrgGraph = {
    departmentManagers: new Map([
      ["dept-eng", new Set(["mgr-eng"])],
      ["dept-sales", new Set(["mgr-sales"])],
    ]),
    profiles: new Map([
      ["mgr-eng", { id: "mgr-eng", departmentId: "dept-eng", reportingLeadId: null }],
      ["mgr-sales", { id: "mgr-sales", departmentId: "dept-sales", reportingLeadId: null }],
      ["lead-eng", { id: "lead-eng", departmentId: "dept-eng", reportingLeadId: "mgr-eng" }],
      ["emp-eng-direct", { id: "emp-eng-direct", departmentId: "dept-eng", reportingLeadId: "mgr-eng" }],
      ["emp-eng-2hop", { id: "emp-eng-2hop", departmentId: null, reportingLeadId: "lead-eng" }],
      ["emp-cross-proj", { id: "emp-cross-proj", departmentId: "dept-design", reportingLeadId: null }],
      ["lead-sales", { id: "lead-sales", departmentId: "dept-sales", reportingLeadId: "mgr-sales" }],
      ["emp-sales", { id: "emp-sales", departmentId: "dept-sales", reportingLeadId: "lead-sales" }],
    ]),
    projects: new Map([
      [
        "proj-eng",
        {
          id: "proj-eng",
          departmentId: "dept-eng",
          projectManagerId: "mgr-eng",
          leadUserIds: new Set(["lead-eng"]),
        },
      ],
      [
        "proj-special",
        {
          id: "proj-special",
          departmentId: null,
          projectManagerId: "mgr-eng",
          leadUserIds: new Set(),
        },
      ],
      [
        "proj-sales",
        {
          id: "proj-sales",
          departmentId: "dept-sales",
          projectManagerId: "mgr-sales",
          leadUserIds: new Set(["lead-sales"]),
        },
      ],
    ]),
    activeAllocationsByUser: new Map([
      ["emp-cross-proj", [{ projectId: "proj-special", reportingLeadId: null }]],
      ["emp-sales", [{ projectId: "proj-sales", reportingLeadId: "lead-sales" }]],
    ]),
  };

  it("grants Manager access to assigned department staff, direct reports, 2-hop Lead reports, and managed project members", () => {
    expect(isManagerOfInGraph(orgGraph, "lead-eng", "mgr-eng", ["manager"])).toBe(true);
    expect(isManagerOfInGraph(orgGraph, "emp-eng-direct", "mgr-eng", ["manager"])).toBe(true);
    expect(isManagerOfInGraph(orgGraph, "emp-eng-2hop", "mgr-eng", ["manager"])).toBe(true);
    expect(isManagerOfInGraph(orgGraph, "emp-cross-proj", "mgr-eng", ["manager"])).toBe(true);

    expect(
      canManageProjectInGraph(orgGraph, "proj-eng", "mgr-eng", ["projects:manage:team"]),
    ).toBe(true);
    expect(
      canManageProjectInGraph(orgGraph, "proj-special", "mgr-eng", ["projects:manage:team"]),
    ).toBe(true);
  });

  it("isolates Manager strictly from unrelated departments, unrelated projects, and self", () => {
    // Engineering manager MUST NOT access Sales lead, Sales employee, or Sales project
    expect(isManagerOfInGraph(orgGraph, "lead-sales", "mgr-eng", ["manager"])).toBe(false);
    expect(isManagerOfInGraph(orgGraph, "emp-sales", "mgr-eng", ["manager"])).toBe(false);
    expect(isManagerOfInGraph(orgGraph, "mgr-sales", "mgr-eng", ["manager"])).toBe(false);
    expect(isManagerOfInGraph(orgGraph, "mgr-eng", "mgr-eng", ["manager"])).toBe(false);

    expect(
      canManageProjectInGraph(orgGraph, "proj-sales", "mgr-eng", ["projects:manage:team"]),
    ).toBe(false);

    // Sales manager MUST NOT access Engineering staff or projects
    expect(isManagerOfInGraph(orgGraph, "emp-eng-direct", "mgr-sales", ["manager"])).toBe(false);
    expect(isManagerOfInGraph(orgGraph, "emp-eng-2hop", "mgr-sales", ["manager"])).toBe(false);
    expect(
      canManageProjectInGraph(orgGraph, "proj-eng", "mgr-sales", ["projects:manage:team"]),
    ).toBe(false);
  });

  it("permits operational escalation reviews by Super Admin, Admin, scoped Manager, and direct Lead while forbidding self-review and Founder", () => {
    // Direct Lead can review own subordinate, not unrelated employee, not self
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "emp-eng-2hop", "lead-eng", ["lead"]),
    ).toBe(true);
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "emp-sales", "lead-eng", ["lead"]),
    ).toBe(false);
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "lead-eng", "lead-eng", ["lead"]),
    ).toBe(false);

    // Scoped Manager can review subordinate Lead & team, NOT Sales employee, NOT self
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "lead-eng", "mgr-eng", ["manager"]),
    ).toBe(true);
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "emp-sales", "mgr-eng", ["manager"]),
    ).toBe(false);
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "mgr-eng", "mgr-eng", ["manager"]),
    ).toBe(false);

    // Operational escalation: Admin & Super Admin can review across departments, NEVER self
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "emp-sales", "admin-1", ["admin"]),
    ).toBe(true);
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "lead-eng", "sa-1", ["super_admin"]),
    ).toBe(true);
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "admin-1", "admin-1", ["admin"]),
    ).toBe(false);
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "sa-1", "sa-1", ["super_admin"]),
    ).toBe(false);

    // Founder cannot review anyone
    expect(
      canReviewSubordinateOrEscalateInGraph(orgGraph, "emp-sales", "founder-1", ["founder"]),
    ).toBe(false);
  });

  it("strips temporary org-wide :all permissions from manager in the P0 SQL migration", () => {
    expect(p0MigrationSql).toMatch(
      /DELETE FROM public\.role_permissions\s+WHERE role = 'manager'[\s\S]*?'workforce:read:all'[\s\S]*?'attendance:read:all'[\s\S]*?'projects:manage:all'/,
    );
    expect(p0MigrationSql).toContain("CREATE TABLE IF NOT EXISTS public.department_managers");
    expect(p0MigrationSql).toContain("ALTER TABLE public.department_managers ENABLE ROW LEVEL SECURITY;");
  });
});

describe("P0.5 — Hardened can_actor_assign_role privilege-escalation matrix", () => {
  it("enforces strict role-granting boundaries across Super Admin, HR, Admin, and protected accounts", () => {
    // Self-modification is universally blocked (even for Super Admin)
    for (const role of APP_ROLES) {
      expect(canActorAssignRole("u-1", ["super_admin"], "u-1", ["super_admin"], role)).toBe(false);
      expect(canActorAssignRole("u-2", ["hr"], "u-2", ["hr"], role)).toBe(false);
    }

    // HR can grant/revoke Admin, Manager, Lead, Employee on non-protected accounts
    expect(canActorAssignRole("hr-1", ["hr"], "emp-1", ["employee"], "admin")).toBe(true);
    expect(canActorAssignRole("hr-1", ["hr"], "adm-1", ["admin"], "admin")).toBe(true);
    expect(canActorAssignRole("hr-1", ["hr"], "emp-1", ["employee"], "manager")).toBe(true);

    // HR CANNOT touch another HR, Founder, or Super Admin, nor assign those roles
    expect(canActorAssignRole("hr-1", ["hr"], "hr-2", ["hr", "employee"], "admin")).toBe(false);
    expect(canActorAssignRole("hr-1", ["hr"], "fnd-1", ["founder"], "employee")).toBe(false);
    expect(canActorAssignRole("hr-1", ["hr"], "sa-1", ["super_admin"], "employee")).toBe(false);
    expect(canActorAssignRole("hr-1", ["hr"], "emp-1", ["employee"], "hr")).toBe(false);
    expect(canActorAssignRole("hr-1", ["hr"], "emp-1", ["employee"], "founder")).toBe(false);
    expect(canActorAssignRole("hr-1", ["hr"], "emp-1", ["employee"], "super_admin")).toBe(false);

    // Admin can manage Manager/Lead/Employee on non-Admin/non-HR accounts ONLY
    expect(canActorAssignRole("adm-1", ["admin"], "emp-1", ["employee"], "manager")).toBe(true);
    expect(canActorAssignRole("adm-1", ["admin"], "mgr-1", ["manager"], "lead")).toBe(true);
    expect(canActorAssignRole("adm-1", ["admin"], "emp-1", ["employee"], "admin")).toBe(false);
    expect(canActorAssignRole("adm-1", ["admin"], "adm-2", ["admin"], "lead")).toBe(false);
    expect(canActorAssignRole("adm-1", ["admin"], "hr-1", ["hr"], "lead")).toBe(false);
    expect(canModifyUserRoles(["admin"], ["hr"])).toBe(false);
  });

  it("mirrors target-account protection in SQL can_actor_assign_role", () => {
    expect(p0MigrationSql).toContain("_actor_id = _target_user_id");
    expect(p0MigrationSql).toMatch(
      /IF is_hr THEN[\s\S]*?role IN \('super_admin', 'founder', 'hr'\)/,
    );
    expect(p0MigrationSql).toMatch(
      /IF is_admin THEN[\s\S]*?role IN \('super_admin', 'founder', 'hr', 'admin'\)/,
    );
  });
});

describe("P0.6 — Employee ID sequence & RPC restriction", () => {
  it("revokes direct authenticated access to employee_id_sequence and claim_next_employee_id", () => {
    expect(p0MigrationSql).toContain(
      "REVOKE ALL ON TABLE public.employee_id_sequence FROM PUBLIC, anon, authenticated;",
    );
    expect(p0MigrationSql).toContain(
      "REVOKE ALL ON FUNCTION public.claim_next_employee_id() FROM PUBLIC, anon, authenticated;",
    );
    expect(p0MigrationSql).toContain("GRANT EXECUTE ON FUNCTION public.claim_next_employee_id() TO service_role;");
    expect(p0MigrationSql).toContain("Forbidden: not authorized to preview employee IDs.");
  });
});

describe("P0.7 — Sensitive employee KYC/financial document protection", () => {
  it("allows document access ONLY to the document owner, HR (with documents:read:all), and Super Admin", () => {
    // Owner can view own documents
    expect(canAccessEmployeeDocuments("emp-1", "emp-1", ["employee"], ["documents:read:self"])).toBe(
      true,
    );
    // Super Admin & HR can view employee documents
    expect(canAccessEmployeeDocuments("sa-1", "emp-1", ["super_admin"], [])).toBe(true);
    expect(canAccessEmployeeDocuments("hr-1", "emp-1", ["hr"], ["documents:read:all"])).toBe(true);

    // Admin, Founder, Manager, Lead, and peers MUST be denied
    expect(canAccessEmployeeDocuments("adm-1", "emp-1", ["admin"], ["workforce:read:all"])).toBe(
      false,
    );
    expect(canAccessEmployeeDocuments("fnd-1", "emp-1", ["founder"], ["workforce:read:all"])).toBe(
      false,
    );
    expect(
      canAccessEmployeeDocuments("mgr-1", "emp-1", ["manager"], ["workforce:read:team"]),
    ).toBe(false);
    expect(canAccessEmployeeDocuments("lead-1", "emp-1", ["lead"], ["workforce:read:team"])).toBe(
      false,
    );
    expect(
      canAccessEmployeeDocuments("emp-2", "emp-1", ["employee"], ["documents:read:self"]),
    ).toBe(false);
  });

  it("drops documents_select_team and restricts storage.objects verifier policy to HR & Super Admin", () => {
    expect(p0MigrationSql).toContain("DROP POLICY IF EXISTS documents_select_team ON public.documents;");
    expect(p0MigrationSql).toMatch(
      /CREATE POLICY "docs verifier read" ON storage\.objects[\s\S]*?public\.has_role\(auth\.uid\(\), 'hr'\)/,
    );
  });
});

describe("P0.9 — WFO geofence enforcement & authorized WFH attendance gate", () => {
  const hqOffice: OfficeLocation = {
    id: "office-hq",
    name: "Bengaluru HQ",
    address: "Indiranagar, Bengaluru",
    latitude: 12.9716,
    longitude: 77.5946,
    radius_meters: 150,
    is_active: true,
  };

  it("blocks WFO check-in when 0 active offices exist (eliminating the 'not_provided' bypass)", () => {
    expect(() =>
      evaluateWfoGeofence({ latitude: 12.9716, longitude: 77.5946 }, []),
    ).toThrow(/no active office geofence is configured/i);

    expect(() =>
      evaluateWfoGeofence(
        { latitude: 12.9716, longitude: 77.5946 },
        [{ ...hqOffice, is_active: false }],
      ),
    ).toThrow(/no active office geofence is configured/i);
  });

  it("blocks WFO check-in on missing, non-numeric, out-of-bounds, or out-of-radius coordinates", () => {
    expect(() => evaluateWfoGeofence(null, [hqOffice])).toThrow(/Location access is required/i);
    expect(() => evaluateWfoGeofence({ latitude: "", longitude: "" }, [hqOffice])).toThrow(
      /Location access is required/i,
    );
    expect(() => evaluateWfoGeofence({ latitude: 95, longitude: 77.59 }, [hqOffice])).toThrow(
      /Location access is required/i,
    );
    // ~1.5 km away -> outside 150 m radius
    expect(() =>
      evaluateWfoGeofence({ latitude: 12.985, longitude: 77.5946 }, [hqOffice]),
    ).toThrow(/outside the office/i);
  });

  it("verifies WFO check-in when coordinates fall inside an active office geofence", () => {
    const result = evaluateWfoGeofence(
      { latitude: 12.9718, longitude: 77.5947, accuracy: 18 },
      [hqOffice],
    );
    expect(result.location_status).toBe("verified");
    expect(result.office_location_id).toBe("office-hq");
    expect(result.location_distance_m).toBeLessThanOrEqual(150);
    expect(result.location_accuracy_m).toBe(18);
  });

  it("enforces authorized WFH rules (requires remote/hybrid project OR approved WFH request today)", () => {
    expect(() =>
      evaluateWfhAuthorization({
        projectWorkModes: [],
        hasApprovedWfhToday: false,
      }),
    ).toThrow(/requires an approved WFH request/i);

    expect(() =>
      evaluateWfhAuthorization({
        projectWorkModes: ["onsite", "onsite"],
        hasApprovedWfhToday: false,
      }),
    ).toThrow(/requires an approved WFH request/i);

    expect(
      evaluateWfhAuthorization({
        projectWorkModes: ["onsite"],
        hasApprovedWfhToday: true,
      }),
    ).toBe(true);

    expect(
      evaluateWfhAuthorization({
        projectWorkModes: ["onsite", "hybrid"],
        hasApprovedWfhToday: false,
      }),
    ).toBe(true);

    expect(
      evaluateWfhAuthorization({
        projectWorkModes: ["remote"],
        hasApprovedWfhToday: false,
      }),
    ).toBe(true);
  });
});

describe("P0.8 & P0.10 — Auth recovery routes, secret hygiene & IST midnight date boundary", () => {
  it("contains zero live credentials or hardcoded fallback keys in .env.example and Supabase clients", () => {
    const envExample = readFileSync(resolve(repoRoot, ".env.example"), "utf8");
    const browserClient = readFileSync(
      resolve(repoRoot, "src/integrations/supabase/client.ts"),
      "utf8",
    );
    const authMiddleware = readFileSync(
      resolve(repoRoot, "src/integrations/supabase/auth-middleware.ts"),
      "utf8",
    );

    for (const content of [envExample, browserClient, authMiddleware]) {
      expect(content).not.toContain("odowmzjjnfjaotpctper");
      expect(content).not.toContain("theaischool@531");
      expect(content).not.toMatch(/sb_secret_[A-Za-z0-9_-]{10,}/);
      expect(content).not.toMatch(/sb_publishable_[A-Za-z0-9_-]{10,}/);
    }
  });

  it("computes IST (Asia/Kolkata) calendar dates accurately across the 00:00–05:29 IST midnight window", () => {
    // 2026-11-30T21:15:00Z = 2026-12-01 02:45 IST (UTC is still Nov 30, IST is Dec 1!)
    const crossMonthInstant = new Date("2026-11-30T21:15:00.000Z");
    expect(todayIso(crossMonthInstant)).toBe("2026-12-01");
    expect(startOfMonthIso(crossMonthInstant)).toBe("2026-12-01");
    expect(daysAgoIso(1, crossMonthInstant)).toBe("2026-11-30");
    expect(istHoursMinutes(crossMonthInstant)).toEqual({ hours: 2, minutes: 45 });

    const fname = reportFileName("attendance", "2026-11-01", "2026-11-30", "csv");
    expect(fname).toMatch(/^attendance_2026-11-01_to_2026-11-30_generated_\d{8}\.csv$/);
  });
});
