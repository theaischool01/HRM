import { USER_CATEGORIES, type UserCategory } from "../permissions";
import { normaliseHeader, parseRosterDate } from "../roster-import";
import { CANDIDATE_SOURCES, type CandidateSource } from "./pipeline";

export const CANDIDATE_IMPORT_COLUMNS = [
  "Full Name",
  "Email",
  "Phone",
  "Department",
  "Designation",
  "Category",
  "Source",
  "Experience Years",
  "Current Company",
  "Expected CTC",
  "Notice Period Days",
  "Available Joining Date",
  "Location",
  "Skills",
  "LinkedIn URL",
  "Notes",
] as const;

export type CandidateImportColumn = (typeof CANDIDATE_IMPORT_COLUMNS)[number];

export type CandidateColumnMapping = Partial<Record<CandidateImportColumn, string>>;

export const CANDIDATE_TEMPLATE_SAMPLE_ROWS: Record<CandidateImportColumn, string>[] = [
  {
    "Full Name": "Ananya Krishnan",
    Email: "ananya.krishnan@example.com",
    Phone: "+91 98765 11223",
    Department: "Operations",
    Designation: "Senior AI Trainer",
    Category: "full_time",
    Source: "linkedin",
    "Experience Years": "4.5",
    "Current Company": "TechLabs India",
    "Expected CTC": "12 LPA",
    "Notice Period Days": "30",
    "Available Joining Date": "2026-12-01",
    Location: "Bengaluru",
    Skills: "Python, RLHF, Prompt Engineering",
    "LinkedIn URL": "https://linkedin.com/in/ananyakrishnan",
    Notes: "Strong LLM evaluation portfolio",
  },
  {
    "Full Name": "Karthik Nair",
    Email: "karthik.nair@example.com",
    Phone: "9876599887",
    Department: "Delivery",
    Designation: "Data Annotation Intern",
    Category: "intern",
    Source: "campus",
    "Experience Years": "0",
    "Current Company": "",
    "Expected CTC": "Stipend",
    "Notice Period Days": "0",
    "Available Joining Date": "2026-11-25",
    Location: "Hyderabad",
    Skills: "Computer Vision, QA",
    "LinkedIn URL": "",
    Notes: "Final semester B.Tech student",
  },
];

const HEADER_TO_CANONICAL: Record<string, CandidateImportColumn> = {
  "full name": "Full Name",
  name: "Full Name",
  "candidate name": "Full Name",
  applicant: "Full Name",
  email: "Email",
  "email address": "Email",
  "candidate email": "Email",
  "personal email": "Email",
  phone: "Phone",
  "phone number": "Phone",
  mobile: "Phone",
  "contact number": "Phone",
  department: "Department",
  team: "Department",
  designation: "Designation",
  role: "Designation",
  position: "Designation",
  "job title": "Designation",
  category: "Category",
  "employment type": "Category",
  "applied category": "Category",
  source: "Source",
  "application source": "Source",
  channel: "Source",
  "experience years": "Experience Years",
  experience: "Experience Years",
  "total experience": "Experience Years",
  "years of experience": "Experience Years",
  "current company": "Current Company",
  company: "Current Company",
  employer: "Current Company",
  "expected ctc": "Expected CTC",
  ctc: "Expected CTC",
  "expected salary": "Expected CTC",
  "notice period days": "Notice Period Days",
  "notice period": "Notice Period Days",
  "available joining date": "Available Joining Date",
  "joining date": "Available Joining Date",
  "earliest joining": "Available Joining Date",
  location: "Location",
  city: "Location",
  skills: "Skills",
  "key skills": "Skills",
  "linkedin url": "LinkedIn URL",
  linkedin: "LinkedIn URL",
  notes: "Notes",
  remarks: "Notes",
  comments: "Notes",
};

export function autoDetectCandidateColumns(headers: readonly string[]): CandidateColumnMapping {
  const mapping: CandidateColumnMapping = {};
  for (const rawHeader of headers) {
    const trimmed = String(rawHeader ?? "").trim();
    if (!trimmed) continue;
    const canonical = HEADER_TO_CANONICAL[normaliseHeader(trimmed)];
    if (canonical && !mapping[canonical]) {
      mapping[canonical] = trimmed;
    }
  }
  return mapping;
}

export type CandidateImportRawRow = Record<string, string>;

export function applyCandidateColumnMapping(
  grid: readonly (readonly (string | number | null | undefined)[])[],
  customMapping?: CandidateColumnMapping | undefined,
): {
  headers: string[];
  mapping: CandidateColumnMapping;
  rows: CandidateImportRawRow[];
} {
  const [headerRow, ...bodyRows] = grid;
  if (!headerRow) {
    return { headers: [], mapping: {}, rows: [] };
  }

  const headers = headerRow.map((cell) => String(cell ?? "").trim());
  const detected = autoDetectCandidateColumns(headers);
  const mapping: CandidateColumnMapping = { ...detected, ...(customMapping ?? {}) };

  const headerIndex = new Map<string, number>();
  headers.forEach((h, idx) => {
    if (h && !headerIndex.has(h)) headerIndex.set(h, idx);
  });

  const rows: CandidateImportRawRow[] = bodyRows
    .filter((r) => (r ?? []).some((c) => String(c ?? "").trim() !== ""))
    .map((row) => {
      const out: CandidateImportRawRow = {};
      for (const col of CANDIDATE_IMPORT_COLUMNS) {
        const sourceHeader = mapping[col];
        if (!sourceHeader) {
          out[col] = "";
          continue;
        }
        const idx = headerIndex.get(sourceHeader);
        out[col] = idx !== undefined ? String(row?.[idx] ?? "").trim() : "";
      }
      return out;
    });

  return { headers, mapping, rows };
}

export type CandidateImportLookups = {
  /** lowercase department name -> department uuid */
  departmentsByName: ReadonlyMap<string, string>;
  /** lowercase existing candidate emails */
  existingCandidateEmails: ReadonlySet<string>;
  /** lowercase existing active/inactive employee work emails */
  existingEmployeeEmails: ReadonlySet<string>;
  /** lowercase pending onboarding invitation emails */
  pendingInvitationEmails: ReadonlySet<string>;
};

export type CandidateImportRowSeverity = "valid" | "warning" | "duplicate" | "error";

export type ValidatedCandidateImportRow = {
  rowNumber: number;
  raw: CandidateImportRawRow;
  fullName: string;
  email: string;
  phone: string | null;
  departmentName: string | null;
  departmentId: string | null;
  designation: string | null;
  appliedCategory: UserCategory;
  source: CandidateSource;
  experienceYears: number | null;
  currentCompany: string | null;
  expectedCtc: string | null;
  noticePeriodDays: number | null;
  availableJoiningDate: string | null;
  location: string | null;
  skills: string[];
  linkedinUrl: string | null;
  notes: string | null;
  isDuplicate: boolean;
  duplicateSource: "file" | "candidates" | "workforce" | "invitations" | null;
  errors: string[];
  warnings: string[];
  severity: CandidateImportRowSeverity;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CATEGORY_ALIASES: Record<string, UserCategory> = {
  full_time: "full_time",
  fulltime: "full_time",
  "full-time": "full_time",
  "full time": "full_time",
  ft: "full_time",
  intern: "intern",
  internship: "intern",
  freelancer: "freelancer",
  freelance: "freelancer",
  contractor: "freelancer",
  trainer: "trainer",
  faculty: "trainer",
};

const SOURCE_ALIASES: Record<string, CandidateSource> = {
  direct: "direct",
  website: "direct",
  csv_import: "csv_import",
  csv: "csv_import",
  excel: "csv_import",
  linkedin: "linkedin",
  referral: "referral",
  "employee referral": "referral",
  campus: "campus",
  college: "campus",
  job_portal: "job_portal",
  naukri: "job_portal",
  indeed: "job_portal",
  portal: "job_portal",
  agency: "agency",
  vendor: "agency",
  other: "other",
};

export function validateCandidateImport(
  rows: readonly CandidateImportRawRow[],
  lookups: CandidateImportLookups,
): ValidatedCandidateImportRow[] {
  const fileEmailCounts = new Map<string, number>();
  for (const raw of rows) {
    const email = String(raw["Email"] ?? "").trim().toLowerCase();
    if (email) fileEmailCounts.set(email, (fileEmailCounts.get(email) ?? 0) + 1);
  }

  return rows.map((raw, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    let isDuplicate = false;
    let duplicateSource: ValidatedCandidateImportRow["duplicateSource"] = null;

    const fullName = String(raw["Full Name"] ?? "").trim();
    if (fullName.length < 2) {
      errors.push("Full Name is required (minimum 2 characters).");
    }

    const email = String(raw["Email"] ?? "").trim().toLowerCase();
    if (!email) {
      errors.push("Email is required.");
    } else if (!EMAIL_RE.test(email)) {
      errors.push(`"${raw["Email"]}" is not a valid email address.`);
    } else if ((fileEmailCounts.get(email) ?? 0) > 1) {
      isDuplicate = true;
      duplicateSource = "file";
      errors.push("Duplicate candidate email inside this import file.");
    } else if (lookups.existingCandidateEmails.has(email)) {
      isDuplicate = true;
      duplicateSource = "candidates";
      errors.push("Candidate already exists in the Recruitment pipeline.");
    } else if (lookups.existingEmployeeEmails.has(email)) {
      isDuplicate = true;
      duplicateSource = "workforce";
      errors.push("An employee profile already exists with this email.");
    } else if (lookups.pendingInvitationEmails.has(email)) {
      isDuplicate = true;
      duplicateSource = "invitations";
      errors.push("An active onboarding invitation already exists for this email.");
    }

    const designation = String(raw["Designation"] ?? "").trim() || null;
    if (!designation) {
      warnings.push("Designation is blank — can be assigned during screening.");
    }

    const departmentName = String(raw["Department"] ?? "").trim() || null;
    let departmentId: string | null = null;
    if (departmentName) {
      departmentId = lookups.departmentsByName.get(departmentName.toLowerCase()) ?? null;
      if (!departmentId) {
        warnings.push(`Department "${departmentName}" not matched — left unassigned.`);
      }
    }

    const rawCategory = String(raw["Category"] ?? "").trim().toLowerCase();
    let appliedCategory: UserCategory = "full_time";
    if (rawCategory) {
      const mapped = CATEGORY_ALIASES[rawCategory];
      if (mapped && (USER_CATEGORIES as readonly string[]).includes(mapped)) {
        appliedCategory = mapped;
      } else {
        errors.push(
          `Category "${raw["Category"]}" must be one of full_time, intern, freelancer, trainer.`,
        );
      }
    }

    const rawSource = String(raw["Source"] ?? "").trim().toLowerCase();
    let source: CandidateSource = "csv_import";
    if (rawSource) {
      const mappedSource = SOURCE_ALIASES[rawSource];
      if (mappedSource && (CANDIDATE_SOURCES as readonly string[]).includes(mappedSource)) {
        source = mappedSource;
      } else {
        source = "other";
        warnings.push(`Source "${raw["Source"]}" mapped to "other".`);
      }
    }

    const rawExp = String(raw["Experience Years"] ?? "").trim();
    let experienceYears: number | null = null;
    if (rawExp) {
      const parsed = Number(rawExp);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 60) {
        errors.push(`Experience Years "${rawExp}" must be a number between 0 and 60.`);
      } else {
        experienceYears = Math.round(parsed * 10) / 10;
      }
    }

    const rawNotice = String(raw["Notice Period Days"] ?? "").trim();
    let noticePeriodDays: number | null = null;
    if (rawNotice) {
      const parsed = Number(rawNotice.replace(/\s*days?$/i, ""));
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
        errors.push(`Notice Period Days "${rawNotice}" must be an integer between 0 and 365.`);
      } else {
        noticePeriodDays = parsed;
      }
    }

    const rawJoining = String(raw["Available Joining Date"] ?? "").trim();
    let availableJoiningDate: string | null = null;
    if (rawJoining) {
      availableJoiningDate = parseRosterDate(rawJoining);
      if (!availableJoiningDate) {
        errors.push(`Available Joining Date "${rawJoining}" could not be parsed.`);
      }
    }

    const skillsRaw = String(raw["Skills"] ?? "").trim();
    const skills = skillsRaw
      ? skillsRaw
          .split(/[,;|]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const linkedinUrl = String(raw["LinkedIn URL"] ?? "").trim() || null;
    if (linkedinUrl && !/^https?:\/\//i.test(linkedinUrl)) {
      warnings.push("LinkedIn URL does not start with http:// or https://.");
    }

    const severity: CandidateImportRowSeverity = isDuplicate
      ? "duplicate"
      : errors.length > 0
        ? "error"
        : warnings.length > 0
          ? "warning"
          : "valid";

    return {
      rowNumber: idx + 1,
      raw,
      fullName,
      email,
      phone: String(raw["Phone"] ?? "").trim() || null,
      departmentName,
      departmentId,
      designation,
      appliedCategory,
      source,
      experienceYears,
      currentCompany: String(raw["Current Company"] ?? "").trim() || null,
      expectedCtc: String(raw["Expected CTC"] ?? "").trim() || null,
      noticePeriodDays,
      availableJoiningDate,
      location: String(raw["Location"] ?? "").trim() || null,
      skills,
      linkedinUrl,
      notes: String(raw["Notes"] ?? "").trim() || null,
      isDuplicate,
      duplicateSource,
      errors,
      warnings,
      severity,
    };
  });
}

export type CandidateImportSummary = {
  total: number;
  valid: number;
  warning: number;
  duplicate: number;
  invalid: number;
  importable: number;
};

export function summariseCandidateImport(
  rows: readonly ValidatedCandidateImportRow[],
): CandidateImportSummary {
  const valid = rows.filter((r) => r.severity === "valid").length;
  const warning = rows.filter((r) => r.severity === "warning").length;
  const duplicate = rows.filter((r) => r.severity === "duplicate").length;
  const invalid = rows.filter((r) => r.severity === "error").length;
  return {
    total: rows.length,
    valid,
    warning,
    duplicate,
    invalid,
    importable: valid + warning,
  };
}

