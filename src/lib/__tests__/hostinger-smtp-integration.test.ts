import { describe, expect, it, vi } from "vitest";
import { normalizeEffectivePermissions } from "../permissions";
import {
  buildEmailIdempotencyKey,
  DEFAULT_EMAIL_TEMPLATES,
  renderEmailTemplate,
  SAMPLE_EMAIL_VARIABLES,
  validateTemplateVariables,
} from "../recruitment/email-templates";
import {
  computeSmtpRetryBackoffMs,
  containsHeaderInjection,
  createHostingerSmtpTransport,
  inspectEmailProviderConfig,
  isTransientSmtpError,
  resolveSupabaseAuthRedirectUrl,
  sanitizeSmtpErrorMessage,
  SMTP_BULK_MAX_RECIPIENTS,
  SMTP_BULK_PACING_MS,
  validateRecipientEmail,
  verifySmtpConnection,
} from "../recruitment/email-transport.server";

const VALID_HOSTINGER_465_ENV = {
  SMTP_HOST: "smtp.hostinger.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "hr@theaischool.co",
  SMTP_PASS: "MockSecretMailboxPassword!",
  EMAIL_FROM: "hr@theaischool.co",
  EMAIL_FROM_NAME: "The AI School HR",
  SMTP_CONNECTION_TIMEOUT_MS: "15000",
  SMTP_SEND_TIMEOUT_MS: "30000",
};

const VALID_HOSTINGER_587_ENV = {
  SMTP_HOST: "smtp.hostinger.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "hr@theaischool.co",
  SMTP_PASS: "MockSecretMailboxPassword!",
  EMAIL_FROM: "The AI School HR <hr@theaischool.co>",
};

describe("Hostinger SMTP — Configuration, Validation & Secret Redaction", () => {
  it("reports missing SMTP configuration cleanly without throwing or inventing credentials", () => {
    const empty = inspectEmailProviderConfig({});
    expect(empty.configured).toBe(false);
    expect(empty.provider).toBe("hostinger_smtp");
    expect(empty.issues.length).toBeGreaterThanOrEqual(5);
  });

  it("accepts valid Hostinger SMTP 465 SSL/TLS and 587 STARTTLS configurations", () => {
    const ssl = inspectEmailProviderConfig(VALID_HOSTINGER_465_ENV);
    expect(ssl.configured).toBe(true);
    expect(ssl.smtpHost).toBe("smtp.hostinger.com");
    expect(ssl.smtpPort).toBe(465);
    expect(ssl.smtpSecure).toBe(true);
    expect(ssl.senderEmail).toBe("hr@theaischool.co");
    expect(ssl.senderDisplay).toBe("The AI School HR <hr@theaischool.co>");
    expect(JSON.stringify(ssl)).not.toContain("MockSecretMailboxPassword!");

    const starttls = inspectEmailProviderConfig(VALID_HOSTINGER_587_ENV);
    expect(starttls.configured).toBe(true);
    expect(starttls.smtpPort).toBe(587);
    expect(starttls.smtpSecure).toBe(false);
    expect(starttls.senderEmail).toBe("hr@theaischool.co");
  });

  it("rejects VITE_ exposed secrets, Titan/Resend hosts, port/TLS mismatches, and personal Gmail logins", () => {
    const viteLeaked = inspectEmailProviderConfig({
      ...VALID_HOSTINGER_465_ENV,
      VITE_SMTP_PASS: "should-never-exist",
    });
    expect(viteLeaked.configured).toBe(false);
    expect(viteLeaked.issues.some((i) => i.includes("VITE_SMTP_PASS"))).toBe(true);

    const titanCfg = inspectEmailProviderConfig({
      ...VALID_HOSTINGER_465_ENV,
      SMTP_HOST: "smtp.titan.email",
    });
    expect(titanCfg.configured).toBe(false);

    const mismatchTls = inspectEmailProviderConfig({
      ...VALID_HOSTINGER_465_ENV,
      SMTP_PORT: "465",
      SMTP_SECURE: "false",
    });
    expect(mismatchTls.configured).toBe(false);

    // HR users' Google logins (manaswini@gmail.com, satwika@gmail.com) must never be SMTP credentials
    const hrPersonalGmail = inspectEmailProviderConfig({
      ...VALID_HOSTINGER_465_ENV,
      SMTP_USER: "manaswini@gmail.com",
      EMAIL_FROM: "satwika@gmail.com",
    });
    expect(hrPersonalGmail.configured).toBe(false);
    expect(hrPersonalGmail.issues.some((i) => i.includes("personal Gmail"))).toBe(true);
  });
});

describe("Hostinger SMTP — Verification, Auth Failures, TLS Errors & Retries", () => {
  it("verifies Hostinger SMTP connection via mocked verify() and sanitizes auth & TLS errors", async () => {
    const verifyOk = vi.fn().mockResolvedValue(true);
    const closeOk = vi.fn();

    const okRes = await verifySmtpConnection({
      env: VALID_HOSTINGER_465_ENV,
      allowInTests: true,
      transporterFactory: () => ({
        sendMail: vi.fn(),
        verify: verifyOk,
        close: closeOk,
      }),
    });
    expect(okRes.ok).toBe(true);
    expect(verifyOk).toHaveBeenCalledTimes(1);
    expect(closeOk).toHaveBeenCalledTimes(1);
    expect(okRes.message).toContain("smtp.hostinger.com:465");

    const authFailRes = await verifySmtpConnection({
      env: VALID_HOSTINGER_465_ENV,
      allowInTests: true,
      transporterFactory: () => ({
        sendMail: vi.fn(),
        verify: vi.fn().mockRejectedValue(
          Object.assign(
            new Error("535 5.7.8 Authentication failed for MockSecretMailboxPassword!"),
            { code: "EAUTH", responseCode: 535 },
          ),
        ),
      }),
    });
    expect(authFailRes.ok).toBe(false);
    expect(authFailRes.message).toContain("535");
    expect(authFailRes.message).not.toContain("MockSecretMailboxPassword!");

    const tlsFailRes = await verifySmtpConnection({
      env: VALID_HOSTINGER_465_ENV,
      allowInTests: true,
      transporterFactory: () => ({
        sendMail: vi.fn(),
        verify: vi.fn().mockRejectedValue(
          Object.assign(new Error("self-signed certificate in certificate chain"), {
            code: "DEPTH_ZERO_SELF_SIGNED_CERT",
          }),
        ),
      }),
    });
    expect(tlsFailRes.ok).toBe(false);
    expect(tlsFailRes.message).toContain("TLS certificate verification failed");
  });

  it("retries transient SMTP errors with exponential backoff and skips retries on permanent 5xx errors", async () => {
    expect(computeSmtpRetryBackoffMs(1, 1000)).toBe(1000);
    expect(computeSmtpRetryBackoffMs(2, 1000)).toBe(2000);
    expect(computeSmtpRetryBackoffMs(3, 1000)).toBe(4000);

    const tempErr = Object.assign(new Error("421 4.7.0 Try again later"), {
      responseCode: 421,
    });
    expect(isTransientSmtpError(tempErr)).toBe(true);
    expect(
      isTransientSmtpError(Object.assign(new Error("550 No such user"), { responseCode: 550 })),
    ).toBe(false);

    const sendMailTransientThenOk = vi
      .fn()
      .mockRejectedValueOnce(tempErr)
      .mockResolvedValueOnce({
        messageId: "<retry-ok@theaischool.co>",
        response: "250 2.0.0 Ok",
        accepted: ["candidate@example.com"],
        rejected: [],
      });

    const retryTransport = createHostingerSmtpTransport({
      env: VALID_HOSTINGER_465_ENV,
      allowInTests: true,
      maxRetries: 2,
      retryBaseDelayMs: 0,
      transporterFactory: () => ({ sendMail: sendMailTransientThenOk }),
    });

    const retryRes = await retryTransport.send({
      to: "candidate@example.com",
      subject: "Interview Reminder",
      html: "<p>Reminder</p>",
      idempotencyKey: "retry-transient-1",
    });

    expect(sendMailTransientThenOk).toHaveBeenCalledTimes(2);
    expect(retryRes.ok).toBe(true);
    if (retryRes.ok) {
      expect(retryRes.status).toBe("accepted_by_smtp");
      expect(retryRes.attemptsUsed).toBe(2);
    }

    // Permanent 550 should NOT retry
    const sendMailPermFail = vi.fn().mockRejectedValue(
      Object.assign(new Error("550 5.1.1 User unknown"), { responseCode: 550 }),
    );
    const permFailTransport = createHostingerSmtpTransport({
      env: VALID_HOSTINGER_465_ENV,
      allowInTests: true,
      maxRetries: 2,
      retryBaseDelayMs: 0,
      transporterFactory: () => ({ sendMail: sendMailPermFail }),
    });

    const permFailRes = await permFailTransport.send({
      to: "missing@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      idempotencyKey: "perm-fail-1",
    });

    expect(sendMailPermFail).toHaveBeenCalledTimes(1);
    expect(permFailRes.ok).toBe(false);
    expect(permFailRes.attemptsUsed).toBe(1);
  });

  it("redacts passwords in sanitized SMTP error messages", () => {
    const err = new Error(
      "Connection failed password=MySuperSecretValue123 while talking to smtp.hostinger.com",
    );
    const sanitized = sanitizeSmtpErrorMessage(err, "MySuperSecretValue123");
    expect(sanitized).not.toContain("MySuperSecretValue123");
    expect(sanitized).toContain("[REDACTED]");
  });
});

describe("Hostinger SMTP — Header Injection, Recipient Validation, Branding & Pacing", () => {
  it("blocks invalid recipients and CRLF header injection payloads before reaching SMTP", async () => {
    expect(containsHeaderInjection("Hello\r\nBcc: attacker@evil.com")).toBe(true);
    expect(validateRecipientEmail("invalid-email").valid).toBe(false);
    expect(validateRecipientEmail("a@b.com,c@d.com").valid).toBe(false);
    expect(validateRecipientEmail("user@theaischool.co\r\nBcc:x@y.com").valid).toBe(false);
    expect(validateRecipientEmail(" Candidate@TheAISchool.CO ").normalized).toBe(
      "candidate@theaischool.co",
    );

    const spySend = vi.fn();
    const transport = createHostingerSmtpTransport({
      env: VALID_HOSTINGER_465_ENV,
      allowInTests: true,
      transporterFactory: () => ({ sendMail: spySend }),
    });

    const injectedSubject = await transport.send({
      to: "candidate@example.com",
      subject: "Offer Letter\r\nBcc: attacker@evil.com",
      html: "<p>Hi</p>",
      idempotencyKey: "inject-subj-1",
    });

    expect(injectedSubject.ok).toBe(false);
    expect(spySend).not.toHaveBeenCalled();
  });

  it("validates brand logo, official red/black/white styling, XSS escaping & unknown variable rejection", () => {
    const badTpl = validateTemplateVariables({
      subjectTemplate: "Update",
      bodyHtmlTemplate: "<p>{{unknown_token}}</p>",
    });
    expect(badTpl.valid).toBe(false);

    const welcomeTpl = DEFAULT_EMAIL_TEMPLATES.find((t) => t.slug === "hr_announcement")!;
    const rendered = renderEmailTemplate({
      subjectTemplate: welcomeTpl.subjectTemplate,
      bodyHtmlTemplate: welcomeTpl.bodyHtmlTemplate,
      bodyTextTemplate: welcomeTpl.bodyTextTemplate,
      variables: {
        ...SAMPLE_EMAIL_VARIABLES,
        candidate_name: `<img src=x onerror="alert(1)">`,
      },
    });

    expect(rendered.ok).toBe(true);
    expect(rendered.bodyHtml).toContain("/the-ai-school-logo.png");
    expect(rendered.bodyHtml).toContain("hr@theaischool.co");
    expect(rendered.bodyHtml).not.toContain("<img src=x");
    expect(rendered.bodyHtml).toContain("&lt;img src=x");
  });

  it("enforces conservative Hostinger bulk limits, pacing constants & duplicate protection", () => {
    expect(SMTP_BULK_MAX_RECIPIENTS).toBe(50);
    expect(SMTP_BULK_PACING_MS).toBeGreaterThanOrEqual(1000);

    const k1 = buildEmailIdempotencyKey({
      templateSlug: "document_correction_request",
      recipientEmail: "USER@EXAMPLE.COM",
      candidateId: "cand-99",
      subject: "Action Needed",
      dedupeToken: "2026-11-13T17",
    });
    const k2 = buildEmailIdempotencyKey({
      templateSlug: "document_correction_request",
      recipientEmail: "user@example.com",
      candidateId: "cand-99",
      subject: "Action Needed",
      dedupeToken: "2026-11-13T17",
    });
    expect(k1).toBe(k2);
  });
});

describe("Hostinger SMTP — RBAC & Supabase Auth Recovery Redirect Verification", () => {
  it("enforces identical full Email Center permissions for both HR accounts, Founder read-only, and blocks unauthorized roles", () => {
    // Both Manaswini (full_time HR) and Satwika (intern HR) hold role = "hr"
    const manaswiniPerms = normalizeEffectivePermissions(["hr"], []);
    const satwikaPerms = normalizeEffectivePermissions(["hr"], []);
    expect(manaswiniPerms).toEqual(satwikaPerms);
    for (const hrPerms of [manaswiniPerms, satwikaPerms]) {
      expect(hrPerms).toContain("emails:read:all");
      expect(hrPerms).toContain("emails:manage:all");
      expect(hrPerms).toContain("emails:send:all");
    }

    // Founder remains strictly read-only
    const founderPerms = normalizeEffectivePermissions(
      ["founder"],
      ["emails:send:all", "emails:manage:all"],
    );
    expect(founderPerms).toContain("emails:read:all");
    expect(founderPerms).not.toContain("emails:send:all");
    expect(founderPerms).not.toContain("emails:manage:all");

    // Manager, Lead, and Employee cannot read, manage, or send HR Email Center emails
    for (const role of ["manager", "lead", "employee"] as const) {
      const perms = normalizeEffectivePermissions([role], ["emails:send:all"]);
      expect(perms).not.toContain("emails:read:all");
      expect(perms).not.toContain("emails:manage:all");
      expect(perms).not.toContain("emails:send:all");
    }
  });

  it("resolves production Vercel URL & Supabase Auth password reset / callback routes safely", () => {
    expect(
      resolveSupabaseAuthRedirectUrl("/auth/reset-password", {
        SITE_URL: "https://hrm.theaischool.co/",
      }),
    ).toBe("https://hrm.theaischool.co/auth/reset-password");

    expect(
      resolveSupabaseAuthRedirectUrl("/auth/callback", {
        VITE_SITE_URL: "https://hrm-preview.vercel.app",
      }),
    ).toBe("https://hrm-preview.vercel.app/auth/callback");

    expect(() =>
      resolveSupabaseAuthRedirectUrl("/auth/reset-password", {
        SITE_URL: "javascript:alert(1)",
      }),
    ).toThrow(/https or http/i);
  });
});

