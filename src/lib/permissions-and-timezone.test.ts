import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  assignableRolesFor,
  canAssignRole,
  canModifyUserRoles,
  ROLE_RANKS,
  USER_CATEGORIES,
} from "./permissions";
import { istHoursMinutes, startOfMonthIso, todayIso } from "./timezone";

describe("7-role hierarchy & employment category separation", () => {
  it("defines the exact 7-tier role hierarchy in rank order", () => {
    expect(APP_ROLES).toEqual([
      "super_admin",
      "founder",
      "hr",
      "admin",
      "manager",
      "lead",
      "employee",
    ]);
    expect(ROLE_RANKS.super_admin).toBe(1);
    expect(ROLE_RANKS.founder).toBe(2);
    expect(ROLE_RANKS.hr).toBe(3);
    expect(ROLE_RANKS.admin).toBe(4);
    expect(ROLE_RANKS.manager).toBe(5);
    expect(ROLE_RANKS.lead).toBe(6);
    expect(ROLE_RANKS.employee).toBe(7);
  });

  it("maintains separate employee categories independent of roles", () => {
    expect(USER_CATEGORIES).toEqual(["full_time", "intern", "freelancer", "trainer"]);
  });
});

describe("RBAC role assignment authority (Super Admin, HR, Admin)", () => {
  it("grants Super Admin complete role assignment authority", () => {
    expect(assignableRolesFor(["super_admin"])).toEqual(APP_ROLES);
    for (const role of APP_ROLES) {
      expect(canAssignRole(["super_admin"], role)).toBe(true);
    }
    expect(canModifyUserRoles(["super_admin"], ["founder"])).toBe(true);
    expect(canModifyUserRoles(["super_admin"], ["hr"])).toBe(true);
    expect(canModifyUserRoles(["super_admin"], ["admin"])).toBe(true);
  });

  it("allows HR to assign and revoke Admin, Manager, Lead, and Employee, but not Super Admin, Founder, or HR", () => {
    expect(assignableRolesFor(["hr"])).toEqual(["admin", "manager", "lead", "employee"]);
    expect(canAssignRole(["hr"], "admin")).toBe(true);
    expect(canAssignRole(["hr"], "manager")).toBe(true);
    expect(canAssignRole(["hr"], "lead")).toBe(true);
    expect(canAssignRole(["hr"], "employee")).toBe(true);
    expect(canAssignRole(["hr"], "hr")).toBe(false);
    expect(canAssignRole(["hr"], "founder")).toBe(false);
    expect(canAssignRole(["hr"], "super_admin")).toBe(false);

    // HR can modify users holding admin, manager, lead, employee
    expect(canModifyUserRoles(["hr"], ["admin"])).toBe(true);
    expect(canModifyUserRoles(["hr"], ["manager", "lead"])).toBe(true);
    // HR cannot modify Super Admin, Founder, or peer HR accounts
    expect(canModifyUserRoles(["hr"], ["super_admin"])).toBe(false);
    expect(canModifyUserRoles(["hr"], ["founder"])).toBe(false);
    expect(canModifyUserRoles(["hr"], ["hr"])).toBe(false);
  });

  it("allows Admin to assign Manager, Lead, and Employee, but forbids Admin from granting or revoking Admin", () => {
    expect(assignableRolesFor(["admin"])).toEqual(["manager", "lead", "employee"]);
    expect(canAssignRole(["admin"], "admin")).toBe(false);
    expect(canAssignRole(["admin"], "hr")).toBe(false);
    expect(canAssignRole(["admin"], "founder")).toBe(false);
    expect(canAssignRole(["admin"], "super_admin")).toBe(false);
    expect(canAssignRole(["admin"], "manager")).toBe(true);
    expect(canAssignRole(["admin"], "lead")).toBe(true);
    expect(canAssignRole(["admin"], "employee")).toBe(true);

    // Admin cannot modify another Admin's roles
    expect(canModifyUserRoles(["admin"], ["admin"])).toBe(false);
    expect(canModifyUserRoles(["admin"], ["manager"])).toBe(true);
    expect(canModifyUserRoles(["admin"], ["lead"])).toBe(true);
  });

  it("forbids Founder, Manager, Lead, and Employee from assigning roles", () => {
    for (const role of ["founder", "manager", "lead", "employee"] as const) {
      expect(assignableRolesFor([role])).toEqual([]);
      expect(canModifyUserRoles([role], ["employee"])).toBe(false);
    }
  });
});

describe("IST (Asia/Kolkata) timezone helpers", () => {
  it("converts UTC evening timestamps across midnight into the next IST calendar date", () => {
    // 2026-11-10 20:00:00 UTC is 2026-11-11 01:30:00 IST (+05:30)
    const utcDate = new Date("2026-11-10T20:00:00.000Z");
    expect(todayIso(utcDate)).toBe("2026-11-11");
    expect(istHoursMinutes(utcDate)).toEqual({ hours: 1, minutes: 30 });
    expect(startOfMonthIso(utcDate)).toBe("2026-11-01");
  });
});

