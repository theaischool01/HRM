// Account setup ("welcome + set your password") email — pure renderer.
//
// Security rules enforced here and covered by tests:
//   * No passwords, no date of birth, no PAN / bank / document data.
//   * No password is ever derived from name, DOB or employee ID — the employee
//     chooses their own through a single-use Supabase Auth setup link.
//   * The secure link is passed in by the server and is single-use and
//     time-limited by Supabase Auth; it is redacted before being stored.
//   * Every URL comes from the validated canonical portal origin.

import { escapeHtml, wrapBrandedEmailHtml } from "../recruitment/email-templates";

export const ACCOUNT_SETUP_EMAIL_SUBJECT = "Welcome to The AI School — Your HRM Account Is Ready";
export const ACCOUNT_SETUP_HR_CONTACT = "hr@theaischool.co";
/** Placeholder written to audit/email history instead of the real one-time link. */
export const REDACTED_SETUP_LINK = "[secure single-use setup link — redacted]";

export type AccountSetupEmailInput = {
  fullName: string;
  employeeCode: string;
  designation: string | null;
  workEmail: string;
  setupUrl: string;
  portalUrl: string;
  /** Human-readable expiry guidance, e.g. "1 hour". */
  linkExpiryLabel: string;
  roleLabel?: string | null;
  categoryLabel?: string | null;
};

export const ACCOUNT_SETUP_STEPS = [
  "Click Set Up My Account below.",
  "Create your personal password.",
  "Sign in to The AI School HRM with your work email and new password.",
  "Complete your employee profile.",
  "Upload the required KYC documents.",
  "HR will review your documents and email you the result.",
] as const;

function detailRow(label: string, valueHtml: string, first = false): string {
  const border = first ? "" : "border-top:1px solid #e4e4e7;";
  return `<tr><td style="padding:10px 14px;font-size:13px;color:#52525b;width:38%;${border}">${label}</td><td style="padding:10px 14px;font-size:14px;color:#09090b;${border}">${valueHtml}</td></tr>`;
}

export function renderAccountSetupEmail(input: AccountSetupEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const portal = input.portalUrl.replace(/\/+$/, "");
  const signInUrl = `${portal}/auth`;
  const designationPlain = input.designation?.trim() || "Team Member";
  const roleLine = [input.categoryLabel, input.roleLabel].filter((v) => v && v.trim()).join(" · ");

  const rows = [
    detailRow("Name", `<strong>${escapeHtml(input.fullName)}</strong>`, true),
    detailRow(
      "Employee ID",
      `<span style="font-weight:700;color:#e11d48;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(input.employeeCode)}</span>`,
    ),
    detailRow("Work email (login)", escapeHtml(input.workEmail)),
    detailRow("Designation", escapeHtml(designationPlain)),
    roleLine ? detailRow("Category &amp; role", escapeHtml(roleLine)) : "",
    detailRow(
      "HRM portal",
      `<a href="${escapeHtml(signInUrl)}" style="color:#e11d48;text-decoration:none;">${escapeHtml(portal.replace(/^https:\/\//, ""))}</a>`,
    ),
  ].join("");

  const steps = ACCOUNT_SETUP_STEPS.map((s) => `<li style="margin:0 0 4px;">${escapeHtml(s)}</li>`).join("");

  const inner = `
<p style="margin:0 0 14px;">Dear ${escapeHtml(input.fullName)},</p>
<p style="margin:0 0 16px;">Welcome to <strong>The AI School</strong>! Your HRM account is ready. Use the secure button below to create your password and get started.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;">${rows}</table>
<p style="margin:0 0 20px;text-align:center;">
  <a href="${escapeHtml(input.setupUrl)}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:6px;">Set Up My Account</a>
</p>
<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#09090b;">Getting started</p>
<ol style="margin:0 0 16px;padding-left:20px;font-size:13px;line-height:1.7;color:#3f3f46;">${steps}</ol>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;border-left:3px solid #18181b;background:#f4f4f5;">
  <tr><td style="padding:10px 14px;font-size:12.5px;line-height:1.6;color:#3f3f46;">
    <strong>Choosing your password:</strong> use at least 8 characters with letters plus a number or symbol — for example, three unrelated words joined with a number. Avoid your name, birth date or employee ID. A password manager can generate and remember it for you.
  </td></tr>
</table>
<p style="margin:0 0 14px;font-size:13px;color:#52525b;">For your security this link works <strong>once</strong> and expires after <strong>${escapeHtml(input.linkExpiryLabel)}</strong>. If it has expired, use <em>Forgot password</em> at <a href="${escapeHtml(signInUrl)}" style="color:#e11d48;">${escapeHtml(signInUrl)}</a> or ask HR to send a new setup email. The AI School will never email you a password or ask for it.</p>
<p style="margin:0;font-size:13px;color:#52525b;">Need help? Contact <a href="mailto:${ACCOUNT_SETUP_HR_CONTACT}" style="color:#e11d48;">${ACCOUNT_SETUP_HR_CONTACT}</a>.</p>
<p style="margin:14px 0 0;">Warm regards,<br/>The AI School HR</p>`;

  const html = wrapBrandedEmailHtml(ACCOUNT_SETUP_EMAIL_SUBJECT, inner, {
    portalUrl: portal,
    logoUrl: `${portal}/the-ai-school-logo.png`,
  });

  const text = [
    `Dear ${input.fullName},`,
    "",
    "Welcome to The AI School! Your HRM account is ready.",
    "",
    `Name: ${input.fullName}`,
    `Employee ID: ${input.employeeCode}`,
    `Work email (login): ${input.workEmail}`,
    `Designation: ${designationPlain}`,
    ...(roleLine ? [`Category & role: ${roleLine}`] : []),
    `HRM portal: ${signInUrl}`,
    "",
    "Set up your account using this secure link:",
    input.setupUrl,
    "",
    "Getting started:",
    ...ACCOUNT_SETUP_STEPS.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Choosing your password: at least 8 characters with letters plus a number or symbol. Avoid your name, birth date or employee ID.",
    "",
    `The link works once and expires after ${input.linkExpiryLabel}. If it has expired, use "Forgot password" at ${signInUrl} or ask HR for a new setup email.`,
    "",
    `Need help? Contact ${ACCOUNT_SETUP_HR_CONTACT}.`,
    "",
    "The AI School HR",
  ].join("\n");

  return { subject: ACCOUNT_SETUP_EMAIL_SUBJECT, html, text };
}

/** Replaces every occurrence of the one-time link so history rows never hold a live token. */
export function redactSetupLink(content: string, setupUrl: string): string {
  if (!setupUrl) return content;
  const escaped = escapeHtml(setupUrl);
  return content.split(escaped).join(REDACTED_SETUP_LINK).split(setupUrl).join(REDACTED_SETUP_LINK);
}

/** Builds the HRM-hosted setup URL from Supabase's hashed recovery token. */
export function buildAccountSetupUrl(portalUrl: string, hashedToken: string): string {
  const base = portalUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({ token_hash: hashedToken, type: "recovery", setup: "1" });
  return `${base}/auth/reset-password?${params.toString()}`;
}
