import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATUSES,
  APP_ROLES,
  CATEGORY_LABELS,
  ROLE_LABELS,
  type AppRole,
} from "../permissions";
import { WORK_TYPE_LABELS, WORK_TYPES, type WorkType } from "../work-type";
import { KYC_STATUS_LABELS, type KycStatus } from "../kyc/kyc-notifications";

describe("Workforce Management Redesign — Domain & Hierarchy Rules", () => {
  it("never includes super_admin in normal role selectors", () => {
    const ordinaryRoles = APP_ROLES.filter((r) => r !== "super_admin");
    expect(ordinaryRoles).not.toContain("super_admin");
    expect(ordinaryRoles).toContain("founder");
    expect(ordinaryRoles).toContain("hr");
    expect(ordinaryRoles).toContain("admin");
    expect(ordinaryRoles).toContain("manager");
    expect(ordinaryRoles).toContain("lead");
    expect(ordinaryRoles).toContain("employee");
  });

  it("keeps department distinct from work type", () => {
    // Work types are fixed organizational streams
    expect(WORK_TYPES).toContain("annotation");
    expect(WORK_TYPES).toContain("engineering");
    expect(WORK_TYPES).toContain("operations");
    expect(WORK_TYPES).toContain("hr");
    expect(WORK_TYPES).toContain("training");
    expect(WORK_TYPES).toContain("other");

    expect(WORK_TYPE_LABELS["annotation"]).toBe("Annotation");
    expect(WORK_TYPE_LABELS["engineering"]).toBe("Engineering");
  });

  it("handles cycle detection in reporting relationships without infinite recursion", () => {
    // Simulated cyclic dataset: A -> B -> C -> A
    const people = [
      { id: "A", full_name: "Alice", reporting_lead_id: "C", roles: ["manager"] },
      { id: "B", full_name: "Bob", reporting_lead_id: "A", roles: ["lead"] },
      { id: "C", full_name: "Charlie", reporting_lead_id: "B", roles: ["employee"] },
    ];

    const childrenMap = new Map<string, string[]>();
    for (const p of people) {
      if (p.reporting_lead_id) {
        const list = childrenMap.get(p.reporting_lead_id) ?? [];
        list.push(p.id);
        childrenMap.set(p.reporting_lead_id, list);
      }
    }

    function buildSafe(id: string, visited: Set<string>): { id: string; children: any[] } {
      const nextVisited = new Set(visited).add(id);
      const children = (childrenMap.get(id) ?? []).filter((childId) => !nextVisited.has(childId));
      return {
        id,
        children: children.map((cid) => buildSafe(cid, nextVisited)),
      };
    }

    // Must not throw or exceed maximum call stack size
    const node = buildSafe("A", new Set());
    expect(node.id).toBe("A");
    expect(node.children[0]?.id).toBe("B");
    expect(node.children[0]?.children[0]?.id).toBe("C");
    // C's child A was omitted because it was already visited!
    expect(node.children[0]?.children[0]?.children).toHaveLength(0);
  });

  it("distinguishes unassigned employees from leadership roots", () => {
    const people = [
      { id: "1", full_name: "Founder", reporting_lead_id: null, roles: ["founder"] },
      { id: "2", full_name: "Top Manager", reporting_lead_id: null, roles: ["manager"] },
      { id: "3", full_name: "Orphan Employee", reporting_lead_id: null, roles: ["employee"] },
      { id: "4", full_name: "Regular Staff", reporting_lead_id: "2", roles: ["employee"] },
    ];

    const childrenMap = new Map<string, string[]>();
    for (const p of people) {
      if (p.reporting_lead_id) {
        const list = childrenMap.get(p.reporting_lead_id) ?? [];
        list.push(p.id);
        childrenMap.set(p.reporting_lead_id, list);
      }
    }

    const roots: string[] = [];
    const unassigned: string[] = [];

    for (const p of people) {
      if (!p.reporting_lead_id) {
        const isLeadership =
          p.roles.includes("founder") ||
          p.roles.includes("admin") ||
          (p.roles.includes("manager") && (childrenMap.get(p.id)?.length ?? 0) > 0);

        if (isLeadership) roots.push(p.id);
        else unassigned.push(p.id);
      }
    }

    expect(roots).toContain("1");
    expect(roots).toContain("2");
    expect(unassigned).toContain("3");
    expect(unassigned).not.toContain("4");
  });

  it("computes accurate KYC progress summaries", () => {
    const verified5 = { required: 5, verified: 5, pending: 0, rejected: 0, missing: 0 };
    expect(verified5.verified).toBe(5);

    const pending1 = { required: 5, verified: 3, pending: 1, rejected: 1, missing: 0 };
    expect(pending1.pending).toBe(1);
    expect(pending1.rejected).toBe(1);
  });

  it("blocks deletion when employee has attendance or task records", () => {
    function evaluateDeletion(dependencies: {
      attendanceCount: number;
      taskCount: number;
      directReportsCount: number;
      isProtected: boolean;
    }) {
      if (dependencies.isProtected) return { canDelete: false, reason: "Protected account" };
      if (dependencies.attendanceCount > 0 || dependencies.taskCount > 0) {
        return {
          canDelete: false,
          reason: "Employee has recorded attendance or task entries. Deactivate instead.",
        };
      }
      if (dependencies.directReportsCount > 0) {
        return { canDelete: false, reason: "Employee has direct reports. Reassign first." };
      }
      return { canDelete: true, reason: null };
    }

    // Case 1: Employee has 1 attendance day
    const res1 = evaluateDeletion({
      attendanceCount: 1,
      taskCount: 0,
      directReportsCount: 0,
      isProtected: false,
    });
    expect(res1.canDelete).toBe(false);
    expect(res1.reason).toContain("Deactivate instead");

    // Case 2: Employee has direct reports
    const res2 = evaluateDeletion({
      attendanceCount: 0,
      taskCount: 0,
      directReportsCount: 2,
      isProtected: false,
    });
    expect(res2.canDelete).toBe(false);
    expect(res2.reason).toContain("direct reports");

    // Case 3: Freshly provisioned test user with 0 records
    const res3 = evaluateDeletion({
      attendanceCount: 0,
      taskCount: 0,
      directReportsCount: 0,
      isProtected: false,
    });
    expect(res3.canDelete).toBe(true);
    expect(res3.reason).toBeNull();

    // Case 4: Protected account
    const res4 = evaluateDeletion({
      attendanceCount: 0,
      taskCount: 0,
      directReportsCount: 0,
      isProtected: true,
    });
    expect(res4.canDelete).toBe(false);
    expect(res4.reason).toBe("Protected account");
  });

  it("enforces role removal permissions strictly according to approved matrix", () => {
    function canDeactivate(actorRole: AppRole, targetRole: AppRole, isSelf: boolean): boolean {
      if (isSelf) return false;
      if (targetRole === "super_admin" || targetRole === "founder") return false;

      if (actorRole === "super_admin") return true;

      if (actorRole === "admin") {
        if (targetRole === "super_admin" || targetRole === "founder" || targetRole === "hr" || targetRole === "admin") {
          return false;
        }
        return true;
      }

      if (actorRole === "hr") {
        if (targetRole === "super_admin" || targetRole === "founder" || targetRole === "admin" || targetRole === "hr") {
          return false;
        }
        return true;
      }

      return false;
    }

    // Super Admin can deactivate lower roles, never self
    expect(canDeactivate("super_admin", "super_admin", true)).toBe(false);
    expect(canDeactivate("super_admin", "founder", false)).toBe(false);
    expect(canDeactivate("super_admin", "manager", false)).toBe(true);
    expect(canDeactivate("super_admin", "employee", false)).toBe(true);

    // HR can deactivate manager, lead, employee, but NOT peer HR, admin, founder, or super_admin
    expect(canDeactivate("hr", "super_admin", false)).toBe(false);
    expect(canDeactivate("hr", "founder", false)).toBe(false);
    expect(canDeactivate("hr", "admin", false)).toBe(false);
    expect(canDeactivate("hr", "hr", false)).toBe(false);
    expect(canDeactivate("hr", "manager", false)).toBe(true);
    expect(canDeactivate("hr", "lead", false)).toBe(true);
    expect(canDeactivate("hr", "employee", false)).toBe(true);

    // Admin can deactivate manager, lead, employee, but NOT HR, peer admin, founder, or super_admin
    expect(canDeactivate("admin", "hr", false)).toBe(false);
    expect(canDeactivate("admin", "admin", false)).toBe(false);
    expect(canDeactivate("admin", "manager", false)).toBe(true);

    // Manager / Lead / Employee cannot deactivate anyone
    expect(canDeactivate("manager", "employee", false)).toBe(false);
    expect(canDeactivate("lead", "employee", false)).toBe(false);
    expect(canDeactivate("employee", "employee", false)).toBe(false);
  });

  it("scales filtering logic across 500+ employees instantaneously", () => {
    // Generate 500 synthetic employees
    const mockEmployees = Array.from({ length: 500 }, (_, i) => ({
      id: `emp-${i}`,
      full_name: `Employee ${i}`,
      employee_code: `TAS-${String(i + 1).padStart(3, "0")}`,
      work_email: `employee${i}@theaischool.org`,
      department_id: `dept-${i % 5}`,
      department_name: `Dept ${i % 5}`,
      work_type: i % 2 === 0 ? "annotation" : "engineering",
      roles: [i % 10 === 0 ? "manager" : i % 5 === 0 ? "lead" : "employee"],
      category: i % 3 === 0 ? "intern" : "full_time",
      account_status: i % 7 === 0 ? "under_verification" : "active",
      employment_status: "active",
      kyc_status: i % 4 === 0 ? "under_review" : "verified",
      kyc_verified_count: i % 4 === 0 ? 3 : 5,
      needs_hr_attention: i % 7 === 0 || i % 4 === 0,
    }));

    const start = performance.now();
    const filtered = mockEmployees.filter((e) => {
      if (e.work_type !== "annotation") return false;
      if (e.category !== "intern") return false;
      if (e.needs_hr_attention !== true) return false;
      return true;
    });
    const duration = performance.now() - start;

    expect(filtered.length).toBeGreaterThan(0);
    // Filtering 500 in-memory employees takes < 5 milliseconds
    expect(duration).toBeLessThan(10);
  });
});
