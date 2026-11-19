// KYC verification domain logic + notification email renderers (pure).
//
// Mirrors the authoritative SQL in
// `supabase/migrations/20261119200000_kyc_review_history_and_notification_outbox.sql`
// (`recompute_employee_kyc_state`). The database decides; this module is used
// for previews, HR UI summaries, eligibility checks and tests.
//
// Privacy rules (tested): emails contain ONLY the employee name, document TYPE
// labels, sanitised correction reasons and a trusted portal link. Never PAN /
// Aadhaar / bank numbers, files, file paths, signed URLs, DOB or tokens.

import { escapeHtml, wrapBrandedEmailHtml } from "../recruitment/email-templates";
import {
  DOCUMENT_TYPE_LABELS,
  REQUIRED_DOCUMENT_TYPES,
  type DocumentType,
} from "../permissions";

export const KYC_REQUIRED_DOCUMENT_TYPES: readonly DocumentType[] = REQUIRED_DOCUMENT_TYPES;

export const KYC_TEMPLATE_SLUGS = {
  verified: "kyc_verification_complete",
  correction: "kyc_correction_required",
} as const;

export type KycEmailKind = keyof typeof KYC_TEMPLATE_SLUGS;

export const KYC_EVENT_TYPES = [
  "kyc.all_required_documents_verified",
  "kyc.correction_requested",
  "kyc.document_rejected",
  "kyc.correction_resubmitted",
] as const;
export type KycEventType = (typeof KYC_EVENT_TYPES)[number];

export type KycStatus =
  | "not_started"
  | "incomplete"
  | "under_review"
  | "correction_required"
  | "verified";

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  not_started: "Not started",
  incomplete: "Incomplete",
  under_review: "Under review",
  correction_required: "Correction required",
  verified: "Verified",
};

export type DocumentDisplayState =
  | "not_uploaded"
  | "submitted"
  | "resubmitted"
  | "verified"
  | "rejected";

export const DOCUMENT_STATE_LABELS: Record<DocumentDisplayState, string> = {
  not_uploaded: "Not uploaded",
  submitted: "Submitted · Under review",
  resubmitted: "Resubmitted · Under review",
  verified: "Verified",
  rejected: "Correction required",
};

/** In-app notification copy (no sensitive detail in titles). */
export const KYC_NOTIFICATIONS = {
  verified: { type: "kyc.verified", title: "Your KYC verification is complete." },
  correction: {
    type: "kyc.correction_required",
    title: "Some KYC documents need correction. Open My Profile to review.",
  },
  under_review: { type: "kyc.under_review", title: "Your KYC documents are under review." },
} as const;

export type KycDocumentInput = {
  doc_type: string;
  status: string; // 'pending' | 'verified' | 'rejected'
  revision?: number | null;
  review_note?: string | null;
  created_at?: string | null;
};

export type KycDocumentRow = {
  docType: DocumentType;
  label: string;
  state: DocumentDisplayState;
  revision: number;
  reviewNote: string | null;
};

export type KycState = {
  status: KycStatus;
  required: number;
  verified: number;
  pending: number;
  rejected: number;
  missing: number;
  documents: KycDocumentRow[];
};

/** Same decision table as SQL `recompute_employee_kyc_state`. */
export function deriveKycState(docs: readonly KycDocumentInput[]): KycState {
  const latest = new Map<string, KycDocumentInput>();
  for (const d of docs) {
    const prev = latest.get(d.doc_type);
    if (!prev || String(d.created_at ?? "") > String(prev.created_at ?? "")) latest.set(d.doc_type, d);
  }

  const documents: KycDocumentRow[] = KYC_REQUIRED_DOCUMENT_TYPES.map((docType) => {
    const d = latest.get(docType);
    const revision = Math.max(1, Number(d?.revision ?? 1) || 1);
    let state: DocumentDisplayState = "not_uploaded";
    if (d?.status === "verified") state = "verified";
    else if (d?.status === "rejected") state = "rejected";
    else if (d?.status === "pending") state = revision > 1 ? "resubmitted" : "submitted";
    return {
      docType,
      label: DOCUMENT_TYPE_LABELS[docType] ?? docType,
      state,
      revision,
      reviewNote: d?.status === "rejected" ? (d.review_note ?? null) : null,
    };
  });

  const required = documents.length;
  const verified = documents.filter((d) => d.state === "verified").length;
  const rejected = documents.filter((d) => d.state === "rejected").length;
  const pending = documents.filter((d) => d.state === "submitted" || d.state === "resubmitted").length;
  const missing = required - verified - rejected - pending;

  let status: KycStatus;
  if (required > 0 && verified === required) status = "verified";
  else if (rejected > 0) status = "correction_required";
  else if (missing === required) status = "not_started";
  else if (missing > 0) status = "incomplete";
  else status = "under_review";

  return { status, required, verified, pending, rejected, missing, documents };
}

/** e.g. "3 of 5 required documents verified. 2 pending." */
export function summariseKycProgress(s: Pick<KycState, "required" | "verified" | "pending" | "rejected" | "missing">): string {
  const parts = [`${s.verified} of ${s.required} required documents verified.`];
  if (s.pending > 0) parts.push(`${s.pending} pending.`);
  if (s.rejected > 0) parts.push(`${s.rejected} need correction.`);
  if (s.missing > 0) parts.push(`${s.missing} not uploaded.`);
  return parts.join(" ");
}

const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi;
const LONG_DIGITS_RE = /(?:\d[\s-]?){8,}/g; // Aadhaar (12), bank accounts (9–18), phone numbers
const IFSC_RE = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAILISH_RE = /\S+@\S+\.\S+/g;
const CONTROL_RE = /[\u0000-\u001f\u007f]+/g;

/**
 * Makes an HR correction note safe for email: strips identity / account
 * numbers, URLs and control characters, collapses whitespace, caps length.
 */
export function sanitizeCorrectionReason(note: string | null | undefined): string {
  const cleaned = String(note ?? "")
    .replace(CONTROL_RE, " ")
    .replace(URL_RE, "[link removed]")
    .replace(EMAILISH_RE, "[email removed]")
    .replace(PAN_RE, "[redacted]")
    .replace(IFSC_RE, "[redacted]")
    .replace(LONG_DIGITS_RE, "[redacted] ")
    .replace(/\s+/g, " ")
    .trim();
  const capped = cleaned.length > 280 ? `${cleaned.slice(0, 277).trimEnd()}…` : cleaned;
  return capped || "Please upload a clearer, complete and valid copy.";
}

export type KycEmailEligibility = { allowed: true } | { allowed: false; reason: string };

/** HR may never send a misleading message: success only when complete, correction only when something is rejected. */
export function kycEmailEligibility(kind: KycEmailKind, state: Pick<KycState, "status" | "rejected">): KycEmailEligibility {
  if (kind === "verified") {
    return state.status === "verified"
      ? { allowed: true }
      : { allowed: false, reason: "KYC success can only be sent when every required document is verified." };
  }
  return state.rejected > 0
    ? { allowed: true }
    : { allowed: false, reason: "There are no rejected documents that require correction." };
}

export type RenderedEmail = { subject: string; html: string; text: string };

const HR_CONTACT = "hr@theaischool.co";

function button(href: string, label: string): string {
  return `<p style="margin:20px 0;text-align:center;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 28px;border-radius:6px;">${escapeHtml(label)}</a></p>`;
}

export const KYC_VERIFIED_SUBJECT = "The AI School — Your KYC Verification Is Complete";
export const KYC_CORRECTION_SUBJECT = "The AI School — Action Required for Your KYC Documents";

export function renderKycVerifiedEmail(input: { employeeName: string; portalUrl: string }): RenderedEmail {
  const portal = input.portalUrl.replace(/\/+$/, "");
  const link = `${portal}/onboarding`;
  const name = escapeHtml(input.employeeName);
  const inner = `
<p style="margin:0 0 14px;">Dear ${name},</p>
<p style="margin:0 0 14px;">We're pleased to inform you that your required KYC documents have been successfully reviewed and verified by The AI School HR team.</p>
<p style="margin:0 0 14px;"><strong>Your KYC verification is now complete.</strong></p>
<p style="margin:0 0 4px;">You can sign in to The AI School HRM to view your onboarding status and continue your employee activities.</p>
${button(link, "Open HRM Portal")}
<p style="margin:0;font-size:13px;color:#52525b;">Questions? Contact <a href="mailto:${HR_CONTACT}" style="color:#e11d48;">${HR_CONTACT}</a>.</p>
<p style="margin:14px 0 0;">Warm regards,<br/>The AI School HR</p>`;
  const html = wrapBrandedEmailHtml(KYC_VERIFIED_SUBJECT, inner, {
    portalUrl: portal,
    logoUrl: `${portal}/the-ai-school-logo.png`,
  });
  const text = [
    `Dear ${input.employeeName},`,
    "",
    "We're pleased to inform you that your required KYC documents have been successfully reviewed and verified by The AI School HR team.",
    "",
    "Your KYC verification is now complete.",
    "",
    "You can sign in to The AI School HRM to view your onboarding status and continue your employee activities.",
    `Open HRM Portal: ${link}`,
    "",
    `Questions? Contact ${HR_CONTACT}.`,
    "",
    "The AI School HR",
  ].join("\n");
  return { subject: KYC_VERIFIED_SUBJECT, html, text };
}

export type RejectedDocumentForEmail = { label: string; reason: string };

export function renderKycCorrectionEmail(input: {
  employeeName: string;
  portalUrl: string;
  rejected: readonly RejectedDocumentForEmail[];
  verifiedCount: number;
}): RenderedEmail {
  const portal = input.portalUrl.replace(/\/+$/, "");
  const link = `${portal}/onboarding`;
  const name = escapeHtml(input.employeeName);
  const items = input.rejected.map((r) => ({ label: r.label, reason: sanitizeCorrectionReason(r.reason) }));
  const partial = input.verifiedCount > 0;
  const intro = partial
    ? "Some documents have been verified successfully, but the following documents require correction:"
    : "The following documents require correction before your KYC verification can be completed:";

  const rows = items
    .map(
      (r, i) =>
        `<tr><td style="padding:10px 14px;font-size:13px;${i ? "border-top:1px solid #e4e4e7;" : ""}"><div style="font-weight:700;color:#09090b;">Document Type: ${escapeHtml(r.label)}</div><div style="color:#3f3f46;margin-top:2px;">Issue: ${escapeHtml(r.reason)}</div></td></tr>`,
    )
    .join("");

  const inner = `
<p style="margin:0 0 14px;">Dear ${name},</p>
<p style="margin:0 0 14px;">Our HR team has reviewed your submitted documents.</p>
<p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;border:1px solid #e4e4e7;border-left:3px solid #e11d48;border-radius:6px;background:#fafafa;">${rows}</table>
<p style="margin:0 0 4px;">Please sign in to The AI School HRM and upload the corrected documents.</p>
${button(link, "Review My Documents")}
<p style="margin:0;font-size:13px;color:#52525b;">Your employment is not affected by this request. Questions? Contact <a href="mailto:${HR_CONTACT}" style="color:#e11d48;">${HR_CONTACT}</a>.</p>
<p style="margin:14px 0 0;">Warm regards,<br/>The AI School HR</p>`;
  const html = wrapBrandedEmailHtml(KYC_CORRECTION_SUBJECT, inner, {
    portalUrl: portal,
    logoUrl: `${portal}/the-ai-school-logo.png`,
  });
  const text = [
    `Dear ${input.employeeName},`,
    "",
    "Our HR team has reviewed your submitted documents.",
    "",
    intro,
    "",
    ...items.flatMap((r) => [`Document Type: ${r.label}`, `Issue: ${r.reason}`, ""]),
    "Please sign in to The AI School HRM and upload the corrected documents.",
    `Review My Documents: ${link}`,
    "",
    `Questions? Contact ${HR_CONTACT}.`,
    "",
    "The AI School HR",
  ].join("\n");
  return { subject: KYC_CORRECTION_SUBJECT, html, text };
}

/** Builds the correction email input from a derived state (rejected docs only). */
export function correctionItemsFromState(state: KycState): RejectedDocumentForEmail[] {
  return state.documents
    .filter((d) => d.state === "rejected")
    .map((d) => ({ label: d.label, reason: d.reviewNote ?? "" }));
}

/** Exponential retry backoff for failed SMTP deliveries (minutes). */
export function kycRetryDelayMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

export const KYC_MAX_DELIVERY_ATTEMPTS = 5;
/** A manual send of the same kind inside this window needs explicit "resend" confirmation. */
export const KYC_MANUAL_RESEND_WINDOW_MINUTES = 15;
