import { describe, expect, it } from "vitest";
import { evaluateWfhAuthorization, evaluateWfoGeofence, type OfficeLocation } from "../geo";
import {
  canManageProjectInGraph,
  isManagerOfInGraph,
  type ScopedOrgGraph,
} from "../permissions";
import fs from "node:fs";
import path from "node:path";

describe("Manager Attendance Eligibility without Project Allocation", () => {
  it("permits WFH check-in for managers with an authorized remote profile even with zero project allocations", () => {
    const result = evaluateWfhAuthorization({
      projectWorkModes: [],
      hasApprovedWfhToday: false,
      isAuthorizedRemoteRole: true,
    });
    expect(result).toBe(true);
  });

  it("permits WFH check-in for managers with an approved WFH request today", () => {
    const result = evaluateWfhAuthorization({
      projectWorkModes: [],
      hasApprovedWfhToday: true,
      isAuthorizedRemoteRole: false,
    });
    expect(result).toBe(true);
  });

  it("blocks WFH check-in if manager has neither remote profile nor approved WFH request", () => {
    expect(() =>
      evaluateWfhAuthorization({
        projectWorkModes: [],
        hasApprovedWfhToday: false,
        isAuthorizedRemoteRole: false,
      }),
    ).toThrow(/requires an approved WFH request/i);
  });

  it("strictly enforces WFO geofence validation for managers (cannot bypass location)", () => {
    const hydOffice: OfficeLocation = {
      id: "office-hyd",
      name: "Hyderabad HQ",
      address: "Hyderabad",
      latitude: 17.448294,
      longitude: 78.391485,
      radius_meters: 200,
      is_active: true,
    };

    // Outside geofence (approx 12km away)
    expect(() =>
      evaluateWfoGeofence({ latitude: 17.385, longitude: 78.4866 }, [hydOffice]),
    ).toThrow(/outside the office/i);

    // Missing device location
    expect(() => evaluateWfoGeofence(null, [hydOffice])).toThrow(
      /Location access is required/i,
    );

    // Inside geofence (< 200m)
    const valid = evaluateWfoGeofence(
      { latitude: 17.4483, longitude: 78.3915 },
      [hydOffice],
    );
    expect(valid.location_status).toBe("verified");
    expect(valid.office_location_id).toBe("office-hyd");
  });
});

describe("Manager Project Creation Scoping & RBAC Rules", () => {
  const deptOps = "dept-operations";
  const deptEng = "dept-engineering";
  const deptAnnotation = "dept-annotation";
  const manager1 = "mgr-deepak";
  const manager2 = "mgr-dinesh";
  const lead1 = "lead-arun";
  const emp1 = "emp-annotation";
  const emp2 = "emp-engineering";

  // Mock scoped organization graph representing Deepak Boorla managing across departments
  const mockGraph: ScopedOrgGraph = {
    departmentManagers: new Map([
      [deptOps, new Set([manager1])], // Manager 1 in department_managers for Operations
      [deptEng, new Set([manager2])], // Manager 2 in department_managers for Engineering
    ]),
    projects: new Map([
      ["proj-ops", { id: "proj-ops", departmentId: deptOps, projectManagerId: manager1, leadUserIds: new Set([lead1]), createdBy: manager1 }],
      ["proj-eng-dinesh", { id: "proj-eng-dinesh", departmentId: deptEng, projectManagerId: manager2, leadUserIds: new Set(), createdBy: manager2 }],
      // Multi-department projects managed by Deepak Boorla:
      ["proj-eng-deepak", { id: "proj-eng-deepak", departmentId: deptEng, projectManagerId: manager1, leadUserIds: new Set([lead1]), createdBy: manager1 }],
      ["proj-anno-deepak", { id: "proj-anno-deepak", departmentId: deptAnnotation, projectManagerId: manager1, leadUserIds: new Set(), createdBy: manager1 }],
    ]),
    profiles: new Map([
      [manager1, { id: manager1, departmentId: deptOps, reportingLeadId: null }],
      [manager2, { id: manager2, departmentId: deptEng, reportingLeadId: null }],
      [lead1, { id: lead1, departmentId: deptAnnotation, reportingLeadId: manager1 }],
      [emp1, { id: emp1, departmentId: deptAnnotation, reportingLeadId: lead1 }],
      [emp2, { id: emp2, departmentId: deptEng, reportingLeadId: null }],
    ]),
    activeAllocationsByUser: new Map([
      [emp1, [{ projectId: "proj-anno-deepak", reportingLeadId: lead1 }]],
      [emp2, [{ projectId: "proj-eng-deepak", reportingLeadId: null }]],
    ]),
  };

  it("allows a Manager to manage projects across multiple departments (Operations, Engineering, Annotation)", () => {
    // Deepak managing Operations project
    expect(canManageProjectInGraph(mockGraph, "proj-ops", manager1, ["projects:manage:team"])).toBe(true);

    // Deepak managing Engineering project (even though Dinesh is the dept manager of Engineering)
    expect(canManageProjectInGraph(mockGraph, "proj-eng-deepak", manager1, ["projects:manage:team"])).toBe(true);

    // Deepak managing Annotation project (even though Deepak is not in department_managers for Annotation)
    expect(canManageProjectInGraph(mockGraph, "proj-anno-deepak", manager1, ["projects:manage:team"])).toBe(true);
  });

  it("strictly prevents Manager 1 from managing an unrelated Manager's project", () => {
    // Deepak cannot manage Dinesh's Engineering project
    const canManageDineshProj = canManageProjectInGraph(
      mockGraph,
      "proj-eng-dinesh",
      manager1,
      ["projects:manage:team"],
    );
    expect(canManageDineshProj).toBe(false);
  });

  it("allows Super Admin or Admin with projects:manage:all to manage any project across all departments", () => {
    expect(canManageProjectInGraph(mockGraph, "proj-ops", "admin-user", ["projects:manage:all"])).toBe(true);
    expect(canManageProjectInGraph(mockGraph, "proj-eng-dinesh", "admin-user", ["projects:manage:all"])).toBe(true);
    expect(canManageProjectInGraph(mockGraph, "proj-anno-deepak", "super-admin-user", ["projects:manage:all"])).toBe(true);
  });

  it("prevents unassigned managers from managing projects in departments they do not manage or own", () => {
    const unassignedMgr = "mgr-unassigned";
    expect(canManageProjectInGraph(mockGraph, "proj-ops", unassignedMgr, ["projects:manage:team"])).toBe(false);
    expect(canManageProjectInGraph(mockGraph, "proj-eng-deepak", unassignedMgr, ["projects:manage:team"])).toBe(false);
  });

  it("prohibits Project Leads, Employees, and Founders from managing projects", () => {
    // Project Leads hold interviews:feedback:assigned, but NOT projects:manage:team or projects:manage:all
    expect(canManageProjectInGraph(mockGraph, "proj-ops", lead1, [])).toBe(false);

    // Employees have no project management permission
    expect(canManageProjectInGraph(mockGraph, "proj-ops", emp1, ["projects:read:self"])).toBe(false);

    // Founders are strictly read-only: hold projects:read:all, but never projects:manage:team or projects:manage:all
    expect(canManageProjectInGraph(mockGraph, "proj-ops", "founder-user", ["projects:read:all"])).toBe(false);
  });

  it("allows a Manager to supervise employees allocated across multiple departments", () => {
    // Deepak supervises emp1 (allocated to Annotation project)
    expect(isManagerOfInGraph(mockGraph, emp1, manager1, ["manager"])).toBe(true);

    // Deepak supervises emp2 (allocated to Engineering project)
    expect(isManagerOfInGraph(mockGraph, emp2, manager1, ["manager"])).toBe(true);

    // Dinesh does NOT supervise emp1 (allocated to Deepak's Annotation project)
    expect(isManagerOfInGraph(mockGraph, emp1, manager2, ["manager"])).toBe(false);
  });

  it("verifies the database migration removes department restrictions on project insert and management", () => {
    const migrationFile = path.resolve(
      process.cwd(),
      "supabase/migrations/20261119120000_remove_manager_department_restriction.sql",
    );
    expect(fs.existsSync(migrationFile)).toBe(true);
    const sql = fs.readFileSync(migrationFile, "utf-8");

    // Must allow projects:manage:team where created_by = auth.uid() or project_manager_id = auth.uid()
    expect(sql).toContain("projects_insert");
    expect(sql).toContain("created_by = auth.uid()");
    expect(sql).toContain("project_manager_id = auth.uid()");

    // can_manage_project must include created_by and project_manager_id
    expect(sql).toContain("can_manage_project");
    expect(sql).toContain("p.created_by = _user_id");
    expect(sql).toContain("p.project_manager_id = _user_id");

    // can_view_project must include created_by and project_manager_id
    expect(sql).toContain("can_view_project");
  });
});
