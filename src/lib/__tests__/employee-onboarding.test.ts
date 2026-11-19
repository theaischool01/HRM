import { describe, expect, it } from "vitest";
import {
  gridToOnboardingRows,
  validateDateOfBirth,
  normaliseRole,
  normaliseCategory,
  normaliseWorkType,
  onboardingRolesFor,
  validateOnboardingRows,
  summariseOnboardingRows,
  isCreatableRow,
  deriveSetupEmailStatus,
  ONBOARDING_REQUIRED_COLUMNS,
  FORBIDDEN_IMPORT_COLUMNS,
  type OnboardingLookups,
  type OnboardingRawRow,
} from "../onboarding/employee-onboarding";
import { redactSetupLink } from "../emails/account-setup-email";
import {
  DAY_SLOTS,
  LEGACY_SLOT_09_10,
  getVisibleDaySlots,
  slotKeyOf,
  slotRange,
} from "../slots";
import { evaluateAnnotationContributor } from "../work-type";

describe("Part A — Employee Onboarding: Date of Birth Validation", () => {
  const todayIso = "2026-11-18";

  it("accepts valid ISO YYYY-MM-DD within 16 to 80 years old", () => {
    // 25 years old
    const res1 = validateDateOfBirth("2001-05-14", todayIso);
    expect(res1.ok).toBe(true);
    if (res1.ok) expect(res1.value).toBe("2001-05-14");

    // Exactly 16 years old
    const res2 = validateDateOfBirth("2010-11-18", todayIso);
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.value).toBe("2010-11-18");

    // Exactly 80 years old
    const res3 = validateDateOfBirth("1946-11-18", todayIso);
    expect(res3.ok).toBe(true);
    if (res3.ok) expect(res3.value).toBe("1946-11-18");
  });

  it("normalises common date variants like DD/MM/YYYY and DD-MM-YYYY", () => {
    const res1 = validateDateOfBirth("14/05/2001", todayIso);
    expect(res1.ok).toBe(true);
    if (res1.ok) expect(res1.value).toBe("2001-05-14");

    const res2 = validateDateOfBirth("14-05-2001", todayIso);
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.value).toBe("2001-05-14");
  });

  it("rejects future dates", () => {
    const res = validateDateOfBirth("2027-01-01", todayIso);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("future");
  });

  it("rejects employees under 16 years old", () => {
    // 15 years old
    const res = validateDateOfBirth("2011-12-01", todayIso);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("at least 16 years old");
  });

  it("rejects employees over 80 years old or impossible centuries", () => {
    // 81 years old
    const res1 = validateDateOfBirth("1940-01-01", todayIso);
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.reason).toContain("implausible");

    // Year 1800
    const res2 = validateDateOfBirth("1800-01-01", todayIso);
    expect(res2.ok).toBe(false);
  });

  it("rejects impossible calendar dates like 31 Feb", () => {
    const res = validateDateOfBirth("2000-02-30", todayIso);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("real date");
  });

  it("rejects empty, gibberish or invalid formats", () => {
    expect(validateDateOfBirth("", todayIso).ok).toBe(false);
    expect(validateDateOfBirth("invalid-date", todayIso).ok).toBe(false);
    expect(validateDateOfBirth("99/99/9999", todayIso).ok).toBe(false);
  });
});

describe("Part A — Employee Onboarding: Field Normalisation & RBAC Role Boundaries", () => {
  it("normalises valid roles correctly", () => {
    expect(normaliseRole("founder")).toBe("founder");
    expect(normaliseRole("hr")).toBe("hr");
    expect(normaliseRole("Human Resources")).toBe("hr");
    expect(normaliseRole("admin")).toBe("admin");
    expect(normaliseRole("Administrator")).toBe("admin");
    expect(normaliseRole("manager")).toBe("manager");
    expect(normaliseRole("lead")).toBe("lead");
    expect(normaliseRole("Team Lead")).toBe("lead");
    expect(normaliseRole("employee")).toBe("employee");
    expect(normaliseRole("Staff")).toBe("employee");
  });

  it("strictly bars super_admin from onboarding roles", () => {
    expect(normaliseRole("super_admin")).toBe("super_admin");
    // onboardingRolesFor filters out super_admin unconditionally
    const hrAssignable = onboardingRolesFor(["hr", "admin", "manager", "lead", "employee"]);
    expect(hrAssignable).not.toContain("super_admin");

    const superAdminAssignable = onboardingRolesFor([
      "super_admin",
      "founder",
      "hr",
      "admin",
      "manager",
      "lead",
      "employee",
    ]);
    expect(superAdminAssignable).not.toContain("super_admin");
  });

  it("normalises employment categories (distinct from authorization role)", () => {
    expect(normaliseCategory("full_time")).toBe("full_time");
    expect(normaliseCategory("Full Time")).toBe("full_time");
    expect(normaliseCategory("FT")).toBe("full_time");
    expect(normaliseCategory("intern")).toBe("intern");
    expect(normaliseCategory("Internship")).toBe("intern");
    expect(normaliseCategory("freelancer")).toBe("freelancer");
    expect(normaliseCategory("Freelance")).toBe("freelancer");
    expect(normaliseCategory("trainer")).toBe("trainer");
    expect(normaliseCategory("unknown_category")).toBeNull();
  });

  it("normalises work types", () => {
    expect(normaliseWorkType("annotation")).toBe("annotation");
    expect(normaliseWorkType("Annotator")).toBe("annotation");
    expect(normaliseWorkType("engineering")).toBe("engineering");
    expect(normaliseWorkType("operations")).toBe("operations");
    expect(normaliseWorkType("hr")).toBe("hr");
    expect(normaliseWorkType("training")).toBe("training");
    expect(normaliseWorkType("other")).toBe("other");
    expect(normaliseWorkType("invalid")).toBeNull();
  });
});

describe("Part A — Employee Onboarding: Spreadsheet Grid Parser & Security", () => {
  it("parses valid 8-field grid into canonical raw rows", () => {
    const grid = [
      ONBOARDING_REQUIRED_COLUMNS,
      ["Asha", "Sharma", "asha.sharma@example.org", "2000-01-15", "annotation", "employee", "intern", "Annotator"],
    ];
    const parsed = gridToOnboardingRows(grid);
    expect(parsed.fileErrors).toHaveLength(0);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.first_name).toBe("Asha");
    expect(parsed.rows[0]?.last_name).toBe("Sharma");
    expect(parsed.rows[0]?.work_email).toBe("asha.sharma@example.org");
    expect(parsed.rows[0]?.date_of_birth).toBe("2000-01-15");
    expect(parsed.rows[0]?.work_type).toBe("annotation");
    expect(parsed.rows[0]?.role).toBe("employee");
    expect(parsed.rows[0]?.employment_category).toBe("intern");
    expect(parsed.rows[0]?.designation).toBe("Annotator");
  });

  it("rejects files containing forbidden columns (password, employee_id, etc.)", () => {
    for (const forbidden of FORBIDDEN_IMPORT_COLUMNS) {
      const grid = [
        [...ONBOARDING_REQUIRED_COLUMNS, forbidden],
        ["Asha", "Sharma", "asha.sharma@example.org", "2000-01-15", "annotation", "employee", "intern", "Annotator", "secret"],
      ];
      const parsed = gridToOnboardingRows(grid);
      expect(parsed.fileErrors.some((e) => e.includes("Remove these columns"))).toBe(true);
    }
  });

  it("flags rows with unsafe formula characters during row validation", () => {
    const lookups: OnboardingLookups = {
      existingEmails: new Map(),
      departments: new Map(),
      leadsByEmail: new Map(),
      assignableRoles: ["employee"],
      todayIso: "2026-11-18",
    };
    const rawRows: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "=SUM(A1:A2)",
        last_name: "Patel",
        work_email: "karan@example.com",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
      },
    ];
    const validated = validateOnboardingRows(rawRows, lookups);
    expect(validated[0]?.errors.some((e) => e.includes("unsafe spreadsheet content"))).toBe(true);
  });

  it("enforces maximum row limits (500 rows)", () => {
    const bigGrid = [
      ONBOARDING_REQUIRED_COLUMNS,
      ...Array.from({ length: 505 }, (_, i) => [
        "First", "Last", `emp${i}@example.com`, "2000-01-01", "annotation", "employee", "full_time", "Role",
      ]),
    ];
    const parsed = gridToOnboardingRows(bigGrid);
    expect(parsed.fileErrors.some((e) => e.includes("limited to 500 employees"))).toBe(true);
  });
});

describe("Part A — Employee Onboarding: Row Validation & Duplicate Detection", () => {
  const lookups: OnboardingLookups = {
    existingEmails: new Map([
      ["existing.profile@theaischool.co", "profile"],
      ["existing.auth@theaischool.co", "auth"],
      ["pending.invite@theaischool.co", "invitation"],
    ]),
    departments: new Map([["annotation", { id: "dept-1", name: "Annotation", code: "ANN" }]]),
    leadsByEmail: new Map([["lead@theaischool.co", "user-lead-1"]]),
    assignableRoles: ["admin", "manager", "lead", "employee"], // HR cannot assign super_admin or hr
    todayIso: "2026-11-18",
  };

  it("accepts a clean row and marks it creatable", () => {
    const rawRows: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "Karan",
        last_name: "Patel",
        work_email: "karan.patel@theaischool.co",
        date_of_birth: "2001-06-20",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "AI Specialist",
        reporting_lead_email: "lead@theaischool.co",
      },
    ];
    const validated = validateOnboardingRows(rawRows, lookups);
    expect(validated).toHaveLength(1);
    expect(validated[0]?.status).toBe("valid");
    expect(isCreatableRow(validated[0]!)).toBe(true);
    expect(validated[0]?.dobStatus).toBe("valid");
    expect(validated[0]?.errors).toHaveLength(0);
  });

  it("detects in-file duplicate emails and flags both occurrences", () => {
    const rawRows: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "One",
        last_name: "A",
        work_email: "dup@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
        reporting_lead_email: "lead@theaischool.co",
      },
      {
        rowNumber: 3,
        first_name: "Two",
        last_name: "B",
        work_email: "dup@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
        reporting_lead_email: "lead@theaischool.co",
      },
    ];
    const validated = validateOnboardingRows(rawRows, lookups);
    expect(validated[0]?.status).toBe("duplicate");
    expect(validated[0]?.duplicateSource).toBe("file");
    expect(validated[1]?.status).toBe("duplicate");
    expect(validated[1]?.duplicateSource).toBe("file");
    expect(isCreatableRow(validated[0]!)).toBe(false);
  });

  it("detects duplicates from existing profiles, Auth accounts and pending invitations", () => {
    const rawRows: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "Profile",
        last_name: "User",
        work_email: "existing.profile@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
      },
      {
        rowNumber: 3,
        first_name: "Auth",
        last_name: "User",
        work_email: "existing.auth@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
      },
      {
        rowNumber: 4,
        first_name: "Invite",
        last_name: "User",
        work_email: "pending.invite@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
      },
    ];
    const validated = validateOnboardingRows(rawRows, lookups);
    expect(validated[0]?.status).toBe("duplicate");
    expect(validated[0]?.duplicateSource).toBe("profile");
    expect(validated[1]?.status).toBe("duplicate");
    expect(validated[1]?.duplicateSource).toBe("auth");
    expect(validated[2]?.status).toBe("duplicate");
    expect(validated[2]?.duplicateSource).toBe("invitation");
  });

  it("blocks privilege escalation if actor tries to grant an unauthorized role", () => {
    const rawRows: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "Sneaky",
        last_name: "Admin",
        work_email: "sneaky@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "operations",
        role: "founder", // Lookups assignableRoles only has admin, manager, lead, employee
        employment_category: "full_time",
        designation: "Founder Role",
      },
      {
        rowNumber: 3,
        first_name: "Super",
        last_name: "User",
        work_email: "super@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "engineering",
        role: "super_admin",
        employment_category: "full_time",
        designation: "Super Admin",
      },
    ];
    const validated = validateOnboardingRows(rawRows, lookups);
    expect(validated[0]?.status).toBe("unauthorized_role");
    expect(validated[0]?.errors.join()).toContain("not authorised to grant");
    expect(validated[1]?.status).toBe("unauthorized_role");
    expect(validated[1]?.errors.join()).toContain("Super Admin accounts cannot be created");
  });

  it("correctly produces a summary of row counts", () => {
    const rawRows: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "Valid",
        last_name: "Person",
        work_email: "valid@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
        reporting_lead_email: "lead@theaischool.co",
      },
      {
        rowNumber: 3,
        first_name: "Dup",
        last_name: "Person",
        work_email: "existing.profile@theaischool.co",
        date_of_birth: "2000-01-01",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Role",
        reporting_lead_email: "lead@theaischool.co",
      },
    ];
    const validated = validateOnboardingRows(rawRows, lookups);
    const summary = summariseOnboardingRows(validated);
    expect(summary.total).toBe(2);
    expect(summary.valid).toBe(1);
    expect(summary.duplicate).toBe(1);
    expect(summary.creatable).toBe(1);
  });
});

describe("Part A — Employee Onboarding: Setup Email Security & Status", () => {
  it("derives setup email status correctly", () => {
    // Never sent
    expect(
      deriveSetupEmailStatus({
        passwordSetupComplete: false,
        latestMessageStatus: null,
      }),
    ).toBe("not_sent");

    // Queued
    expect(
      deriveSetupEmailStatus({
        passwordSetupComplete: false,
        latestMessageStatus: "queued",
      }),
    ).toBe("queued");

    // Sent via SMTP (smtp_accepted)
    expect(
      deriveSetupEmailStatus({
        passwordSetupComplete: false,
        latestMessageStatus: "sent",
      }),
    ).toBe("smtp_accepted");

    // Confirmed ONLY when passwordSetupComplete is true
    expect(
      deriveSetupEmailStatus({
        passwordSetupComplete: true,
        latestMessageStatus: "sent",
      }),
    ).toBe("confirmed");

    // Failed
    expect(
      deriveSetupEmailStatus({
        passwordSetupComplete: false,
        latestMessageStatus: "failed",
      }),
    ).toBe("failed");
  });

  it("redacts sensitive recovery tokens before database audit logging", () => {
    const rawLink = "https://theaischool.co/auth/reset-password?token_hash=secret1234567890abcdef&type=recovery&setup=1";
    const emailBody = `Click this link to set up your account: ${rawLink}\nIf you did not request this, ignore.`;
    const redacted = redactSetupLink(emailBody, rawLink);
    expect(redacted).not.toContain("secret1234567890abcdef");
    expect(redacted).toContain("[secure single-use setup link — redacted]");
    expect(redacted).toContain("Click this link to set up your account: [secure single-use setup link — redacted]");
  });
});

describe("Part B — 10 AM to 6 PM Annotation Hourly Logging", () => {
  it("contains exactly 8 hourly slots from 10:00 to 18:00 IST", () => {
    expect(DAY_SLOTS).toHaveLength(8);
    expect(DAY_SLOTS[0]?.key).toBe("10-11");
    expect(DAY_SLOTS[0]?.startHour).toBe(10);
    expect(DAY_SLOTS[0]?.endHour).toBe(11);
    expect(DAY_SLOTS[0]?.label).toBe("10:00–11:00");

    expect(DAY_SLOTS[7]?.key).toBe("17-18");
    expect(DAY_SLOTS[7]?.startHour).toBe(17);
    expect(DAY_SLOTS[7]?.endHour).toBe(18);
    expect(DAY_SLOTS[7]?.label).toBe("5:00–6:00");
  });

  it("calculates exact deterministic UTC timestamps for Asia/Kolkata wall-clock time", () => {
    const workDate = "2026-11-18";

    // 10:00 AM IST = 04:30 UTC
    const slot10 = slotRange(workDate, DAY_SLOTS[0]!);
    expect(slot10.start.toISOString()).toBe("2026-11-18T04:30:00.000Z");
    expect(slot10.end.toISOString()).toBe("2026-11-18T05:30:00.000Z");

    // 6:00 PM IST (17:00-18:00) = 11:30 to 12:30 UTC
    const slot17 = slotRange(workDate, DAY_SLOTS[7]!);
    expect(slot17.start.toISOString()).toBe("2026-11-18T11:30:00.000Z");
    expect(slot17.end.toISOString()).toBe("2026-11-18T12:30:00.000Z");
  });

  it("matches slotKeyOf accurately in Asia/Kolkata (+05:30) regardless of format", () => {
    // 10:00 to 11:00 IST (04:30 to 05:30 UTC)
    expect(slotKeyOf("2026-11-18T04:30:00.000Z", "2026-11-18T05:30:00.000Z")).toBe("10-11");

    // 1:00 PM to 2:00 PM IST (07:30 to 08:30 UTC)
    expect(slotKeyOf("2026-11-18T07:30:00.000Z", "2026-11-18T08:30:00.000Z")).toBe("13-14");

    // 5:00 PM to 6:00 PM IST (11:30 to 12:30 UTC)
    expect(slotKeyOf("2026-11-18T11:30:00.000Z", "2026-11-18T12:30:00.000Z")).toBe("17-18");

    // Historical 9:00 AM to 10:00 AM IST (03:30 to 04:30 UTC)
    expect(slotKeyOf("2026-11-18T03:30:00.000Z", "2026-11-18T04:30:00.000Z")).toBe("09-10");

    // Non-aligned or invalid durations
    expect(slotKeyOf("2026-11-18T04:00:00.000Z", "2026-11-18T05:00:00.000Z")).toBeNull();
    expect(slotKeyOf("2026-11-18T04:30:00.000Z", "2026-11-18T05:00:00.000Z")).toBeNull();
  });

  it("preserves historical 09:00 slot viewability when an entry is present", () => {
    // Day without 09-10 entry
    const normalEntries = [
      { started_at: "2026-11-18T04:30:00.000Z", ended_at: "2026-11-18T05:30:00.000Z" },
    ];
    const normalSlots = getVisibleDaySlots(normalEntries);
    expect(normalSlots).toHaveLength(8);
    expect(normalSlots.some((s) => s.key === "09-10")).toBe(false);

    // Day with historical 09-10 entry
    const legacyEntries = [
      { started_at: "2026-11-17T03:30:00.000Z", ended_at: "2026-11-17T04:30:00.000Z" },
      { started_at: "2026-11-17T04:30:00.000Z", ended_at: "2026-11-17T05:30:00.000Z" },
    ];
    const legacySlots = getVisibleDaySlots(legacyEntries);
    expect(legacySlots).toHaveLength(9);
    expect(legacySlots[0]?.key).toBe("09-10");
    expect(legacySlots[0]?.isLegacy).toBe(true);
  });

  it("enforces role restriction: only role=employee and work_type=annotation may log hourly tasks", () => {
    // Annotation employee: eligible
    const eligibleEmp = evaluateAnnotationContributor({
      roles: ["employee"],
      workType: "annotation",
      category: "full_time",
      accountStatus: "active",
      employmentStatus: "active",
    });
    expect(eligibleEmp.eligible).toBe(true);

    // Engineering employee: blocked
    const engEmp = evaluateAnnotationContributor({
      roles: ["employee"],
      workType: "engineering",
      category: "full_time",
      accountStatus: "active",
      employmentStatus: "active",
    });
    expect(engEmp.eligible).toBe(false);
    expect(engEmp.code).toBe("not_annotation_work_type");

    // Operations employee: blocked
    const opsEmp = evaluateAnnotationContributor({
      roles: ["employee"],
      workType: "operations",
      category: "full_time",
      accountStatus: "active",
      employmentStatus: "active",
    });
    expect(opsEmp.eligible).toBe(false);
    expect(opsEmp.code).toBe("not_annotation_work_type");

    // Manager / Lead / HR / Founder / Admin: blocked
    for (const mgmtRole of ["manager", "lead", "hr", "founder", "admin", "super_admin"]) {
      const mgmt = evaluateAnnotationContributor({
        roles: [mgmtRole, "employee"],
        workType: "annotation",
        category: "full_time",
        accountStatus: "active",
        employmentStatus: "active",
      });
      expect(mgmt.eligible).toBe(false);
      expect(mgmt.code).toBe("management_role");
    }
  });
});

describe("Part F — Bulk Onboarding 500 Employees, Inline Editing & Staging Validation", () => {
  const lookups: OnboardingLookups = {
    existingEmails: new Map([["db.existing@theaischool.co", "profile"]]),
    departments: new Map([
      ["annotation", { id: "dept-1", name: "Annotation", code: "ANN" }],
      ["engineering", { id: "dept-2", name: "Engineering", code: "ENG" }],
    ]),
    leadsByEmail: new Map([["lead@theaischool.co", "lead-uuid-1"]]),
    assignableRoles: ["admin", "manager", "lead", "employee"],
    todayIso: "2026-11-19",
  };

  it("successfully parses and validates up to 500 rows without dropping data", () => {
    const raw500: OnboardingRawRow[] = Array.from({ length: 500 }, (_, i) => ({
      rowNumber: i + 2,
      first_name: "Employee",
      last_name: "Member",
      work_email: `user${i}@theaischool.co`,
      date_of_birth: "2000-01-15",
      work_type: "annotation",
      role: "employee",
      employment_category: "intern",
      designation: "Annotation Associate",
      department: "Annotation",
      reporting_lead_email: "lead@theaischool.co",
      work_location: "Bangalore Office",
      available_hours_per_day: "8",
    }));

    const validated = validateOnboardingRows(raw500, lookups);
    expect(validated).toHaveLength(500);
    const summary = summariseOnboardingRows(validated);
    expect(summary.total).toBe(500);
    expect(summary.creatable).toBe(500);
    expect(summary.valid).toBe(500);
    expect(summary.invalid).toBe(0);
    expect(summary.needs_information).toBe(0);
  });

  it("handles various dataset sizes: 1, 10, 50, 100, 250 rows correctly", () => {
    for (const count of [1, 10, 50, 100, 250]) {
      const rows: OnboardingRawRow[] = Array.from({ length: count }, (_, i) => ({
        rowNumber: i + 2,
        first_name: "Cohort",
        last_name: "Member",
        work_email: `batch${count}_${i}@theaischool.co`,
        date_of_birth: "1998-05-10",
        work_type: "engineering",
        role: "employee",
        employment_category: "full_time",
        designation: "Software Engineer",
        reporting_lead_email: "lead@theaischool.co",
      }));
      const validated = validateOnboardingRows(rows, lookups);
      expect(validated).toHaveLength(count);
      const summary = summariseOnboardingRows(validated);
      expect(summary.total).toBe(count);
      expect(summary.creatable).toBe(count);
    }
  });

  it("classifies rows with missing fields as needs_information rather than fatal error", () => {
    const rawWithMissing: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "Rahul",
        last_name: "Verma",
        work_email: "rahul.verma@theaischool.co",
        date_of_birth: "2001-08-20",
        // work_type missing
        role: "employee",
        employment_category: "full_time",
        designation: "Developer",
      },
      {
        rowNumber: 3,
        first_name: "Sneha",
        last_name: "Sharma",
        work_email: "sneha.sharma@theaischool.co",
        date_of_birth: "2002-03-14",
        work_type: "annotation",
        // role and category missing
        designation: "Analyst",
      },
    ];

    const validated = validateOnboardingRows(rawWithMissing, lookups);
    expect(validated[0]?.status).toBe("needs_information");
    expect(isCreatableRow(validated[0]!)).toBe(false);
    expect(validated[1]?.status).toBe("needs_information");
    expect(isCreatableRow(validated[1]!)).toBe(false);

    const summary = summariseOnboardingRows(validated);
    expect(summary.needs_information).toBe(2);
    expect(summary.creatable).toBe(0);
  });

  it("updates row from needs_information to valid upon inline editing", () => {
    const rawRow: OnboardingRawRow = {
      rowNumber: 2,
      first_name: "Pooja",
      last_name: "Reddy",
      work_email: "pooja.reddy@theaischool.co",
      date_of_birth: "1999-12-05",
      work_type: "", // missing initially
      role: "employee",
      employment_category: "full_time",
      designation: "Specialist",
      reporting_lead_email: "lead@theaischool.co",
    };

    const initialValidation = validateOnboardingRows([rawRow], lookups);
    expect(initialValidation[0]?.status).toBe("needs_information");
    expect(isCreatableRow(initialValidation[0]!)).toBe(false);

    // Simulate HR filling in work_type inline
    const updatedRow: OnboardingRawRow = { ...rawRow, work_type: "annotation" };
    const revalidated = validateOnboardingRows([updatedRow], lookups);
    expect(revalidated[0]?.status).toBe("valid");
    expect(isCreatableRow(revalidated[0]!)).toBe(true);
  });

  it("honors row exclusion flag exclude_from_import", () => {
    const rawRows: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "Arun",
        last_name: "Kumar",
        work_email: "arun.kumar@theaischool.co",
        date_of_birth: "1997-07-07",
        work_type: "annotation",
        role: "employee",
        employment_category: "full_time",
        designation: "Annotator",
        reporting_lead_email: "lead@theaischool.co",
        exclude_from_import: "true",
      },
      {
        rowNumber: 3,
        first_name: "Meera",
        last_name: "Nair",
        work_email: "meera.nair@theaischool.co",
        date_of_birth: "1998-08-08",
        work_type: "operations",
        role: "employee",
        employment_category: "full_time",
        designation: "Operations Executive",
        reporting_lead_email: "lead@theaischool.co",
      },
    ];

    const validated = validateOnboardingRows(rawRows, lookups);
    expect(validated[0]?.status).toBe("excluded");
    expect(isCreatableRow(validated[0]!)).toBe(false);
    expect(validated[1]?.status).toBe("valid");
    expect(isCreatableRow(validated[1]!)).toBe(true);

    const summary = summariseOnboardingRows(validated);
    expect(summary.total).toBe(2);
    expect(summary.excluded).toBe(1);
    expect(summary.creatable).toBe(1);
  });

  it("allows duplicate resolution by excluding one duplicate in file", () => {
    const rawDuplicates: OnboardingRawRow[] = [
      {
        rowNumber: 2,
        first_name: "Deepak",
        last_name: "One",
        work_email: "deepak.duplicate@theaischool.co",
        date_of_birth: "1995-01-01",
        work_type: "engineering",
        role: "manager",
        employment_category: "full_time",
        designation: "Manager",
      },
      {
        rowNumber: 3,
        first_name: "Deepak",
        last_name: "Two",
        work_email: "deepak.duplicate@theaischool.co",
        date_of_birth: "1995-01-01",
        work_type: "engineering",
        role: "manager",
        employment_category: "full_time",
        designation: "Manager",
      },
    ];

    const initial = validateOnboardingRows(rawDuplicates, lookups);
    expect(initial[0]?.status).toBe("duplicate");
    expect(initial[1]?.status).toBe("duplicate");

    // Exclude second duplicate
    const resolved: OnboardingRawRow[] = [
      rawDuplicates[0]!,
      { ...rawDuplicates[1]!, exclude_from_import: "true" },
    ];
    const revalidated = validateOnboardingRows(resolved, lookups);
    expect(revalidated[0]?.status).toBe("valid");
    expect(isCreatableRow(revalidated[0]!)).toBe(true);
    expect(revalidated[1]?.status).toBe("excluded");
    expect(isCreatableRow(revalidated[1]!)).toBe(false);
  });
});
