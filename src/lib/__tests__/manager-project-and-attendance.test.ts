import { describe, expect, it } from "vitest";
import { evaluateWfhAuthorization, evaluateWfoGeofence, type OfficeLocation } from "../geo";
import {
  canManageProjectInGraph,
  type ScopedOrgGraph,
} from "../permissions";

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
      code: "HYD-01",
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
  const manager1 = "mgr-deepak";
  const manager2 = "mgr-dinesh";

  // Mock scoped organization graph
  const mockGraph: ScopedOrgGraph = {
    departmentManagers: new Map([
      [deptOps, new Set([manager1])], // Manager 1 manages Operations
      [deptEng, new Set([manager2])], // Manager 2 manages Engineering
    ]),
    projects: new Map([
      ["proj-1", { id: "proj-1", departmentId: deptOps, projectManagerId: manager1, leadUserIds: new Set() }],
      ["proj-2", { id: "proj-2", departmentId: deptEng, projectManagerId: manager2, leadUserIds: new Set() }],
    ]),
    profiles: new Map([
      [manager1, { id: manager1, departmentId: deptOps, reportingLeadId: null }],
      [manager2, { id: manager2, departmentId: deptEng, reportingLeadId: null }],
    ]),
    activeAllocationsByUser: new Map(),
  };

  it("allows a scoped Manager to manage projects in their assigned department", () => {
    const canManageOps = canManageProjectInGraph(
      mockGraph,
      "proj-1",
      manager1,
      ["projects:manage:team"],
    );
    expect(canManageOps).toBe(true);
  });

  it("strictly prevents Manager 1 from managing projects in Manager 2's department", () => {
    const canManageEng = canManageProjectInGraph(
      mockGraph,
      "proj-2",
      manager1,
      ["projects:manage:team"],
    );
    expect(canManageEng).toBe(false);
  });

  it("allows Super Admin or Admin with projects:manage:all to manage any project", () => {
    const canAdminManage = canManageProjectInGraph(
      mockGraph,
      "proj-2",
      "admin-user",
      ["projects:manage:all"],
    );
    expect(canAdminManage).toBe(true);
  });

  it("prevents unassigned managers from managing projects in any department", () => {
    const unassignedMgr = "mgr-unassigned";
    const canManage = canManageProjectInGraph(
      mockGraph,
      "proj-1",
      unassignedMgr,
      ["projects:manage:team"],
    );
    expect(canManage).toBe(false);
  });
});
