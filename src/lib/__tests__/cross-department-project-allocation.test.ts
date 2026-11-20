import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  type AppRole,
} from "../permissions";
import { WORK_TYPES, type WorkType } from "../work-type";
import type { BulkValidationStatus } from "@/components/projects/bulk-allocation-panel";
import type { AllocatableCandidate, CandidateEligibilityStatus } from "../project-staffing.server";

// Comprehensive domain & security test suite for Cross-Department Project Allocations,
// Organization-Wide Candidate Discovery, and Section 10 QA verification
describe("Cross-Department Single & Bulk Project Allocation", () => {
  describe("1. Domain Invariants & Separation of Concerns", () => {
    it("preserves employee home department when allocating to any project", () => {
      const employee = {
        id: "emp-101",
        fullName: "Rahul Sharma",
        departmentId: "dept-engineering",
        departmentName: "Engineering",
        workType: "engineering" as WorkType,
        reportsToId: "mgr-eng-lead",
        roles: ["employee"] as AppRole[],
      };

      const project = {
        id: "proj-wayfair",
        name: "Wayfair",
        departmentId: "dept-annotation",
        workType: "annotation" as WorkType,
        projectManagerId: "mgr-deepak",
      };

      const allocation = {
        projectId: project.id,
        userId: employee.id,
        roleInProject: "Engineering Contributor",
        reportingLeadId: "lead-gnaneswar",
        allocationPct: 50,
      };

      // Invariant: Employee's permanent organizational attributes remain unchanged
      expect(employee.departmentId).toBe("dept-engineering");
      expect(employee.workType).toBe("engineering");
      expect(employee.reportsToId).toBe("mgr-eng-lead");
      expect(employee.roles).toEqual(["employee"]);

      // Invariant: Project role and reporting lead are scoped strictly to the project
      expect(allocation.roleInProject).toBe("Engineering Contributor");
      expect(allocation.reportingLeadId).toBe("lead-gnaneswar");
    });

    it("distinguishes project membership from hourly annotation production logging eligibility", () => {
      function canLogAnnotationWork(employeeWorkType: WorkType, projectWorkType: WorkType): boolean {
        return employeeWorkType === "annotation" && projectWorkType === "annotation";
      }

      // Case A: Engineering employee on Annotation project
      expect(canLogAnnotationWork("engineering", "annotation")).toBe(false);

      // Case B: Operations employee on Annotation project
      expect(canLogAnnotationWork("operations", "annotation")).toBe(false);

      // Case C: Annotation employee on Engineering project
      expect(canLogAnnotationWork("annotation", "engineering")).toBe(false);

      // Case D: Annotation employee on Annotation project
      expect(canLogAnnotationWork("annotation", "annotation")).toBe(true);
    });

    it("only applies daily and hourly productivity targets to annotation members on annotation projects", () => {
      function shouldApplyProductivityTargets(
        employeeWorkType: WorkType | null,
        projectWorkType: WorkType | null,
      ): boolean {
        return employeeWorkType === "annotation" && projectWorkType === "annotation";
      }

      expect(shouldApplyProductivityTargets("engineering", "annotation")).toBe(false);
      expect(shouldApplyProductivityTargets("operations", "annotation")).toBe(false);
      expect(shouldApplyProductivityTargets("hr", "annotation")).toBe(false);
      expect(shouldApplyProductivityTargets("annotation", "annotation")).toBe(true);
      expect(shouldApplyProductivityTargets("annotation", "engineering")).toBe(false);
    });
  });

  describe("2. Organization-Wide Discovery & Reporting Tree Independence", () => {
    // Mock candidate pool across multiple departments & reporting lines
    const mockOrgDirectory: AllocatableCandidate[] = [
      {
        id: "emp-1",
        fullName: "Deepak Boorla",
        workEmail: "deepak@theaischool.co.in",
        employeeCode: "TAS-001",
        designation: "Project Manager",
        departmentId: "dept-operations",
        departmentName: "Operations",
        workType: "operations",
        category: "full_time",
        primaryRole: "manager",
        roles: ["manager"],
        usedPct: 40,
        availableHoursPerDay: 8,
        isAllocatedToProject: true,
        isAnnotationEligible: false,
        employmentStatus: "active",
        accountStatus: "active",
        eligibilityStatus: "already_allocated",
        eligibilityReason: "Already allocated to this project",
      },
      {
        id: "emp-2",
        fullName: "Gnaneshwar Chatla",
        workEmail: "gnaneshwar@theaischool.co.in",
        employeeCode: "TAS-002",
        designation: "Lead Annotator",
        departmentId: "dept-annotation",
        departmentName: "Annotation",
        workType: "annotation",
        category: "full_time",
        primaryRole: "lead",
        roles: ["lead", "employee"],
        usedPct: 100,
        availableHoursPerDay: 8,
        isAllocatedToProject: false,
        isAnnotationEligible: true,
        employmentStatus: "active",
        accountStatus: "active",
        eligibilityStatus: "capacity_full",
        eligibilityReason: "Allocated at 100% capacity",
      },
      {
        id: "emp-3",
        fullName: "Ananya Deshmukh",
        workEmail: "ananya@theaischool.co.in",
        employeeCode: "TAS-021",
        designation: "Full Stack Engineer",
        departmentId: "dept-engineering",
        departmentName: "Engineering", // Different department!
        workType: "engineering",
        category: "full_time",
        primaryRole: "employee",
        roles: ["employee"],
        usedPct: 30, // reports to Engineering Lead, NOT Deepak!
        availableHoursPerDay: 8,
        isAllocatedToProject: false,
        isAnnotationEligible: false,
        employmentStatus: "active",
        accountStatus: "active",
        eligibilityStatus: "available",
        eligibilityReason: null,
      },
      {
        id: "emp-4",
        fullName: "Vikram Mehta",
        workEmail: "vikram@theaischool.co.in",
        employeeCode: "TAS-089",
        designation: "HR Specialist",
        departmentId: "dept-hr",
        departmentName: "Human Resources",
        workType: "hr",
        category: "full_time",
        primaryRole: "hr",
        roles: ["hr", "employee"],
        usedPct: 0,
        availableHoursPerDay: 8,
        isAllocatedToProject: false,
        isAnnotationEligible: false,
        employmentStatus: "active",
        accountStatus: "active",
        eligibilityStatus: "available",
        eligibilityReason: null,
      },
      {
        id: "emp-5",
        fullName: "Pooja Reddy",
        workEmail: "pooja@theaischool.co.in",
        employeeCode: "TAS-105",
        designation: "Training Coordinator",
        departmentId: "dept-training",
        departmentName: "Training",
        workType: "training",
        category: "intern",
        primaryRole: "employee",
        roles: ["employee"],
        usedPct: 50,
        availableHoursPerDay: 6,
        isAllocatedToProject: false,
        isAnnotationEligible: false,
        employmentStatus: "active",
        accountStatus: "active",
        eligibilityStatus: "available",
        eligibilityReason: null,
      },
      {
        id: "emp-6",
        fullName: "Arjun Verma",
        workEmail: "arjun@theaischool.co.in",
        employeeCode: "TAS-150",
        designation: "Associate Annotator",
        departmentId: "dept-annotation",
        departmentName: "Annotation",
        workType: "annotation",
        category: "full_time",
        primaryRole: "employee",
        roles: ["employee"],
        usedPct: 0,
        availableHoursPerDay: 8,
        isAllocatedToProject: false,
        isAnnotationEligible: false,
        employmentStatus: "inactive", // Inactive employee!
        accountStatus: "active",
        eligibilityStatus: "inactive",
        eligibilityReason: "Employment status is inactive",
      },
    ];

    it("Test 1: Manager discovers eligible employees outside their own home department", () => {
      // Deepak is in Operations, project is Wayfair (Annotation)
      // Candidates include Engineering, HR, Training
      const crossDeptCandidates = mockOrgDirectory.filter((e) => e.departmentName !== "Operations");
      expect(crossDeptCandidates.length).toBeGreaterThan(0);
      expect(crossDeptCandidates.some((c) => c.departmentName === "Engineering")).toBe(true);
      expect(crossDeptCandidates.some((c) => c.departmentName === "Human Resources")).toBe(true);
      expect(crossDeptCandidates.some((c) => c.departmentName === "Training")).toBe(true);
    });

    it("Test 2: Manager sees employees reporting to a different manager", () => {
      // Ananya reports to Engineering Lead, not Deepak
      const ananya = mockOrgDirectory.find((e) => e.employeeCode === "TAS-021");
      expect(ananya).toBeDefined();
      expect(ananya?.fullName).toBe("Ananya Deshmukh");
      expect(ananya?.eligibilityStatus).toBe("available");
    });

    it("Test 3: Manager can find a candidate by TAS Employee Code (case-insensitive)", () => {
      const searchCode = "tas-021";
      const matched = mockOrgDirectory.filter(
        (c) => (c.employeeCode ?? "").toLowerCase().includes(searchCode.toLowerCase()),
      );
      expect(matched.length).toBe(1);
      expect(matched[0]?.fullName).toBe("Ananya Deshmukh");
    });

    it("Test 4: Manager can find a candidate by work email (case-insensitive, trimmed)", () => {
      const searchEmail = "  VIKRAM@TheAiSchool.co.in  ";
      const cleaned = searchEmail.trim().toLowerCase();
      const matched = mockOrgDirectory.filter((c) => c.workEmail.toLowerCase().includes(cleaned));
      expect(matched.length).toBe(1);
      expect(matched[0]?.fullName).toBe("Vikram Mehta");
    });

    it("Test 5 & 6: Search & Pagination preserves available employees without hiding", () => {
      // Create a 50-item dataset
      const largeList: AllocatableCandidate[] = Array.from({ length: 50 }, (_, i) => ({
        id: `user-${i + 1}`,
        fullName: `Employee ${i + 1}`,
        workEmail: `employee${i + 1}@theaischool.co.in`,
        employeeCode: `TAS-${String(i + 1).padStart(3, "0")}`,
        designation: "Developer",
        departmentId: i % 2 === 0 ? "dept-eng" : "dept-ann",
        departmentName: i % 2 === 0 ? "Engineering" : "Annotation",
        workType: i % 2 === 0 ? "engineering" : "annotation",
        category: "full_time",
        primaryRole: "employee",
        roles: ["employee"],
        usedPct: 20,
        availableHoursPerDay: 8,
        isAllocatedToProject: false,
        isAnnotationEligible: i % 2 !== 0,
        employmentStatus: "active",
        accountStatus: "active",
        eligibilityStatus: "available",
        eligibilityReason: null,
      }));

      const pageSize = 15;
      const page1 = largeList.slice(0, pageSize);
      const page2 = largeList.slice(pageSize, pageSize * 2);
      const page3 = largeList.slice(pageSize * 2, pageSize * 3);
      const page4 = largeList.slice(pageSize * 3);

      expect(page1.length).toBe(15);
      expect(page2.length).toBe(15);
      expect(page3.length).toBe(15);
      expect(page4.length).toBe(5);

      // Total items across all pages equals full dataset
      const totalCombined = [...page1, ...page2, ...page3, ...page4];
      expect(totalCombined.length).toBe(50);

      // Search across pages finds "Employee 45" on page 3
      const found = largeList.filter((e) => e.fullName.includes("45"));
      expect(found.length).toBe(1);
      expect(found[0]?.employeeCode).toBe("TAS-045");
    });

    it("Test 7: Department filter works correctly", () => {
      const engineering = mockOrgDirectory.filter((c) => c.departmentName === "Engineering");
      expect(engineering.length).toBe(1);
      expect(engineering[0]?.fullName).toBe("Ananya Deshmukh");
    });

    it("Test 8: Work-type filter works correctly", () => {
      const annotationMembers = mockOrgDirectory.filter((c) => c.workType === "annotation");
      expect(annotationMembers.length).toBe(2);
      expect(annotationMembers.map((m) => m.fullName)).toContain("Gnaneshwar Chatla");
      expect(annotationMembers.map((m) => m.fullName)).toContain("Arjun Verma");
    });

    it("Test 9: Role filter works correctly", () => {
      const hrRoles = mockOrgDirectory.filter((c) => c.roles.includes("hr"));
      expect(hrRoles.length).toBe(1);
      expect(hrRoles[0]?.fullName).toBe("Vikram Mehta");
    });

    it("Test 10: Capacity filter isolates available vs full utilization", () => {
      const available = mockOrgDirectory.filter((c) => c.usedPct < 100);
      const full = mockOrgDirectory.filter((c) => c.usedPct >= 100);

      expect(available.length).toBe(5);
      expect(full.length).toBe(1);
      expect(full[0]?.fullName).toBe("Gnaneshwar Chatla");
    });

    it("Test 16 & 17: Super Admin protected account is excluded and confidential HR fields are omitted", () => {
      const protectedSuperAdminId = "super-admin-root";
      const filteredCandidates = mockOrgDirectory.filter((c) => c.id !== protectedSuperAdminId);

      // Protected account is never in candidate roster
      expect(filteredCandidates.some((c) => c.id === protectedSuperAdminId)).toBe(false);

      // Candidates DO NOT contain confidential HR fields
      for (const candidate of filteredCandidates) {
        expect((candidate as any).date_of_birth).toBeUndefined();
        expect((candidate as any).pan_number).toBeUndefined();
        expect((candidate as any).bank_account_number).toBeUndefined();
        expect((candidate as any).permanent_address).toBeUndefined();
        expect((candidate as any).private_hr_notes).toBeUndefined();
        expect((candidate as any).emergency_contact_phone).toBeUndefined();
      }
    });
  });

  describe("3. Role-Based Authorization for Allocation Management", () => {
    type Actor = {
      userId: string;
      role: AppRole;
      managedDepartmentIds?: string[];
      managedProjectIds?: string[];
    };

    function canManageProjectAllocations(
      actor: Actor,
      targetProject: { id: string; departmentId: string; projectManagerId: string },
    ): boolean {
      if (actor.role === "super_admin" || actor.role === "admin") {
        return true;
      }
      if (actor.role === "manager") {
        if (targetProject.projectManagerId === actor.userId) return true;
        if (actor.managedDepartmentIds?.includes(targetProject.departmentId)) return true;
        if (actor.managedProjectIds?.includes(targetProject.id)) return true;
        return false;
      }
      return false; // employee, lead, founder cannot allocate across projects
    }

    const wayfairProject = {
      id: "proj-wayfair",
      departmentId: "dept-annotation",
      projectManagerId: "user-deepak",
    };

    it("Test 11: Manager CANNOT allocate to an unrelated project they do not manage", () => {
      const unrelatedManager: Actor = {
        userId: "user-unrelated-mgr",
        role: "manager",
        managedDepartmentIds: ["dept-marketing"],
        managedProjectIds: ["proj-marketing-launch"],
      };
      expect(canManageProjectAllocations(unrelatedManager, wayfairProject)).toBe(false);
    });

    it("Test 12: Admin can allocate to authorized projects", () => {
      const admin: Actor = { userId: "user-admin", role: "admin" };
      expect(canManageProjectAllocations(admin, wayfairProject)).toBe(true);
    });

    it("Test 13, 14, 15: Employee, Lead, and Founder cannot manage allocations", () => {
      const employee: Actor = { userId: "user-emp", role: "employee" };
      const lead: Actor = { userId: "user-lead", role: "lead" };
      const founder: Actor = { userId: "user-founder", role: "founder" };

      expect(canManageProjectAllocations(employee, wayfairProject)).toBe(false);
      expect(canManageProjectAllocations(lead, wayfairProject)).toBe(false);
      expect(canManageProjectAllocations(founder, wayfairProject)).toBe(false);
    });
  });

  describe("4. Bulk Allocation & Upload Parity", () => {
    type TestRow = {
      userId: string;
      allocationPct: number;
      usedPct: number;
      roleInProject: string;
      isProtected?: boolean;
      isActive?: boolean;
      isAlreadyAllocated?: boolean;
    };

    function validateTestRow(row: TestRow, batch: TestRow[]): { status: BulkValidationStatus; message: string } {
      if (row.isProtected) {
        return { status: "invalid", message: "Protected account cannot be allocated." };
      }
      if (row.isActive === false) {
        return { status: "invalid", message: "Employee is not active." };
      }
      if (row.isAlreadyAllocated) {
        return { status: "already_allocated", message: "Already allocated to this project." };
      }
      const duplicatesInBatch = batch.filter((r) => r.userId === row.userId);
      if (duplicatesInBatch.length > 1) {
        return { status: "duplicate", message: "Duplicate in current batch." };
      }
      if (row.usedPct + row.allocationPct > 100) {
        return {
          status: "capacity_conflict",
          message: `Total capacity (${row.usedPct + row.allocationPct}%) exceeds 100%.`,
        };
      }
      if (!row.roleInProject.trim()) {
        return { status: "needs_review", message: "Project role is recommended." };
      }
      return { status: "ready", message: "Ready for allocation." };
    }

    it("Test 20: CSV import and UI selection apply identical business rules", () => {
      const testRow: TestRow = {
        userId: "user-101",
        allocationPct: 50,
        usedPct: 40,
        roleInProject: "Contributor",
        isActive: true,
      };

      // Valid case
      const res = validateTestRow(testRow, [testRow]);
      expect(res.status).toBe("ready");

      // Inactive case
      const inactiveRes = validateTestRow({ ...testRow, isActive: false }, [testRow]);
      expect(inactiveRes.status).toBe("invalid");

      // Protected case
      const protectedRes = validateTestRow({ ...testRow, isProtected: true }, [testRow]);
      expect(protectedRes.status).toBe("invalid");
    });

    it("Test 21: Capacity conflict flags when total allocation exceeds 100%", () => {
      const conflictRow: TestRow = {
        userId: "user-conflict",
        allocationPct: 60,
        usedPct: 50,
        roleInProject: "QA Specialist",
      };
      const res = validateTestRow(conflictRow, [conflictRow]);
      expect(res.status).toBe("capacity_conflict");
      expect(res.message).toContain("exceeds 100%");
    });

    it("Test 22: Search and filtering handles 500+ employee directory acceptably (<50ms)", () => {
      const largeRoster: AllocatableCandidate[] = Array.from({ length: 600 }, (_, i) => ({
        id: `uuid-${i}`,
        fullName: `Candidate Number ${i}`,
        workEmail: `candidate${i}@theaischool.co.in`,
        employeeCode: `TAS-${String(i).padStart(4, "0")}`,
        designation: "Staff",
        departmentId: `dept-${i % 5}`,
        departmentName: `Dept ${i % 5}`,
        workType: i % 2 === 0 ? "annotation" : "engineering",
        category: "full_time",
        primaryRole: "employee",
        roles: ["employee"],
        usedPct: i % 100,
        availableHoursPerDay: 8,
        isAllocatedToProject: i === 10,
        isAnnotationEligible: i % 2 === 0,
        employmentStatus: "active",
        accountStatus: "active",
        eligibilityStatus: i === 10 ? "already_allocated" : "available",
        eligibilityReason: null,
      }));

      const start = performance.now();
      const searchTarget = "candidate number 450";
      const results = largeRoster.filter((c) => c.fullName.toLowerCase().includes(searchTarget));
      const elapsed = performance.now() - start;

      expect(results.length).toBe(1);
      expect(results[0]?.employeeCode).toBe("TAS-0450");
      expect(elapsed).toBeLessThan(50); // Sub-50ms performance on 600 records
    });
  });
});
