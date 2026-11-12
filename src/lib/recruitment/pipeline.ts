import type { UserCategory } from "../permissions";

export const CANDIDATE_PIPELINE_STAGES = [
  "applied",
  "screening",
  "shortlisted",
  "interview_scheduled",
  "interviewed",
  "selected",
  "offer_sent",
  "offer_accepted",
  "onboarding",
] as const;

export const CANDIDATE_SIDE_STATUSES = ["rejected", "on_hold", "withdrawn"] as const;

export const CANDIDATE_STATUSES = [
  ...CANDIDATE_PIPELINE_STAGES,
  ...CANDIDATE_SIDE_STATUSES,
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  applied: "Applied",
  screening: "Screening",
  shortlisted: "Shortlisted",
  interview_scheduled: "Interview Scheduled",
  interviewed: "Interviewed",
  selected: "Selected",
  offer_sent: "Offer Sent",
  offer_accepted: "Offer Accepted",
  onboarding: "Onboarding",
  rejected: "Rejected",
  on_hold: "On Hold",
  withdrawn: "Withdrawn",
};

export const CANDIDATE_SOURCES = [
  "direct",
  "csv_import",
  "linkedin",
  "referral",
  "campus",
  "job_portal",
  "agency",
  "other",
] as const;

export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  direct: "Direct Application",
  csv_import: "CSV / Excel Import",
  linkedin: "LinkedIn",
  referral: "Employee Referral",
  campus: "Campus Hiring",
  job_portal: "Job Portal",
  agency: "Staffing Agency",
  other: "Other",
};

export const INTERVIEW_MODES = ["online", "offline"] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const INTERVIEW_STATUSES = [
  "scheduled",
  "rescheduled",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Scheduled",
  rescheduled: "Rescheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-Show",
};

const istInterviewDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const istInterviewTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/**
 * Formats UTC interview start/end timestamps into Asia/Kolkata (IST) display labels.
 */
export function formatInterviewIstSlot(startIso: string, endIso: string): {
  dateLabel: string;
  timeRangeLabel: string;
} {
  const s = new Date(startIso);
  const e = new Date(endIso);
  return {
    dateLabel: istInterviewDateFormatter.format(s),
    timeRangeLabel: `${istInterviewTimeFormatter.format(s)} – ${istInterviewTimeFormatter.format(e)} IST`,
  };
}

export const INTERVIEW_RECOMMENDATIONS = [
  "strong_hire",
  "hire",
  "hold",
  "no_hire",
] as const;
export type InterviewRecommendation = (typeof INTERVIEW_RECOMMENDATIONS)[number];

export const INTERVIEW_RECOMMENDATION_LABELS: Record<InterviewRecommendation, string> = {
  strong_hire: "Strong Hire",
  hire: "Hire",
  hold: "Hold / Undecided",
  no_hire: "No Hire",
};

const ALLOWED_TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
  applied: ["screening", "shortlisted", "interview_scheduled", "rejected", "on_hold", "withdrawn"],
  screening: ["shortlisted", "interview_scheduled", "rejected", "on_hold", "withdrawn"],
  shortlisted: ["screening", "interview_scheduled", "interviewed", "rejected", "on_hold", "withdrawn"],
  interview_scheduled: ["shortlisted", "interviewed", "selected", "rejected", "on_hold", "withdrawn"],
  interviewed: ["interview_scheduled", "selected", "offer_sent", "rejected", "on_hold", "withdrawn"],
  selected: ["interviewed", "offer_sent", "offer_accepted", "onboarding", "rejected", "on_hold", "withdrawn"],
  offer_sent: ["selected", "offer_accepted", "rejected", "on_hold", "withdrawn"],
  offer_accepted: ["offer_sent", "onboarding", "rejected", "on_hold", "withdrawn"],
  onboarding: ["offer_accepted", "withdrawn"],
  rejected: ["screening", "shortlisted", "on_hold"],
  on_hold: [
    "applied",
    "screening",
    "shortlisted",
    "interview_scheduled",
    "interviewed",
    "selected",
    "offer_sent",
    "rejected",
    "withdrawn",
  ],
  withdrawn: ["applied", "screening", "on_hold"],
};

export function isCandidateStatus(value: string): value is CandidateStatus {
  return (CANDIDATE_STATUSES as readonly string[]).includes(value);
}

/**
 * Validates candidate status progression.
 * Blocks invalid statuses, no-op transitions, mutating already-converted onboarding records,
 * and jumping directly into `onboarding` without conversion unless `viaConversion` is true.
 */
export function validateCandidateTransition(params: {
  fromStatus: CandidateStatus;
  toStatus: string;
  alreadyConverted?: boolean | undefined;
  viaConversion?: boolean | undefined;
}): { ok: true; toStatus: CandidateStatus } | { ok: false; reason: string } {
  const { fromStatus, toStatus, alreadyConverted = false, viaConversion = false } = params;

  if (!isCandidateStatus(toStatus)) {
    return { ok: false, reason: `Unknown candidate stage "${toStatus}".` };
  }
  if (fromStatus === toStatus) {
    return { ok: false, reason: `Candidate is already in "${CANDIDATE_STATUS_LABELS[toStatus]}".` };
  }
  if (alreadyConverted && fromStatus === "onboarding") {
    return {
      ok: false,
      reason:
        "This candidate has already been converted into an onboarding invitation. Manage their onboarding from Invitations or Workforce.",
    };
  }
  if (toStatus === "onboarding" && !viaConversion) {
    return {
      ok: false,
      reason:
        'Use "Convert to Employee Onboarding" to move a Selected / Offer Accepted candidate into Onboarding so an official invitation is queued.',
    };
  }

  const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      reason: `Cannot move candidate directly from "${CANDIDATE_STATUS_LABELS[fromStatus]}" to "${CANDIDATE_STATUS_LABELS[toStatus]}".`,
    };
  }

  return { ok: true, toStatus };
}

export type CandidateConversionCheckInput = {
  email: string;
  fullName: string;
  status: string;
  appliedCategory?: UserCategory | string | null | undefined;
  convertedInvitationId?: string | null | undefined;
  convertedUserId?: string | null | undefined;
};

export function canConvertCandidateToEmployee(
  candidate: CandidateConversionCheckInput,
  lookups: {
    existingWorkEmails: ReadonlySet<string>;
    activeInvitationEmails: ReadonlySet<string>;
  },
): { ok: true; normalizedEmail: string } | { ok: false; reason: string } {
  const normalizedEmail = String(candidate.email ?? "").trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, reason: "Candidate must have a valid email address before conversion." };
  }
  if (String(candidate.fullName ?? "").trim().length < 2) {
    return { ok: false, reason: "Candidate must have a full name before conversion." };
  }
  if (candidate.convertedUserId || candidate.convertedInvitationId) {
    return {
      ok: false,
      reason: "Candidate has already been converted to an employee onboarding invitation.",
    };
  }
  if (candidate.status !== "selected" && candidate.status !== "offer_accepted") {
    return {
      ok: false,
      reason:
        "Only candidates in Selected or Offer Accepted status can be converted into employee onboarding.",
    };
  }
  if (lookups.existingWorkEmails.has(normalizedEmail)) {
    return {
      ok: false,
      reason: `An employee account already exists for ${normalizedEmail}. Duplicate accounts are blocked.`,
    };
  }
  if (lookups.activeInvitationEmails.has(normalizedEmail)) {
    return {
      ok: false,
      reason: `An active onboarding invitation already exists for ${normalizedEmail}.`,
    };
  }
  return { ok: true, normalizedEmail };
}

export type RecruitmentKpiSummary = {
  totalCandidates: number;
  newApplications: number;
  shortlistedCandidates: number;
  interviewsScheduled: number;
  selectedCandidates: number;
  offersSent: number;
  pendingOnboarding: number;
  conversionRatePct: number;
  stageCounts: Record<CandidateStatus, number>;
};

export function createEmptyRecruitmentKpis(): RecruitmentKpiSummary {
  return {
    totalCandidates: 0,
    newApplications: 0,
    shortlistedCandidates: 0,
    interviewsScheduled: 0,
    selectedCandidates: 0,
    offersSent: 0,
    pendingOnboarding: 0,
    conversionRatePct: 0,
    stageCounts: {
      applied: 0,
      screening: 0,
      shortlisted: 0,
      interview_scheduled: 0,
      interviewed: 0,
      selected: 0,
      offer_sent: 0,
      offer_accepted: 0,
      onboarding: 0,
      rejected: 0,
      on_hold: 0,
      withdrawn: 0,
    },
  };
}

/**
 * Computes the 8 HR Recruitment Dashboard KPIs from real candidate & interview rows.
 */
export function calculateRecruitmentKpis(
  candidates: readonly {
    status: string;
    converted_user_id?: string | null | undefined;
  }[],
  activeInterviewsScheduledCount: number,
): RecruitmentKpiSummary {
  const base = createEmptyRecruitmentKpis();
  for (const row of candidates) {
    if (isCandidateStatus(row.status)) {
      base.stageCounts[row.status] += 1;
    }
  }

  const total = candidates.length;
  const newApplications = base.stageCounts.applied;
  const shortlistedCandidates = base.stageCounts.shortlisted;
  const selectedCandidates = base.stageCounts.selected;
  const offersSent = base.stageCounts.offer_sent + base.stageCounts.offer_accepted;
  const pendingOnboarding = candidates.filter(
    (c) =>
      (c.status === "offer_accepted" || c.status === "onboarding") && !c.converted_user_id,
  ).length;

  const positiveOutcomes =
    base.stageCounts.selected +
    base.stageCounts.offer_sent +
    base.stageCounts.offer_accepted +
    base.stageCounts.onboarding;

  const conversionRatePct =
    total > 0 ? Math.round((positiveOutcomes / total) * 1000) / 10 : 0;

  return {
    totalCandidates: total,
    newApplications,
    shortlistedCandidates,
    interviewsScheduled: activeInterviewsScheduledCount,
    selectedCandidates,
    offersSent,
    pendingOnboarding,
    conversionRatePct,
    stageCounts: base.stageCounts,
  };
}
