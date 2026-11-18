// Account setup ("welcome + set your password") email — pure renderer.
//
// Security rules enforced here and covered by tests:
//   * No passwords, no date of birth, no PAN / bank / document data.
//   * The secure link is passed in by the server and is single-use and
//     time-limited by Supabase Auth; it is never logged or stored.
//   * The subject never contains personal data beyond the brand.

import { escapeHtml, wrapBrandedEmailHtml } from "../recruitment/email-templates";

export const ACCOUNT_SETUP_EMAIL_SUBJECT = "Welcome to The AI School — Set Up Your HRM Account";
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
};

export function renderAccountSetupEmail(input: AccountSetupEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const portal = input.portalUrl.replace(/\/+$/, "");
  const name = escapeHtml(input.fullName);
  const code = escapeHtml(input.employeeCode);
  const designation = escapeHtml(input.designation?.trim() || "Team Member");
  const email = escapeHtml(input.workEmail);
  const url = escapeHtml(input.setupUrl);
  const expiry = escapeHtml(input.linkExpiryLabel);

  const inner = `
<p style="margin:0 0 14px;">Dear ${name},</p>
<p style="margin:0 0 14px;">Welcome to <strong>The AI School</strong>! Your HRM account has been created. Please set up your password to sign in.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;">
  <tr><td style="padding:10px 14px;font-size:13px;color:#52525b;width:40%;">Employee ID</td><td style="padding:10px 14px;font-size:14px;font-weight:700;color:#e11d48;">${code}</td></tr>
  <tr><td style="padding:10px 14px;font-size:13px;color:#52525b;border-top:1px solid #e4e4e7;">Designation</td><td style="padding:10px 14px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${designation}</td></tr>
  <tr><td style="padding:10px 14px;font-size:13px;color:#52525b;border-top:1px solid #e4e4e7;">Work email (login)</td><td style="padding:10px 14px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${email}</td></tr>
</table>
<p style="margin:0 0 18px;text-align:center;">
  <a href="${url}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:6px;">Set up my account</a>
</p>
<p style="margin:0 0 8px;font-size:13px;color:#52525b;"><strong>How to sign in</strong></p>
<ol style="margin:0 0 14px;padding-left:20px;font-size:13px;line-height:1.7;color:#3f3f46;">
  <li>Click <strong>Set up my account</strong> and choose your own strong password.</li>
  <li>Afterwards, sign in at <a href="${escapeHtml(portal)}/auth" style="color:#e11d48;">${escapeHtml(portal)}</a> with your work email and that password.</li>
  <li>Complete your profile and onboarding documents for HR verification.</li>
</ol>
<p style="margin:0 0 14px;font-size:13px;color:#52525b;">For your security this link works <strong>once</strong> and expires after <strong>${expiry}</strong>. If it has expired, ask HR to send a new setup email or use <em>Forgot password</em> on the sign-in page. The AI School will never ask for your password by email.</p>
<p style="margin:0;font-size:13px;color:#52525b;">Questions? Contact <a href="mailto:${ACCOUNT_SETUP_HR_CONTACT}" style="color:#e11d48;">${ACCOUNT_SETUP_HR_CONTACT}</a>.</p>
<p style="margin:14px 0 0;">Warm regards,<br/>The AI School HR</p>`;

  const html = wrapBrandedEmailHtml(ACCOUNT_SETUP_EMAIL_SUBJECT, inner, {
    portalUrl: portal,
    logoUrl: `${portal}/the-ai-school-logo.png`,
  });

  const text = [
    `Dear ${input.fullName},`,
    "",
    "Welcome to The AI School! Your HRM account has been created.",
    "",
    `Employee ID: ${input.employeeCode}`,
    `Designation: ${input.designation?.trim() || "Team Member"}`,
    `Work email (login): ${input.workEmail}`,
    "",
    "Set up your password using this secure link:",
    input.setupUrl,
    "",
    `The link works once and expires after ${input.linkExpiryLabel}. If it has expired, ask HR for a new setup email or use "Forgot password" at ${portal}/auth.`,
    "",
    `Questions? Contact ${ACCOUNT_SETUP_HR_CONTACT}.`,
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
