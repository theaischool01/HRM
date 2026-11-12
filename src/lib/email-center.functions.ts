import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActor, requirePermission, rethrowDbError } from "./actor.server";
import { formatInterviewIstSlot } from "./interviews.functions";
import {
  buildEmailIdempotencyKey,
  DEFAULT_EMAIL_TEMPLATES,
  renderEmailTemplate,
  SUPPORTED_EMAIL_VARIABLES,
  validateTemplateVariables,
  type EmailVariableKey,
} from "./recruitment/email-templates";
import {
  createResendEmailTransport,
  inspectEmailProviderConfig,
} from "./recruitment/email-transport.server";
import { isMissingSchemaResourceError } from "./schema-compat.server";

const PENDING_SCHEMA_MSG =
  "Phase P2 Email Center tables are not yet deployed to this database. Apply migration 20261112000000_p2_recruitment_interviews_and_email_center.sql after approval.";

export const getEmailCenterData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const actor = await loadActor(supabase, userId);
    await requirePermission(supabase, userId, "emails:read:all");

    const providerStatus = inspectEmailProviderConfig();

    const [templatesRes, messagesRes, candidatesRes, { data: departments }] =
      await Promise.all([
        supabase.from("email_templates").select("*").order("name"),
        supabase
          .from("email_messages")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(150),
        actor.permissions.includes("recruitment:read:all")
          ? supabase
              .from("candidates")
              .select(
                "id, candidate_code, full_name, email, designation, department_id, status, available_joining_date",
              )
              .order("created_at", { ascending: false })
              .limit(300)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("departments").select("id, name"),
      ]);

    const schemaReady =
      (!templatesRes.error || !isMissingSchemaResourceError(templatesRes.error)) &&
      (!messagesRes.error || !isMissingSchemaResourceError(messagesRes.error));

    if (templatesRes.error && schemaReady) {
      rethrowDbError("Loading email templates failed", templatesRes.error);
    }
    if (messagesRes.error && schemaReady) {
      rethrowDbError("Loading email delivery logs failed", messagesRes.error);
    }

    const dbBySlug = new Map((templatesRes.data ?? []).map((t) => [t.slug, t]));

    // Guarantee all 12 standard HR templates are always available for preview/editing
    const templates = DEFAULT_EMAIL_TEMPLATES.map((def) => {
      const dbRow = dbBySlug.get(def.slug);
      return {
        id: dbRow?.id ?? null,
        slug: def.slug,
        name: dbRow?.name ?? def.name,
        category: dbRow?.category ?? def.category,
        subjectTemplate: dbRow?.subject_template ?? def.subjectTemplate,
        bodyHtmlTemplate: dbRow?.body_html_template ?? def.bodyHtmlTemplate,
        bodyTextTemplate: dbRow?.body_text_template ?? def.bodyTextTemplate,
        variables: (dbRow?.variables ?? def.variables) as string[],
        isActive: dbRow?.is_active ?? true,
        updatedAt: dbRow?.updated_at ?? null,
      };
    });

    const deptMap = new Map((departments ?? []).map((d) => [d.id, d.name]));
    const candidates = (candidatesRes.error ? [] : (candidatesRes.data ?? [])).map((c) => ({
      id: c.id,
      candidateCode: c.candidate_code,
      fullName: c.full_name,
      email: c.email,
      designation: c.designation,
      departmentName: c.department_id ? (deptMap.get(c.department_id) ?? null) : null,
      status: c.status,
      joiningDate: c.available_joining_date,
    }));

    const messages = messagesRes.data ?? [];
    const stats = {
      total: messages.length,
      draft: messages.filter((m) => m.status === "draft").length,
      sent: messages.filter((m) => m.status === "sent").length,
      delivered: messages.filter((m) => m.status === "delivered").length,
      failed: messages.filter((m) => m.status === "failed").length,
    };

    return {
      schemaReady,
      canManageTemplates: actor.permissions.includes("emails:manage:all"),
      canSendEmails: actor.permissions.includes("emails:send:all"),
      actorContact: `${actor.fullName} (${actor.workEmail})`,
      providerStatus,
      supportedVariables: [...SUPPORTED_EMAIL_VARIABLES],
      templates,
      messages,
      stats,
      candidates,
    };
  });

export const saveEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      slug: string;
      name: string;
      category: string;
      subjectTemplate: string;
      bodyHtmlTemplate: string;
      bodyTextTemplate?: string | null | undefined;
      isActive?: boolean | undefined;
    }) => {
      const slug = String(input?.slug ?? "").trim();
      const name = String(input?.name ?? "").trim();
      const subjectTemplate = String(input?.subjectTemplate ?? "").trim();
      const bodyHtmlTemplate = String(input?.bodyHtmlTemplate ?? "").trim();
      if (!slug || !name || !subjectTemplate || !bodyHtmlTemplate) {
        throw new Error("Template slug, name, subject, and HTML body are required.");
      }
      const check = validateTemplateVariables({
        subjectTemplate,
        bodyHtmlTemplate,
        bodyTextTemplate: input.bodyTextTemplate,
      });
      if (!check.valid) {
        throw new Error(
          `Unsupported template variable(s): ${check.unknownVariables.map((v) => `{{${v}}}`).join(", ")}. Allowed variables: ${SUPPORTED_EMAIL_VARIABLES.map((v) => `{{${v}}}`).join(", ")}`,
        );
      }
      return {
        ...input,
        slug,
        name,
        subjectTemplate,
        bodyHtmlTemplate,
        usedVariables: check.usedVariables,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "emails:manage:all");

    const { error } = await supabase.from("email_templates").upsert(
      {
        slug: data.slug,
        name: data.name,
        category: data.category || "recruitment",
        subject_template: data.subjectTemplate,
        body_html_template: data.bodyHtmlTemplate,
        body_text_template: data.bodyTextTemplate?.trim() || null,
        variables: data.usedVariables,
        is_active: data.isActive ?? true,
        updated_by: userId,
      },
      { onConflict: "slug" },
    );

    if (error) {
      if (isMissingSchemaResourceError(error)) throw new Error(PENDING_SCHEMA_MSG);
      rethrowDbError("Saving email template failed", error);
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "email_template.saved",
      entityType: "email_template",
      entityId: data.slug,
      detail: { name: data.name, variables: data.usedVariables },
    });

    return { ok: true };
  });

export const resetEmailTemplateToDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { slug: string }) => {
    if (!input?.slug) throw new Error("Template slug is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "emails:manage:all");

    const def = DEFAULT_EMAIL_TEMPLATES.find((t) => t.slug === data.slug);
    if (!def) throw new Error(`No default template exists for "${data.slug}".`);

    const { error } = await supabase.from("email_templates").upsert(
      {
        slug: def.slug,
        name: def.name,
        category: def.category,
        subject_template: def.subjectTemplate,
        body_html_template: def.bodyHtmlTemplate,
        body_text_template: def.bodyTextTemplate,
        variables: [...def.variables],
        is_active: true,
        updated_by: userId,
      },
      { onConflict: "slug" },
    );

    if (error) {
      if (isMissingSchemaResourceError(error)) throw new Error(PENDING_SCHEMA_MSG);
      rethrowDbError("Resetting email template failed", error);
    }

    return { ok: true };
  });

export const saveEmailDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      templateSlug?: string | null | undefined;
      candidateId?: string | null | undefined;
      recipientEmail: string;
      recipientName?: string | null | undefined;
      subject: string;
      bodyHtml: string;
      bodyText?: string | null | undefined;
      variables?: Partial<Record<EmailVariableKey, string>> | undefined;
    }) => {
      const recipientEmail = String(input?.recipientEmail ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
        throw new Error("Enter a valid recipient email address.");
      }
      if (!String(input?.subject ?? "").trim()) throw new Error("Email subject is required.");
      if (!String(input?.bodyHtml ?? "").trim()) throw new Error("Email body is required.");
      return { ...input, recipientEmail };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "emails:send:all");

    const idempotencyKey = `draft:${crypto.randomUUID()}`;
    const { data: saved, error } = await supabase
      .from("email_messages")
      .insert({
        idempotency_key: idempotencyKey,
        template_slug: data.templateSlug ?? null,
        candidate_id: data.candidateId ?? null,
        recipient_email: data.recipientEmail,
        recipient_name: data.recipientName?.trim() || null,
        subject: data.subject.trim(),
        body_html: data.bodyHtml,
        body_text: data.bodyText ?? null,
        variables_payload: (data.variables ?? {}) as never,
        status: "draft",
        sent_by: userId,
      })
      .select("id")
      .single();

    if (error) {
      if (isMissingSchemaResourceError(error)) throw new Error(PENDING_SCHEMA_MSG);
      rethrowDbError("Saving email draft failed", error);
    }

    return { ok: true, id: saved.id };
  });

export const sendRecruitmentEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      templateSlug?: string | null | undefined;
      candidateId?: string | null | undefined;
      interviewId?: string | null | undefined;
      recipientEmail: string;
      recipientName?: string | null | undefined;
      subjectTemplate: string;
      bodyHtmlTemplate: string;
      bodyTextTemplate?: string | null | undefined;
      variables: Partial<Record<EmailVariableKey, string>>;
      isTest?: boolean | undefined;
      dedupeToken?: string | undefined;
    }) => {
      const recipientEmail = String(input?.recipientEmail ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
        throw new Error("A valid recipient email address is required.");
      }
      return { ...input, recipientEmail };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "emails:send:all");

    // 1. Verify real email-provider configuration BEFORE enabling sending
    const providerStatus = inspectEmailProviderConfig();
    if (!providerStatus.configured) {
      throw new Error(
        `Email sending is disabled until a verified sender is configured: ${providerStatus.issues.join(" ")}`,
      );
    }

    // 2. Render & validate variables
    const rendered = renderEmailTemplate({
      subjectTemplate: data.subjectTemplate,
      bodyHtmlTemplate: data.bodyHtmlTemplate,
      bodyTextTemplate: data.bodyTextTemplate,
      variables: data.variables,
    });

    if (rendered.unknownVariables.length > 0) {
      throw new Error(
        `Unknown template variables: ${rendered.unknownVariables.map((v) => `{{${v}}}`).join(", ")}`,
      );
    }
    if (rendered.missingVariables.length > 0) {
      throw new Error(
        `Fill in required template values before sending: ${rendered.missingVariables.map((v) => `{{${v}}}`).join(", ")}`,
      );
    }

    // 3. Idempotency check
    const bucket = new Date().toISOString().slice(0, 13); // hourly dedupe window unless custom token given
    const idempotencyKey = buildEmailIdempotencyKey({
      templateSlug: data.templateSlug,
      recipientEmail: data.recipientEmail,
      candidateId: data.candidateId,
      interviewId: data.interviewId,
      subject: rendered.subject,
      dedupeToken: data.dedupeToken ?? (data.isTest ? `test-${Date.now()}` : bucket),
    });

    const { data: existingMsg, error: checkErr } = await supabase
      .from("email_messages")
      .select("id, status, provider_message_id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (checkErr) {
      if (isMissingSchemaResourceError(checkErr)) throw new Error(PENDING_SCHEMA_MSG);
      rethrowDbError("Checking email idempotency failed", checkErr);
    }

    if (
      existingMsg &&
      (existingMsg.status === "sent" || existingMsg.status === "delivered")
    ) {
      return {
        ok: true,
        deduplicated: true,
        messageId: existingMsg.id,
        status: existingMsg.status as "sent" | "delivered",
        providerMessageId: existingMsg.provider_message_id,
      };
    }

    const transport = createResendEmailTransport();
    const sendResult = await transport.send({
      to: data.recipientEmail,
      subject: data.isTest ? `[TEST] ${rendered.subject}` : rendered.subject,
      html: rendered.bodyHtml,
      text: rendered.bodyText,
      idempotencyKey,
    });

    const nowIso = new Date().toISOString();
    const recordPayload = {
      idempotency_key: idempotencyKey,
      template_slug: data.templateSlug ?? null,
      candidate_id: data.isTest ? null : (data.candidateId ?? null),
      interview_id: data.isTest ? null : (data.interviewId ?? null),
      recipient_email: data.recipientEmail,
      recipient_name: data.recipientName?.trim() || null,
      subject: data.isTest ? `[TEST] ${rendered.subject}` : rendered.subject,
      body_html: rendered.bodyHtml,
      body_text: rendered.bodyText,
      variables_payload: data.variables as never,
      is_test: Boolean(data.isTest),
      // Honest delivery status: provider 200 OK sets "sent", NEVER "delivered"
      status: sendResult.status,
      provider: sendResult.provider,
      provider_message_id: sendResult.ok ? sendResult.providerMessageId : null,
      attempts: 1,
      error_message: sendResult.ok ? null : sendResult.errorMessage,
      sent_by: userId,
      sent_at: sendResult.ok ? nowIso : null,
    };

    const { data: stored, error: storeErr } = await supabase
      .from("email_messages")
      .upsert(recordPayload, { onConflict: "idempotency_key" })
      .select("id")
      .single();

    if (storeErr) rethrowDbError("Recording email delivery status failed", storeErr);

    if (sendResult.ok && data.candidateId && !data.isTest) {
      await supabase.from("candidate_activities").insert({
        candidate_id: data.candidateId,
        actor_id: userId,
        activity_type: "email_sent",
        body: `Sent email "${rendered.subject}" to ${data.recipientEmail}`,
        metadata: {
          emailMessageId: stored.id,
          templateSlug: data.templateSlug ?? null,
          providerMessageId: sendResult.providerMessageId,
        },
      });
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: sendResult.ok ? "recruitment_email.sent" : "recruitment_email.failed",
      entityType: "email_message",
      entityId: stored.id,
      detail: {
        recipientEmail: data.recipientEmail,
        templateSlug: data.templateSlug ?? null,
        isTest: Boolean(data.isTest),
        status: sendResult.status,
        error: sendResult.ok ? null : sendResult.errorMessage,
      },
    });

    if (!sendResult.ok) {
      throw new Error(`Email delivery failed: ${sendResult.errorMessage}`);
    }

    return {
      ok: true,
      deduplicated: false,
      messageId: stored.id,
      status: sendResult.status,
      providerMessageId: sendResult.providerMessageId,
    };
  });

export const sendBulkRecruitmentEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      candidateIds: string[];
      templateSlug: string;
      sharedVariables?: Partial<Record<EmailVariableKey, string>> | undefined;
    }) => {
      if (!Array.isArray(input?.candidateIds) || input.candidateIds.length === 0) {
        throw new Error("Select at least one candidate for bulk email.");
      }
      if (input.candidateIds.length > 100) {
        throw new Error("Bulk emails are capped at 100 candidates per batch.");
      }
      if (!input.templateSlug) throw new Error("Choose an email template.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const actor = await loadActor(supabase, userId);
    await requirePermission(supabase, userId, "emails:send:all");

    const providerStatus = inspectEmailProviderConfig();
    if (!providerStatus.configured) {
      throw new Error(
        `Bulk sending is disabled until a verified sender is configured: ${providerStatus.issues.join(" ")}`,
      );
    }

    const [{ data: dbTemplate }, { data: candidates, error: candErr }, { data: depts }, { data: ivs }] =
      await Promise.all([
        supabase
          .from("email_templates")
          .select("*")
          .eq("slug", data.templateSlug)
          .maybeSingle(),
        supabase.from("candidates").select("*").in("id", data.candidateIds),
        supabase.from("departments").select("id, name"),
        supabase
          .from("interviews")
          .select("candidate_id, scheduled_start_at, scheduled_end_at, meeting_link, mode")
          .in("candidate_id", data.candidateIds)
          .in("status", ["scheduled", "rescheduled"])
          .order("scheduled_start_at", { ascending: true }),
      ]);

    if (candErr) {
      if (isMissingSchemaResourceError(candErr)) throw new Error(PENDING_SCHEMA_MSG);
      rethrowDbError("Loading candidates for bulk email failed", candErr);
    }

    const fallbackDef = DEFAULT_EMAIL_TEMPLATES.find((t) => t.slug === data.templateSlug);
    const subjectTemplate = dbTemplate?.subject_template ?? fallbackDef?.subjectTemplate;
    const bodyHtmlTemplate = dbTemplate?.body_html_template ?? fallbackDef?.bodyHtmlTemplate;
    const bodyTextTemplate = dbTemplate?.body_text_template ?? fallbackDef?.bodyTextTemplate;

    if (!subjectTemplate || !bodyHtmlTemplate) {
      throw new Error(`Email template "${data.templateSlug}" was not found.`);
    }

    const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]));
    const nextIvByCandidate = new Map<
      string,
      { scheduled_start_at: string; scheduled_end_at: string; meeting_link: string | null; mode: string }
    >();
    for (const iv of ivs ?? []) {
      if (!nextIvByCandidate.has(iv.candidate_id)) {
        nextIvByCandidate.set(iv.candidate_id, iv);
      }
    }

    const transport = createResendEmailTransport();
    const portalUrl =
      process.env["SITE_URL"] ||
      process.env["VITE_SITE_URL"] ||
      "https://hrm.theaischool.co";
    const defaultHrContact = `${actor.fullName} (${actor.workEmail})`;
    const hourlyBucket = new Date().toISOString().slice(0, 13);

    let sentCount = 0;
    let skippedDuplicateCount = 0;
    let failedCount = 0;
    const results: {
      candidateId: string;
      email: string;
      status: "sent" | "skipped_duplicate" | "failed";
      reason?: string;
    }[] = [];

    for (const cand of candidates ?? []) {
      const iv = nextIvByCandidate.get(cand.id);
      const slot = iv
        ? formatInterviewIstSlot(iv.scheduled_start_at, iv.scheduled_end_at)
        : null;

      const vars: Partial<Record<EmailVariableKey, string>> = {
        candidate_name: cand.full_name,
        designation: cand.designation || "Role at The AI School",
        department:
          (cand.department_id ? deptMap.get(cand.department_id) : null) || "General",
        interview_date: slot?.dateLabel ?? data.sharedVariables?.interview_date ?? "",
        interview_time: slot?.timeRangeLabel ?? data.sharedVariables?.interview_time ?? "",
        meeting_link:
          iv?.meeting_link ?? data.sharedVariables?.meeting_link ?? "Details to follow",
        hr_contact: data.sharedVariables?.hr_contact || defaultHrContact,
        joining_date:
          cand.available_joining_date ?? data.sharedVariables?.joining_date ?? "TBD",
        employee_id: data.sharedVariables?.employee_id ?? "Pending Allocation",
        interview_mode: iv?.mode ? iv.mode.toUpperCase() : "Online",
        portal_url: portalUrl,
        ...data.sharedVariables,
      };

      const rendered = renderEmailTemplate({
        subjectTemplate,
        bodyHtmlTemplate,
        bodyTextTemplate,
        variables: vars,
      });

      if (!rendered.ok) {
        failedCount += 1;
        results.push({
          candidateId: cand.id,
          email: cand.email,
          status: "failed",
          reason: `Missing variables: ${rendered.missingVariables.join(", ")}`,
        });
        continue;
      }

      const idempotencyKey = buildEmailIdempotencyKey({
        templateSlug: data.templateSlug,
        recipientEmail: cand.email,
        candidateId: cand.id,
        subject: rendered.subject,
        dedupeToken: hourlyBucket,
      });

      const { data: dup } = await supabase
        .from("email_messages")
        .select("id, status")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (dup && (dup.status === "sent" || dup.status === "delivered")) {
        skippedDuplicateCount += 1;
        results.push({
          candidateId: cand.id,
          email: cand.email,
          status: "skipped_duplicate",
        });
        continue;
      }

      const dispatchRes = await transport.send({
        to: cand.email,
        subject: rendered.subject,
        html: rendered.bodyHtml,
        text: rendered.bodyText,
        idempotencyKey,
      });

      await supabase.from("email_messages").upsert(
        {
          idempotency_key: idempotencyKey,
          template_slug: data.templateSlug,
          candidate_id: cand.id,
          recipient_email: cand.email,
          recipient_name: cand.full_name,
          subject: rendered.subject,
          body_html: rendered.bodyHtml,
          body_text: rendered.bodyText,
          variables_payload: vars as never,
          status: dispatchRes.status,
          provider: dispatchRes.provider,
          provider_message_id: dispatchRes.ok ? dispatchRes.providerMessageId : null,
          attempts: 1,
          error_message: dispatchRes.ok ? null : dispatchRes.errorMessage,
          sent_by: userId,
          sent_at: dispatchRes.ok ? new Date().toISOString() : null,
        },
        { onConflict: "idempotency_key" },
      );

      if (dispatchRes.ok) {
        sentCount += 1;
        await supabase.from("candidate_activities").insert({
          candidate_id: cand.id,
          actor_id: userId,
          activity_type: "email_sent",
          body: `Sent bulk template "${data.templateSlug}" (${rendered.subject})`,
        });
        results.push({ candidateId: cand.id, email: cand.email, status: "sent" });
      } else {
        failedCount += 1;
        results.push({
          candidateId: cand.id,
          email: cand.email,
          status: "failed",
          reason: dispatchRes.errorMessage,
        });
      }
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "recruitment_email.bulk_sent",
      entityType: "email_batch",
      detail: {
        templateSlug: data.templateSlug,
        requested: data.candidateIds.length,
        sentCount,
        skippedDuplicateCount,
        failedCount,
      },
    });

    return {
      total: (candidates ?? []).length,
      sentCount,
      skippedDuplicateCount,
      failedCount,
      results,
    };
  });

export const retryFailedEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { messageId: string }) => {
    if (!input?.messageId) throw new Error("Email message ID is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "emails:send:all");

    const providerStatus = inspectEmailProviderConfig();
    if (!providerStatus.configured) {
      throw new Error(
        `Cannot retry until email provider is configured: ${providerStatus.issues.join(" ")}`,
      );
    }

    const { data: msg, error } = await supabase
      .from("email_messages")
      .select("*")
      .eq("id", data.messageId)
      .maybeSingle();

    if (error) rethrowDbError("Loading failed email message failed", error);
    if (!msg) throw new Error("Email message not found.");
    if (msg.status !== "failed" && msg.status !== "draft") {
      throw new Error(`Only failed or draft emails can be retried (current: ${msg.status}).`);
    }

    const nextAttempt = (msg.attempts ?? 0) + 1;
    const retryKey = `${msg.idempotency_key}:attempt:${nextAttempt}`;

    const transport = createResendEmailTransport();
    const res = await transport.send({
      to: msg.recipient_email,
      subject: msg.subject,
      html: msg.body_html,
      text: msg.body_text ?? undefined,
      idempotencyKey: retryKey,
    });

    await supabase
      .from("email_messages")
      .update({
        status: res.status,
        attempts: nextAttempt,
        provider_message_id: res.ok ? res.providerMessageId : null,
        error_message: res.ok ? null : res.errorMessage,
        sent_at: res.ok ? new Date().toISOString() : null,
      })
      .eq("id", msg.id);

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: res.ok ? "recruitment_email.retry_succeeded" : "recruitment_email.retry_failed",
      entityType: "email_message",
      entityId: msg.id,
      detail: {
        attempt: nextAttempt,
        status: res.status,
        error: res.ok ? null : res.errorMessage,
      },
    });

    if (!res.ok) {
      throw new Error(`Retry failed: ${res.errorMessage}`);
    }

    return { ok: true, status: res.status, providerMessageId: res.providerMessageId };
  });

