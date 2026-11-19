import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActor, requirePermission } from "./actor.server";
import {
  KYC_MANUAL_RESEND_WINDOW_MINUTES,
  KYC_STATUS_LABELS,
  KYC_TEMPLATE_SLUGS,
  kycEmailEligibility,
  summariseKycProgress,
  type KycEmailKind,
} from "./kyc/kyc-notifications";

/**
 * KYC review & notification controls. HR (incl. HR interns holding the HR role)
 * and Super Admin only — the same rule as document verification. Managers,
 * Leads, Founder and Admin cannot read correction reasons or email history here.
 */
async function requireKycReviewer(
  supabase: Parameters<typeof requirePermission>[0],
  userId: string,
  targetUserId: string,
) {
  await requirePermission(supabase, userId, "documents:verify:all");
  const actor = await loadActor(supabase, userId);
  if (!actor.roles.includes("hr") && !actor.roles.includes("super_admin")) {
    throw new Error("Forbidden: only HR or Super Admin can manage KYC verification emails.");
  }
  if (targetUserId === userId) {
    throw new Error("You cannot manage KYC notifications for your own account.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: targetRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", targetUserId);
  if ((targetRoles ?? []).some((r) => r.role === "super_admin") && !actor.roles.includes("super_admin")) {
    throw new Error("Employee not found.");
  }
  return actor;
}

function assertKind(kind: unknown): KycEmailKind {
  if (kind !== "verified" && kind !== "correction") throw new Error("Unknown KYC email type.");
  return kind;
}

const KIND_EVENT: Record<KycEmailKind, string> = {
  verified: "kyc.all_required_documents_verified",
  correction: "kyc.correction_requested",
};

export type KycReviewSummary = {
  schemaReady: boolean;
  status: keyof typeof KYC_STATUS_LABELS;
  statusLabel: string;
  progress: string;
  counts: { required: number; verified: number; pending: number; rejected: number; missing: number };
  documents: { docType: string; label: string; state: string; revision: number; reviewNote: string | null }[];
  recipient: string | null;
  canSendVerified: { allowed: boolean; reason?: string };
  canSendCorrection: { allowed: boolean; reason?: string };
  lastEmail: { kind: KycEmailKind | null; subject: string; status: string; createdAt: string; sentAt: string | null; error: string | null } | null;
  emailHistory: { id: string; kind: KycEmailKind | null; subject: string; status: string; attempts: number; createdAt: string; sentAt: string | null; error: string | null }[];
  outbox: { id: string; eventType: string; status: string; source: string; attempts: number; availableAt: string; processedAt: string | null; lastError: string | null; skipReason: string | null }[];
};

function kindOfSlug(slug: string | null): KycEmailKind | null {
  if (slug === KYC_TEMPLATE_SLUGS.verified) return "verified";
  if (slug === KYC_TEMPLATE_SLUGS.correction) return "correction";
  return null;
}

export const getKycReviewSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("An employee id is required.");
    return { userId: String(input.userId) };
  })
  .handler(async ({ data, context }): Promise<KycReviewSummary> => {
    await requireKycReviewer(context.supabase, context.userId, data.userId);
    const { drainKycNotificationsSafely, loadKycContext } = await import("./kyc/kyc-notifications.server");
    const { isMissingSchemaResourceError } = await import("./schema-compat.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as unknown as SupabaseClient<any>;

    // Opportunistic delivery of any due (grouped) notifications for this employee.
    await drainKycNotificationsSafely(data.userId);

    const { profile, state } = await loadKycContext(data.userId);
    const recipient = profile?.work_email ?? null;

    const [{ data: outboxRows, error: outboxError }, { data: emails }] = await Promise.all([
      db
        .from("kyc_notification_outbox")
        .select("id, event_type, status, source, attempts, available_at, processed_at, last_error, skip_reason")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(20),
      recipient
        ? supabaseAdmin
            .from("email_messages")
            .select("id, template_slug, subject, status, attempts, created_at, sent_at, error_message")
            .eq("recipient_email", recipient)
            .in("template_slug", [KYC_TEMPLATE_SLUGS.verified, KYC_TEMPLATE_SLUGS.correction])
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const schemaReady = !(outboxError && isMissingSchemaResourceError(outboxError));

    const history = (emails ?? []).map((e) => ({
      id: e.id,
      kind: kindOfSlug(e.template_slug),
      subject: e.subject,
      status: e.status,
      attempts: e.attempts ?? 0,
      createdAt: e.created_at,
      sentAt: e.sent_at,
      error: e.error_message,
    }));
    const verifiedCheck = kycEmailEligibility("verified", state);
    const correctionCheck = kycEmailEligibility("correction", state);

    return {
      schemaReady,
      status: state.status,
      statusLabel: KYC_STATUS_LABELS[state.status],
      progress: summariseKycProgress(state),
      counts: {
        required: state.required,
        verified: state.verified,
        pending: state.pending,
        rejected: state.rejected,
        missing: state.missing,
      },
      documents: state.documents.map((d) => ({ ...d })),
      recipient,
      canSendVerified: verifiedCheck.allowed ? { allowed: true } : { allowed: false, reason: verifiedCheck.reason },
      canSendCorrection: correctionCheck.allowed ? { allowed: true } : { allowed: false, reason: correctionCheck.reason },
      lastEmail: history[0]
        ? {
            kind: history[0].kind,
            subject: history[0].subject,
            status: history[0].status,
            createdAt: history[0].createdAt,
            sentAt: history[0].sentAt,
            error: history[0].error,
          }
        : null,
      emailHistory: history,
      outbox: schemaReady
        ? ((outboxRows ?? []) as Record<string, unknown>[]).map((o) => ({
            id: String(o["id"]),
            eventType: String(o["event_type"]),
            status: String(o["status"]),
            source: String(o["source"]),
            attempts: Number(o["attempts"] ?? 0),
            availableAt: String(o["available_at"]),
            processedAt: (o["processed_at"] as string | null) ?? null,
            lastError: (o["last_error"] as string | null) ?? null,
            skipReason: (o["skip_reason"] as string | null) ?? null,
          }))
        : [],
    };
  });

/** Exact preview of what would be sent now (same renderer + eligibility as automation). */
export const previewKycEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; kind: KycEmailKind }) => ({
    userId: String(input?.userId ?? ""),
    kind: assertKind(input?.kind),
  }))
  .handler(async ({ data, context }) => {
    await requireKycReviewer(context.supabase, context.userId, data.userId);
    const { loadKycContext, renderKycEmailForState } = await import("./kyc/kyc-notifications.server");
    const { resolveEmailPortalUrl } = await import("./recruitment/email-transport.server");
    const { profile, state } = await loadKycContext(data.userId);
    if (!profile?.work_email) throw new Error("This employee has no work email on file.");
    const eligibility = kycEmailEligibility(data.kind, state);
    if (!eligibility.allowed) throw new Error(eligibility.reason);
    const rendered = renderKycEmailForState(
      data.kind,
      profile.full_name?.trim() || profile.work_email,
      state,
      resolveEmailPortalUrl(),
    );
    if ("skip" in rendered) throw new Error(rendered.skip);
    return {
      recipient: profile.work_email,
      subject: rendered.email.subject,
      template: KYC_TEMPLATE_SLUGS[data.kind],
      html: rendered.email.html,
      text: rendered.email.text,
      progress: summariseKycProgress(state),
    };
  });

/**
 * Manual send / resend. Uses the same outbox, renderer and eligibility rules as
 * automation. A send of the same kind within the resend window requires
 * `confirmResend: true`.
 */
export const sendKycEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; kind: KycEmailKind; confirmResend?: boolean }) => ({
    userId: String(input?.userId ?? ""),
    kind: assertKind(input?.kind),
    confirmResend: input?.confirmResend === true,
  }))
  .handler(async ({ data, context }) => {
    const actor = await requireKycReviewer(context.supabase, context.userId, data.userId);
    const { loadKycContext, processKycNotifications } = await import("./kyc/kyc-notifications.server");
    const { isMissingSchemaResourceError } = await import("./schema-compat.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { writeAudit } = await import("./audit.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as unknown as SupabaseClient<any>;

    const { profile, state } = await loadKycContext(data.userId);
    if (!profile?.work_email) throw new Error("This employee has no work email on file.");
    const eligibility = kycEmailEligibility(data.kind, state);
    if (!eligibility.allowed) throw new Error(eligibility.reason);

    // Duplicate prevention.
    const { data: recent } = await supabaseAdmin
      .from("email_messages")
      .select("id, status, created_at")
      .eq("recipient_email", profile.work_email)
      .eq("template_slug", KYC_TEMPLATE_SLUGS[data.kind])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent && !data.confirmResend) {
      const ageMin = (Date.now() - new Date(recent.created_at).getTime()) / 60000;
      if (ageMin < KYC_MANUAL_RESEND_WINDOW_MINUTES && recent.status !== "failed") {
        throw new Error(
          `This email was already sent ${Math.max(1, Math.round(ageMin))} min ago. Confirm "Resend" to send it again.`,
        );
      }
    }

    // A pending automatic correction for this employee is delivered now instead of duplicated.
    let ids: string[] = [];
    if (data.kind === "correction") {
      const { data: pending } = await db
        .from("kyc_notification_outbox")
        .select("id")
        .eq("user_id", data.userId)
        .eq("event_type", KIND_EVENT.correction)
        .eq("status", "pending");
      ids = ((pending ?? []) as { id: string }[]).map((p) => p.id);
      if (ids.length) {
        await db
          .from("kyc_notification_outbox")
          .update({ available_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .in("id", ids);
      }
    }

    if (ids.length === 0) {
      const { data: created, error } = await db
        .from("kyc_notification_outbox")
        .insert({
          user_id: data.userId,
          event_type: KIND_EVENT[data.kind],
          dedupe_key: `manual:${data.kind}:${data.userId}:${Date.now()}`,
          source: "manual",
          created_by: actor.userId,
        })
        .select("id")
        .single();
      if (error) {
        if (isMissingSchemaResourceError(error)) {
          throw new Error("KYC notifications are unavailable until the KYC outbox migration is applied.");
        }
        throw error;
      }
      ids = [String((created as { id: string }).id)];
    }

    const { results } = await processKycNotifications({ ids, limit: ids.length });
    await writeAudit(supabaseAdmin, {
      actorId: actor.userId,
      action: "kyc.notification_manual_send",
      entityType: "profile",
      entityId: data.userId,
      detail: { kind: data.kind, resend: data.confirmResend, outcomes: results.map((r) => r.outcome) },
    });
    const first = results[0];
    if (!first) throw new Error("The email is already being processed. Refresh in a moment.");
    if (first.outcome === "skipped") throw new Error(first.reason);
    return first;
  });

/** Re-queues a failed outbox event (rendered again from live state when delivered). */
export const retryKycNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; outboxId: string }) => ({
    userId: String(input?.userId ?? ""),
    outboxId: String(input?.outboxId ?? ""),
  }))
  .handler(async ({ data, context }) => {
    await requireKycReviewer(context.supabase, context.userId, data.userId);
    const { processKycNotifications } = await import("./kyc/kyc-notifications.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as unknown as SupabaseClient<any>;
    const { data: updated } = await db
      .from("kyc_notification_outbox")
      .update({ status: "pending", available_at: new Date().toISOString(), attempts: 0, updated_at: new Date().toISOString() })
      .eq("id", data.outboxId)
      .eq("user_id", data.userId)
      .eq("status", "failed")
      .select("id");
    if (!updated || (updated as unknown[]).length === 0) throw new Error("Only failed notifications can be retried.");
    const { results } = await processKycNotifications({ ids: [data.outboxId], limit: 1 });
    return results[0] ?? null;
  });
