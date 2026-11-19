// Shared (client + server) employee onboarding schema, parsing and validation.
//
// One eight-field schema is used by BOTH the single-employee form and the
// CSV / XLSX bulk import, so the two paths can never drift apart. The server
// always re-runs `validateOnboardingRows` with live lookups; the browser copy
// is only for instant feedback.
//
// Privacy: date of birth is validated here but never echoed back in preview
// results (`toPreviewRow` strips it). It is never used to derive passwords.

import { APP_ROLES, ROLE_LABELS, type AppRole } from "../permissions";
import { WORK_TYPE_LABELS, WORK_TYPES, type WorkType } from "../work-type";

export const ONBOARDING_REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "work_email",
  "date_of_birth",
  "work_type",
  "role",
  "employment_category",
  "designation",
] as const;

/** Documented optional columns. Anything else is ignored with a file-level warning. */
export const ONBOARDING_OPTIONAL_COLUMNS = [
  "department",
  "joining_date",
  "reporting_lead_email",
  "internship_start",
  "internship_end",
  "work_location",
  "available_hours_per_day",
] as const;

export type OnboardingRequiredColumn = (typeof ONBOARDING_REQUIRED_COLUMNS)[number];
export type OnboardingOptionalColumn = (typeof ONBOARDING_OPTIONAL_COLUMNS)[number];
export type OnboardingColumn = OnboardingRequiredColumn | OnboardingOptionalColumn;

/** Columns that must never be supplied: identifiers and secrets are system-managed. */
export const FORBIDDEN_IMPORT_COLUMNS = [
  "employee_id",
  "employee_code",
  "id",
  "password",
  "temporary_password",
  "temp_password",
] as const;

export const ONBOARDING_MAX_ROWS = 500;
export const ONBOARDING_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Rows provisioned per server call: keeps each request well inside serverless time limits. */
export const ONBOARDING_CREATE_CHUNK = 25;
/** Recipients handled per setup-email server call (paced inside the call). */
export const ONBOARDING_EMAIL_CHUNK = 10;
/** Pause between individual SMTP sends, respecting Hostinger mailbox throughput. */
export const ONBOARDING_EMAIL_PACING_MS = 1200;

/** Age policy for date-of-birth plausibility. REQUIRES OWNER CONFIRMATION. */
export const ONBOARDING_MIN_AGE_YEARS = 16;
export const ONBOARDING_MAX_AGE_YEARS = 80;

/** Roles selectable in onboarding. Super Admin is never creatable here. */
export const ONBOARDING_ROLES = ["founder", "hr", "admin", "manager", "lead", "employee"] as const;
export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

export const ONBOARDING_CATEGORIES = ["full_time", "intern", "freelancer", "trainer"] as const;
export type OnboardingCategory = (typeof ONBOARDING_CATEGORIES)[number];

export const ONBOARDING_CATEGORY_LABELS: Record<OnboardingCategory, string> = {
  full_time: "Full-Time",
  intern: "Intern",
  freelancer: "Freelancer",
  trainer: "Trainer",
};

export const ONBOARDING_WORK_TYPE_LABELS: Record<WorkType, string> = WORK_TYPE_LABELS;

export type OnboardingRowStatus =
  | "valid"
  | "warning"
  | "needs_information"
  | "duplicate"
  | "invalid"
  | "unauthorized_role"
  | "excluded";

export const ONBOARDING_STATUS_LABELS: Record<OnboardingRowStatus, string> = {
  valid: "Ready",
  warning: "Warning",
  needs_information: "Needs Information",
  duplicate: "Duplicate",
  invalid: "Error",
  unauthorized_role: "Unauthorized Role",
  excluded: "Excluded",
};

/** Raw row keyed by canonical column names (all values are strings). */
export type OnboardingRawRow = Partial<Record<OnboardingColumn, string>> & {
  /** 1-based spreadsheet row number (header = row 1). */
  rowNumber: number;
  exclude_from_import?: string;
};

export type DuplicateSource = "file" | "profile" | "auth" | "invitation";

export type ValidatedOnboardingRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string;
  /** ISO date. Present only server-side for provisioning; stripped from previews. */
  dateOfBirth: string | null;
  dobStatus: "valid" | "missing" | "invalid";
  workType: WorkType | null;
  role: OnboardingRole | null;
  category: OnboardingCategory | null;
  designation: string;
  departmentId: string | null;
  departmentName: string | null;
  joiningDate: string | null;
  reportingLeadId: string | null;
  internshipStart: string | null;
  internshipEnd: string | null;
  workLocation: string | null;
  availableHoursPerDay: number | null;
  status: OnboardingRowStatus;
  errors: string[];
  warnings: string[];
  duplicateSource: DuplicateSource | null;
};

export type OnboardingLookups = {
  /** Lower-cased email → where it already exists. */
  existingEmails: Map<string, Exclude<DuplicateSource, "file">>;
  /** Lower-cased department name AND code → { id, name, code }. */
  departments: Map<string, { id: string; name: string; code: string | null }>;
  /** Lower-cased work email → profile id for eligible reporting leads. */
  leadsByEmail: Map<string, string>;
  /** Roles the importing actor may grant (already excludes super_admin). */
  assignableRoles: readonly AppRole[];
  /** IST "today" (YYYY-MM-DD) used for date-of-birth plausibility. */
  todayIso: string;
};

// ---------------------------------------------------------------------------
// Primitive normalisers
// ---------------------------------------------------------------------------

const UNSAFE_CELL_RE = /^[=+\-@\t\r]/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]*$/u;
const EMAIL_RE = /^[^\s@<>(),;:\\"[\]]+@[^\s@<>(),;:\\"[\]]+\.[a-z]{2,}$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when a spreadsheet cell could be evaluated as a formula or carries control chars. */
export function isUnsafeSpreadsheetValue(value: string): boolean {
  return UNSAFE_CELL_RE.test(value) || CONTROL_RE.test(value);
}

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Strict ISO calendar date (YYYY-MM-DD) or common variant (DD/MM/YYYY, DD-MM-YYYY) that really exists. Returns null otherwise. */
export function parseStrictIsoDate(value: string): string | null {
  const v = value.trim();
  // YYYY-MM-DD
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  m = v.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/** Whole years between an ISO birth date and an ISO reference date. */
export function ageOnDate(dobIso: string, onIso: string): number {
  const [by, bm, bd] = dobIso.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = onIso.split("-").map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

export function validateDateOfBirth(
  raw: string,
  todayIso: string,
): { ok: true; value: string } | { ok: false; reason: string; missing?: boolean } {
  const value = clean(raw);
  if (!value) return { ok: false, reason: "Date of birth is required.", missing: true };
  const iso = parseStrictIsoDate(value);
  if (!iso) return { ok: false, reason: "Date of birth must be a real date in YYYY-MM-DD format." };
  if (iso > todayIso) return { ok: false, reason: "Date of birth cannot be in the future." };
  const age = ageOnDate(iso, todayIso);
  if (age < ONBOARDING_MIN_AGE_YEARS) {
    return { ok: false, reason: `Employee must be at least ${ONBOARDING_MIN_AGE_YEARS} years old.` };
  }
  if (age > ONBOARDING_MAX_AGE_YEARS) {
    return { ok: false, reason: "Date of birth looks implausible. Check the year." };
  }
  return { ok: true, value: iso };
}

function keyOf(value: string): string {
  return value.toLowerCase().replace(/[\s/_-]+/g, "_").replace(/^_+|_+$/g, "");
}

const WORK_TYPE_ALIASES: Record<string, WorkType> = {
  annotation: "annotation",
  annotator: "annotation",
  engineering: "engineering",
  engineer: "engineering",
  operations: "operations",
  ops: "operations",
  hr: "hr",
  human_resources: "hr",
  training: "training",
  trainer: "training",
  other: "other",
  general: "other",
  other_general: "other",
};

export function normaliseWorkType(value: string): WorkType | null {
  const k = keyOf(clean(value));
  const hit = WORK_TYPE_ALIASES[k];
  return hit && (WORK_TYPES as readonly string[]).includes(hit) ? hit : null;
}

const ROLE_ALIASES: Record<string, AppRole> = {
  super_admin: "super_admin",
  superadmin: "super_admin",
  founder: "founder",
  hr: "hr",
  human_resources: "hr",
  admin: "admin",
  administrator: "admin",
  manager: "manager",
  lead: "lead",
  team_lead: "lead",
  project_team_lead: "lead",
  employee: "employee",
  staff: "employee",
};

export function normaliseRole(value: string): AppRole | null {
  const k = keyOf(clean(value));
  if (ROLE_ALIASES[k]) return ROLE_ALIASES[k]!;
  const byLabel = (APP_ROLES as readonly AppRole[]).find((r) => keyOf(ROLE_LABELS[r]) === k);
  return byLabel ?? null;
}

const CATEGORY_ALIASES: Record<string, OnboardingCategory> = {
  full_time: "full_time",
  fulltime: "full_time",
  ft: "full_time",
  intern: "intern",
  internship: "intern",
  freelancer: "freelancer",
  freelance: "freelancer",
  trainer: "trainer",
};

export function normaliseCategory(value: string): OnboardingCategory | null {
  return CATEGORY_ALIASES[keyOf(clean(value))] ?? null;
}

/** Roles an actor may grant through onboarding (mirrors RBAC; never super_admin). */
export function onboardingRolesFor(assignable: readonly AppRole[]): OnboardingRole[] {
  return ONBOARDING_ROLES.filter((r) => assignable.includes(r));
}

// ---------------------------------------------------------------------------
// Header mapping
// ---------------------------------------------------------------------------

const HEADER_ALIASES: Record<string, OnboardingColumn> = {
  first_name: "first_name",
  firstname: "first_name",
  given_name: "first_name",
  last_name: "last_name",
  lastname: "last_name",
  surname: "last_name",
  family_name: "last_name",
  work_email: "work_email",
  email: "work_email",
  email_address: "work_email",
  date_of_birth: "date_of_birth",
  dob: "date_of_birth",
  birth_date: "date_of_birth",
  work_type: "work_type",
  workstream: "work_type",
  work_type_workstream: "work_type",
  role: "role",
  authorization_role: "role",
  app_role: "role",
  employment_category: "employment_category",
  category: "employment_category",
  designation: "designation",
  job_title: "designation",
  title: "designation",
  department: "department",
  joining_date: "joining_date",
  date_of_joining: "joining_date",
  reporting_lead_email: "reporting_lead_email",
  reporting_lead: "reporting_lead_email",
  internship_start: "internship_start",
  internship_end: "internship_end",
  work_location: "work_location",
  location: "work_location",
  work_mode: "work_location",
  available_hours_per_day: "available_hours_per_day",
  available_hours: "available_hours_per_day",
  hours_per_day: "available_hours_per_day",
};

export type ParsedOnboardingGrid = {
  rows: OnboardingRawRow[];
  fileErrors: string[];
  fileWarnings: string[];
};

/** Converts a header-first grid (from CSV / XLSX) into canonical raw rows. Writes nothing. */
export function gridToOnboardingRows(
  grid: readonly (readonly (string | number | null | undefined)[])[],
): ParsedOnboardingGrid {
  const fileErrors: string[] = [];
  const fileWarnings: string[] = [];
  const nonEmpty = grid.filter((r) => r.some((c) => clean(c) !== ""));
  if (nonEmpty.length === 0) {
    return { rows: [], fileErrors: ["The file is empty."], fileWarnings };
  }

  const header = nonEmpty[0]!.map((h) => keyOf(clean(h)));
  const columnMap = new Map<number, OnboardingColumn>();
  const ignored: string[] = [];
  const forbidden: string[] = [];

  header.forEach((h, idx) => {
    if (!h) return;
    if ((FORBIDDEN_IMPORT_COLUMNS as readonly string[]).includes(h)) {
      forbidden.push(h);
      return;
    }
    const col = HEADER_ALIASES[h];
    if (!col) {
      ignored.push(h);
      return;
    }
    if ([...columnMap.values()].includes(col)) {
      fileErrors.push(`Column "${col}" appears more than once.`);
      return;
    }
    columnMap.set(idx, col);
  });

  if (forbidden.length > 0) {
    fileErrors.push(
      `Remove these columns: ${forbidden.join(", ")}. Employee IDs are assigned automatically and passwords are never imported.`,
    );
  }
  const present = new Set(columnMap.values());
  const missing = ONBOARDING_REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    fileErrors.push(`Missing required column(s): ${missing.join(", ")}.`);
  }
  if (ignored.length > 0) {
    fileWarnings.push(`Ignored unrecognised column(s): ${ignored.join(", ")}.`);
  }

  const dataRows = nonEmpty.slice(1);
  if (dataRows.length > ONBOARDING_MAX_ROWS) {
    fileErrors.push(`Imports are limited to ${ONBOARDING_MAX_ROWS} employees per file (found ${dataRows.length}).`);
  }

  const rows: OnboardingRawRow[] = dataRows.slice(0, ONBOARDING_MAX_ROWS).map((cells) => {
    const originalIndex = grid.indexOf(cells);
    const row: OnboardingRawRow = { rowNumber: originalIndex + 1 };
    columnMap.forEach((col, idx) => {
      const cell = cells[idx];
      row[col] = cell === null || cell === undefined ? "" : String(cell);
    });
    return row;
  });

  return { rows, fileErrors, fileWarnings };
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

function optionalDate(
  raw: string | undefined,
  label: string,
  errors: string[],
): string | null {
  const v = clean(raw);
  if (!v) return null;
  if (isUnsafeSpreadsheetValue(v)) {
    errors.push(`${label} contains unsafe spreadsheet content.`);
    return null;
  }
  const iso = parseStrictIsoDate(v);
  if (!iso) {
    errors.push(`${label} must be a real date in YYYY-MM-DD format.`);
    return null;
  }
  return iso;
}

/**
 * Validates every row against the eight-field schema plus live lookups.
 * Pure: performs no I/O and never creates anything.
 */
export function validateOnboardingRows(
  rawRows: readonly OnboardingRawRow[],
  lookups: OnboardingLookups,
): ValidatedOnboardingRow[] {
  const emailCounts = new Map<string, number>();
  for (const r of rawRows) {
    if (r.exclude_from_import === "true") continue;
    const e = clean(r.work_email).toLowerCase();
    if (e) emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
  }
  const seenInFile = new Set<string>();

  return rawRows.map((raw) => {
    const isExcluded = raw.exclude_from_import === "true";
    const errors: string[] = [];
    const warnings: string[] = [];
    let duplicateSource: DuplicateSource | null = null;
    let unauthorized = false;

    // Formula injection / control characters on every supplied cell.
    for (const col of [...ONBOARDING_REQUIRED_COLUMNS, ...ONBOARDING_OPTIONAL_COLUMNS]) {
      const v = clean(raw[col]);
      if (v && isUnsafeSpreadsheetValue(v)) {
        errors.push(`"${col}" contains unsafe spreadsheet content (formulas are not allowed).`);
      }
    }

    const firstName = clean(raw.first_name);
    const lastName = clean(raw.last_name);
    if (!firstName) errors.push("First name is required.");
    else if (firstName.length > 60 || !NAME_RE.test(firstName)) errors.push("First name contains invalid characters.");
    if (!lastName) errors.push("Last name is required.");
    else if (lastName.length > 60 || !NAME_RE.test(lastName)) errors.push("Last name contains invalid characters.");

    const workEmail = clean(raw.work_email).toLowerCase();
    if (!workEmail) errors.push("Work email is required.");
    else if (workEmail.length > 254 || !EMAIL_RE.test(workEmail)) errors.push("Work email is not a valid address.");

    const dob = validateDateOfBirth(raw.date_of_birth ?? "", lookups.todayIso);
    if (!dob.ok) errors.push(dob.reason);

    const workTypeRaw = clean(raw.work_type);
    const workType = workTypeRaw ? normaliseWorkType(workTypeRaw) : null;
    if (!workTypeRaw) errors.push("Work type is required.");
    else if (!workType) errors.push(`Unknown work type "${workTypeRaw}".`);

    const roleRaw = clean(raw.role);
    const parsedRole = roleRaw ? normaliseRole(roleRaw) : null;
    let role: OnboardingRole | null = null;
    if (!roleRaw) errors.push("Authorization role is required.");
    else if (!parsedRole) errors.push(`Unknown authorization role "${roleRaw}".`);
    else if (parsedRole === "super_admin") {
      unauthorized = true;
      errors.push("Super Admin accounts cannot be created through onboarding.");
    } else {
      role = parsedRole as OnboardingRole;
      if (!lookups.assignableRoles.includes(parsedRole)) {
        unauthorized = true;
        errors.push(`You are not authorised to grant the ${ROLE_LABELS[parsedRole]} role.`);
      }
    }

    const categoryRaw = clean(raw.employment_category);
    const category = categoryRaw ? normaliseCategory(categoryRaw) : null;
    if (!categoryRaw) errors.push("Employment category is required.");
    else if (!category) errors.push(`Unknown employment category "${categoryRaw}".`);

    const designation = clean(raw.designation);
    if (!designation) errors.push("Designation is required.");
    else if (designation.length < 2 || designation.length > 80) errors.push("Designation must be 2–80 characters.");

    // Optional documented fields
    let departmentId: string | null = null;
    let departmentName: string | null = null;
    const deptRaw = clean(raw.department);
    if (deptRaw) {
      const dept = lookups.departments.get(deptRaw.toLowerCase());
      if (dept) {
        departmentId = dept.id;
        departmentName = dept.name;
      } else {
        warnings.push(`Department "${deptRaw}" not found; it will be left unassigned.`);
      }
    }
    if (workType === "annotation" && departmentName && !/annotation/i.test(departmentName)) {
      warnings.push(`Annotation work type with department "${departmentName}" — confirm this is intended.`);
    }

    const joiningDate = optionalDate(raw.joining_date, "Joining date", errors);
    const internshipStart = optionalDate(raw.internship_start, "Internship start", errors);
    const internshipEnd = optionalDate(raw.internship_end, "Internship end", errors);
    if (internshipStart && internshipEnd && internshipEnd < internshipStart) {
      errors.push("Internship end is before internship start.");
    }
    if ((internshipStart || internshipEnd) && category && category !== "intern") {
      warnings.push("Internship dates supplied for a non-intern category.");
    }

    let reportingLeadId: string | null = null;
    const leadEmail = clean(raw.reporting_lead_email).toLowerCase();
    if (leadEmail) {
      reportingLeadId = lookups.leadsByEmail.get(leadEmail) ?? null;
      if (!reportingLeadId) warnings.push(`Reporting lead "${leadEmail}" not found; assign one later.`);
    } else if (role === "employee") {
      warnings.push("No reporting lead set; leave/WFH requests stay blocked until HR assigns one.");
    }

    // Duplicates (only meaningful for syntactically valid emails on non-excluded rows)
    if (!isExcluded && workEmail && EMAIL_RE.test(workEmail)) {
      const existing = lookups.existingEmails.get(workEmail);
      if (existing) {
        duplicateSource = existing;
        errors.push(
          existing === "invitation"
            ? "A pending invitation already exists for this email."
            : "An account already exists for this email.",
        );
      } else if ((emailCounts.get(workEmail) ?? 0) > 1) {
        duplicateSource = "file";
        errors.push("Duplicate email within this file.");
      }
      seenInFile.add(workEmail);
    }

    const workLocation = clean(raw.work_location) || null;
    const rawHours = clean(raw.available_hours_per_day);
    const availableHoursPerDay = rawHours && !isNaN(Number(rawHours)) ? Number(rawHours) : null;

    // Distinguish rows with missing required fields vs fatal formatting errors
    const hasMissingFields =
      !firstName ||
      !lastName ||
      !workEmail ||
      !clean(raw.date_of_birth) ||
      !workType ||
      !role ||
      !category ||
      !designation;

    const onlyMissingErrors =
      hasMissingFields &&
      !unauthorized &&
      !duplicateSource &&
      errors.every((e) => e.includes("is required") || e.includes("Missing") || e.includes("Unknown"));

    const status: OnboardingRowStatus = isExcluded
      ? "excluded"
      : unauthorized
        ? "unauthorized_role"
        : duplicateSource && errors.every((e) => /already exists|Duplicate email|pending invitation/.test(e))
          ? "duplicate"
          : onlyMissingErrors
            ? "needs_information"
            : errors.length > 0
              ? "invalid"
              : warnings.length > 0
                ? "warning"
                : "valid";

    return {
      rowNumber: raw.rowNumber,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      workEmail,
      dateOfBirth: dob.ok ? dob.value : null,
      dobStatus: dob.ok ? "valid" : "missing" in dob && dob.missing ? "missing" : "invalid",
      workType,
      role,
      category,
      designation,
      departmentId,
      departmentName,
      joiningDate,
      reportingLeadId,
      internshipStart,
      internshipEnd,
      workLocation,
      availableHoursPerDay,
      status,
      errors,
      warnings,
      duplicateSource,
    };
  });
}

export function isCreatableRow(row: Pick<ValidatedOnboardingRow, "status">): boolean {
  return row.status === "valid" || row.status === "warning";
}

/** Removes date of birth before a row is returned to the browser or written to logs. */
export function toPreviewRow(row: ValidatedOnboardingRow): ValidatedOnboardingRow {
  return { ...row, dateOfBirth: null };
}

export type OnboardingSummary = Record<OnboardingRowStatus, number> & {
  total: number;
  creatable: number;
};

export function summariseOnboardingRows(rows: readonly ValidatedOnboardingRow[]): OnboardingSummary {
  const s: OnboardingSummary = {
    total: rows.length,
    creatable: 0,
    valid: 0,
    warning: 0,
    needs_information: 0,
    duplicate: 0,
    invalid: 0,
    unauthorized_role: 0,
    excluded: 0,
  };
  for (const r of rows) {
    if (s[r.status] !== undefined) s[r.status] += 1;
    if (isCreatableRow(r)) s.creatable += 1;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Templates (no real people, no secrets, no employee IDs)
// ---------------------------------------------------------------------------

export const ONBOARDING_TEMPLATE_HEADERS: readonly OnboardingColumn[] = [
  ...ONBOARDING_REQUIRED_COLUMNS,
  ...ONBOARDING_OPTIONAL_COLUMNS,
];

export const ONBOARDING_TEMPLATE_SAMPLE_ROWS: readonly Record<OnboardingColumn, string>[] = [
  {
    first_name: "Asha",
    last_name: "Example",
    work_email: "asha.example@example.org",
    date_of_birth: "1999-04-15",
    work_type: "annotation",
    role: "employee",
    employment_category: "intern",
    designation: "Data Annotation Intern",
    department: "Annotation",
    joining_date: "",
    reporting_lead_email: "",
    internship_start: "",
    internship_end: "",
    work_location: "",
    available_hours_per_day: "",
  },
  {
    first_name: "Ravi",
    last_name: "Sample",
    work_email: "ravi.sample@example.org",
    date_of_birth: "1994-11-02",
    work_type: "engineering",
    role: "lead",
    employment_category: "full_time",
    designation: "Engineering Lead",
    department: "Engineering",
    joining_date: "",
    reporting_lead_email: "",
    internship_start: "",
    internship_end: "",
    work_location: "",
    available_hours_per_day: "",
  },
];

// ---------------------------------------------------------------------------
// Setup email status (shared by UI and server)
// ---------------------------------------------------------------------------

export type SetupEmailStatus = "not_sent" | "queued" | "smtp_accepted" | "confirmed" | "failed";

export const SETUP_EMAIL_STATUS_LABELS: Record<SetupEmailStatus, string> = {
  not_sent: "Not Sent",
  queued: "Queued",
  smtp_accepted: "SMTP Accepted",
  confirmed: "Confirmed",
  failed: "Failed",
};

/**
 * "Confirmed" is ONLY derived from an actual account-setup event (the employee
 * set their own password, clearing `must_change_password`) — never from SMTP
 * acceptance.
 */
export function deriveSetupEmailStatus(input: {
  passwordSetupComplete: boolean;
  latestMessageStatus: string | null;
}): SetupEmailStatus {
  if (input.passwordSetupComplete) return "confirmed";
  switch (input.latestMessageStatus) {
    case null:
    case undefined:
    case "draft":
    case "canceled":
      return "not_sent";
    case "queued":
    case "sending":
      return "queued";
    case "accepted_by_smtp":
    case "sent":
    case "delivered":
      return "smtp_accepted";
    case "failed":
      return "failed";
    default:
      return "not_sent";
  }
}

export const ACCOUNT_SETUP_TEMPLATE_SLUG = "account_setup";
