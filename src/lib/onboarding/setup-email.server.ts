// Server-only account setup email dispatch through Hostinger SMTP.
//
// * Never sends automatically — only called from an explicit, confirmed HR action.
// * The one-time link comes from Supabase Auth `generateLink({ type: "recovery" })`
//   (single-use, expiry enforced by Supabase). Supabase itself sends nothing.
// * The link is redacted before anything is persisted or logged.
// * Status: SMTP 250 → `accepted_by_smtp` (never "delivered"); "Confirmed" is a
//   separate event recorded when the employee actually sets their password.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAudit } from "../audit.server";
import {
  buildAccountSetupUrl,
  redactSetupLink,
  renderAccountSetupEmail,
} from "../emails/account-setup-email";
import { canModifyUserRoles, CATEGORY_LABELS, ROLE_LABELS, resolvePrimaryRole, type UserCategory } from "../permissions";
import {
  createHostingerSmtpTransport,
  getRuntimeServerEnv,
  inspectEmailProviderConfig,
  resolveEmailPortalUrl,
} from "../recruitment/email-transport.server";
import { ACCOUNT_SETUP_TEMPLATE_SLUG } from "./employee-onboarding";

/** Re-sending inside this window requires an explicit "resend" confirmation. */
export const SETUP_EMAIL_DEDUPE_MINUTES = 15;

export type SetupEmailResult = {
  userId: string;
  email: string | null;
  outcome: "smtp_accepted" | "failed" | "skipped";
  reason: string;
  messageId: string | null;
};

/** Canonical HTTPS portal origin (validated; throws instead of falling back to localhost). */
export function resolvePortalUrl(): string {
  return resolveEmailPortalUrl();
}

export function setupLinkExpiryLabel(): string {
  const env = getRuntimeServerEnv();
  return (env["AUTH_SETUP_LINK_EXPIRY_LABEL"] || "1 hour").trim().slice(0, 40);
}

function summariseRoleLabel(roles: readonly string[]): string | null {
  if (roles.length === 0) return null;
  return ROLE_LABELS[resolvePrimaryRole(roles)] ?? null;
}

export function assertSmtpReady(): void {
  const cfg = inspectEmailProviderConfig();
  if (!cfg.configured) {
    throw new Error(`Hostinger SMTP is not configured: ${cfg.issues.join(" ")}`);
  }
}

export async function sendAccountSetupEmail(params: {
  targetUserId: string;
  actorId: string;
  actorRoles: readonly string[];
  allowResend: boolean;
}): Promise<SetupEmailResult> {
  const { targetUserId, actorId, actorRoles, allowResend } = params;
  const skip = (reason: string, email: string | null = null): SetupEmailResult => ({
    userId: targetUserId,
    email,
    outcome: "skipped",
    reason,
    messageId: null,
  });

  if (targetUserId === actorId) return skip("You cannot send a setup email to your own account.");

  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, work_email, employee_code, designation, category, account_status, must_change_password")
      .eq("id", targetUserId)
      .maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", targetUserId),
  ]);
  const targetRoles = (roleRows ?? []).map((r) => r.role as string);

  // Protected Super Admin and accounts above the actor's authority are invisible here.
  if (!profile || targetRoles.includes("super_admin") || !canModifyUserRoles(actorRoles, targetRoles)) {
    return skip("Employee account not found.");
  }
  if (!profile.work_email || !profile.employee_code) return skip("Account is incomplete.", profile.work_email);
  if (profile.must_change_password !== true) {
    return skip("Account setup already completed — the employee can use Forgot password.", profile.work_email);
  }

  // Duplicate-delivery guard on retries.
  const { data: recent } = await supabaseAdmin
    .from("email_messages")
    .select("id, status, created_at")
    .eq("template_slug", ACCOUNT_SETUP_TEMPLATE_SLUG)
    .eq("recipient_email", profile.work_email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent && !allowResend) {
    const ageMin = (Date.now() - new Date(recent.created_at).getTime()) / 60000;
    if (["sending", "queued"].includes(recent.status) && ageMin < SETUP_EMAIL_DEDUPE_MINUTES) {
      return skip("A setup email is already being sent.", profile.work_email);
    }
    if (["accepted_by_smtp", "sent", "delivered"].includes(recent.status) && ageMin < SETUP_EMAIL_DEDUPE_MINUTES) {
      return skip(
        `A setup email was accepted ${Math.max(1, Math.round(ageMin))} min ago. Use "Resend" to send another.`,
        profile.work_email,
      );
    }
  }

  // One-time link (Supabase sends nothing itself with generateLink).
  let portalUrl: string;
  try {
    portalUrl = resolvePortalUrl();
  } catch (error) {
    return {
      userId: targetUserId,
      email: profile.work_email,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Portal URL is not configured.",
      messageId: null,
    };
  }
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: profile.work_email,
    options: { redirectTo: `${portalUrl}/auth/reset-password` },
  });
  const hashedToken = link?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    await writeAudit(supabaseAdmin, {
      actorId,
      action: "employee.setup_email_failed",
      entityType: "profile",
      entityId: targetUserId,
      detail: { stage: "link_generation", employee_code: profile.employee_code },
    });
    return {
      userId: targetUserId,
      email: profile.work_email,
      outcome: "failed",
      reason: "Could not generate a secure setup link.",
      messageId: null,
    };
  }

  const setupUrl = buildAccountSetupUrl(portalUrl, hashedToken);
  const rendered = renderAccountSetupEmail({
    fullName: profile.full_name ?? profile.work_email,
    employeeCode: profile.employee_code,
    designation: profile.designation,
    workEmail: profile.work_email,
    setupUrl,
    portalUrl,
    linkExpiryLabel: setupLinkExpiryLabel(),
    roleLabel: summariseRoleLabel(targetRoles),
    categoryLabel: CATEGORY_LABELS[profile.category as UserCategory] ?? null,
  });

  const idempotencyKey = `${ACCOUNT_SETUP_TEMPLATE_SLUG}:${targetUserId}:${Date.now()}`;
  const { data: msgRow } = await supabaseAdmin
    .from("email_messages")
    .insert({
      idempotency_key: idempotencyKey,
      template_slug: ACCOUNT_SETUP_TEMPLATE_SLUG,
      recipient_email: profile.work_email,
      recipient_name: profile.full_name,
      subject: rendered.subject,
      body_html: redactSetupLink(rendered.html, setupUrl),
      body_text: redactSetupLink(rendered.text, setupUrl),
      variables_payload: { user_id: targetUserId, employee_code: profile.employee_code } as never,
      is_test: false,
      status: "sending",
      provider: "hostinger_smtp",
      attempts: 0,
      sent_by: actorId,
    } as never)
    .select("id")
    .single();

  const transport = createHostingerSmtpTransport();
  const sendResult = await transport.send({
    to: profile.work_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
  });

  if (msgRow?.id) {
    await supabaseAdmin
      .from("email_messages")
      .update({
        status: sendResult.status,
        provider_message_id: sendResult.ok ? sendResult.providerMessageId : null,
        smtp_response: sendResult.ok ? sendResult.smtpResponse : null,
        attempts: Math.max(1, sendResult.attemptsUsed),
        error_message: sendResult.ok ? null : sendResult.errorMessage,
        sent_at: sendResult.ok ? new Date().toISOString() : null,
      } as never)
      .eq("id", msgRow.id);
  }

  await writeAudit(supabaseAdmin, {
    actorId,
    action: sendResult.ok ? "employee.setup_email_accepted" : "employee.setup_email_failed",
    entityType: "profile",
    entityId: targetUserId,
    detail: {
      employee_code: profile.employee_code,
      email_message_id: msgRow?.id ?? null,
      status: sendResult.status,
      resend: allowResend,
      ...(sendResult.ok ? {} : { error: sendResult.errorMessage }),
    },
  });

  return {
    userId: targetUserId,
    email: profile.work_email,
    outcome: sendResult.ok ? "smtp_accepted" : "failed",
    reason: sendResult.ok ? "Accepted by Hostinger SMTP (not proof of inbox delivery)." : sendResult.errorMessage,
    messageId: msgRow?.id ?? null,
  };
}
