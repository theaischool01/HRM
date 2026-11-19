import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AppUrlConfigError,
  assertNoNonPublicLinks,
  isNonPublicHost,
  resolveEmailPortalUrlFromEnv,
  validateEmailPortalUrl,
} from "../app-url";
import {
  ACCOUNT_SETUP_EMAIL_SUBJECT,
  buildAccountSetupUrl,
  redactSetupLink,
  renderAccountSetupEmail,
} from "../emails/account-setup-email";
import {
  KYC_CORRECTION_SUBJECT,
  KYC_NOTIFICATIONS,
  KYC_REQUIRED_DOCUMENT_TYPES,
  KYC_VERIFIED_SUBJECT,
  correctionItemsFromState,
  deriveKycState,
  kycEmailEligibility,
  kycRetryDelayMinutes,
  renderKycCorrectionEmail,
  renderKycVerifiedEmail,
  sanitizeCorrectionReason,
  summariseKycProgress,
  type KycDocumentInput,
} from "../kyc/kyc-notifications";
import { resolveSupabaseAuthRedirectUrl, createHostingerSmtpTransport } from "../recruitment/email-transport.server";

const PROD = "https://hrm-theta-gilt.vercel.app";

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20261119200000_kyc_review_history_and_notification_outbox.sql"),
  "utf8",
);

function docs(map: Record<string, "pending" | "verified" | "rejected">, extra?: Partial<KycDocumentInput>): KycDocumentInput[] {
  return Object.entries(map).map(([doc_type, status], i) => ({
    doc_type,
    status,
    created_at: `2026-11-19T10:0${i}:00Z`,
    review_note: status === "rejected" ? "Blurry scan, please re-upload" : null,
    ...extra,
  }));
}

const ALL_VERIFIED = Object.fromEntries(KYC_REQUIRED_DOCUMENT_TYPES.map((t) => [t, "verified" as const]));

describe("Part A — canonical production URL for all email links", () => {
  it("rejects localhost, loopback and private hosts in any environment", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "0.0.0.0", "10.1.2.3", "192.168.1.10", "172.20.0.5", "[::1]", "hrm.local", "intranet"]) {
      expect(isNonPublicHost(host.replace(/^\[|\]$/g, (m) => m))).toBe(true);
    }
    expect(isNonPublicHost("hrm-theta-gilt.vercel.app")).toBe(false);
    expect(validateEmailPortalUrl("http://localhost:3000").ok).toBe(false);
    expect(validateEmailPortalUrl("http://127.0.0.1:8080").ok).toBe(false);
  });

  it("requires HTTPS and strips paths, queries and credentials", () => {
    expect(validateEmailPortalUrl("http://hrm-theta-gilt.vercel.app").ok).toBe(false);
    expect(validateEmailPortalUrl("https://user:pw@hrm-theta-gilt.vercel.app").ok).toBe(false);
    const v = validateEmailPortalUrl(`${PROD}/some/path?x=1`);
    expect(v).toEqual({ ok: true, origin: PROD });
  });

  it("prefers PUBLIC_APP_URL and ignores a localhost SITE_URL (the production bug)", () => {
    expect(
      resolveEmailPortalUrlFromEnv({ PUBLIC_APP_URL: PROD, SITE_URL: "http://localhost:3000" }),
    ).toBe(PROD);
  });

  it("never silently falls back to localhost or an unrelated domain", () => {
    expect(() => resolveEmailPortalUrlFromEnv({ SITE_URL: "http://localhost:3000", VITE_SITE_URL: "http://localhost:3000" })).toThrow(AppUrlConfigError);
    expect(() => resolveEmailPortalUrlFromEnv({})).toThrow(/PUBLIC_APP_URL/);
    expect(() => resolveEmailPortalUrlFromEnv({ PUBLIC_APP_URL: "http://localhost:3000" })).toThrow(/PUBLIC_APP_URL is invalid/);
  });

  it("uses Vercel's production host only in the production deployment", () => {
    expect(resolveEmailPortalUrlFromEnv({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "hrm-theta-gilt.vercel.app" })).toBe(PROD);
    expect(() => resolveEmailPortalUrlFromEnv({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "hrm-theta-gilt.vercel.app" })).toThrow();
  });

  it("builds Supabase auth redirects only from validated config (no Host header input)", () => {
    expect(resolveSupabaseAuthRedirectUrl("/auth/reset-password", { PUBLIC_APP_URL: PROD })).toBe(`${PROD}/auth/reset-password`);
    expect(() => resolveSupabaseAuthRedirectUrl("/auth/callback", { SITE_URL: "http://localhost:3000" })).toThrow();
  });

  it("transport-level guard refuses content with local links", () => {
    expect(() => assertNoNonPublicLinks(`<a href="http://localhost:3000/auth">x</a>`)).toThrow(/local\/private link/);
    expect(() => assertNoNonPublicLinks(`<a href="${PROD}/auth">x</a> see https://theaischool.co`)).not.toThrow();
  });

  it("Hostinger transport blocks a localhost link before any SMTP connection", async () => {
    const transport = createHostingerSmtpTransport({
      allowInTests: true,
      env: { SMTP_HOST: "smtp.hostinger.com", SMTP_PORT: "465", SMTP_USER: "hr@theaischool.co", SMTP_PASS: "x", EMAIL_FROM: "hr@theaischool.co" },
    });
    const res = await transport.send({
      to: "someone@theaischool.co",
      subject: "Test",
      html: `<a href="http://localhost:3000/auth">Sign in</a>`,
      idempotencyKey: "t1",
    });
    expect(res.ok).toBe(false);
    expect(res.attemptsUsed).toBe(0);
  });
});

describe("Part B — welcome / account setup email", () => {
  const setupUrl = buildAccountSetupUrl(PROD, "hashed-token-abc");
  const email = renderAccountSetupEmail({
    fullName: "Asha Example",
    employeeCode: "TAS-099",
    designation: "Data Annotation Intern",
    workEmail: "asha.example@theaischool.co",
    setupUrl,
    portalUrl: PROD,
    linkExpiryLabel: "1 hour",
    roleLabel: "Employee",
    categoryLabel: "Intern",
  });

  it("uses the approved subject, details, button and steps", () => {
    expect(email.subject).toBe(ACCOUNT_SETUP_EMAIL_SUBJECT);
    expect(email.subject).toBe("Welcome to The AI School — Your HRM Account Is Ready");
    for (const s of ["Asha Example", "TAS-099", "asha.example@theaischool.co", "Data Annotation Intern", "Set Up My Account", "Upload the required KYC documents", "1 hour", "hr@theaischool.co"]) {
      expect(email.html).toContain(s);
    }
    expect(email.text).toContain(`${PROD}/auth`);
  });

  it("setup button is user-specific and on the production domain", () => {
    expect(setupUrl.startsWith(`${PROD}/auth/reset-password?`)).toBe(true);
    expect(setupUrl).toContain("token_hash=hashed-token-abc");
    expect(setupUrl).toContain("setup=1");
  });

  it("contains no localhost, passwords or DOB and redacts the live link for history", () => {
    expect(email.html).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(email.text).not.toMatch(/localhost/);
    expect(email.html.toLowerCase()).not.toMatch(/temporary password|your password is|date of birth/);
    const stored = redactSetupLink(email.html, setupUrl);
    expect(stored).not.toContain("hashed-token-abc");
    expect(() => assertNoNonPublicLinks(email.html + email.text)).not.toThrow();
  });
});

describe("Part C — KYC state, eligibility and notification content", () => {
  it("SQL required-document list matches REQUIRED_DOCUMENT_TYPES", () => {
    const m = MIGRATION.match(/SELECT ARRAY\[([^\]]+)\]::public\.document_type\[\]/);
    const sqlTypes = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(sqlTypes).toEqual([...KYC_REQUIRED_DOCUMENT_TYPES]);
  });

  it("all pending → under review, no success eligibility", () => {
    const s = deriveKycState(docs(Object.fromEntries(KYC_REQUIRED_DOCUMENT_TYPES.map((t) => [t, "pending" as const]))));
    expect(s.status).toBe("under_review");
    expect(kycEmailEligibility("verified", s).allowed).toBe(false);
    expect(kycEmailEligibility("correction", s).allowed).toBe(false);
  });

  it("one verified, rest pending → still pending, never a success email", () => {
    const s = deriveKycState(docs({ resume: "verified", identity_proof: "pending", pan: "pending", bank_details: "pending", education: "pending" }));
    expect(s.status).toBe("under_review");
    expect(kycEmailEligibility("verified", s).allowed).toBe(false);
  });

  it("3 verified + 2 pending shows the HR summary line", () => {
    const s = deriveKycState(docs({ resume: "verified", identity_proof: "verified", pan: "verified", bank_details: "pending", education: "pending" }));
    expect(summariseKycProgress(s)).toBe("3 of 5 required documents verified. 2 pending.");
  });

  it("all required verified → verified and success allowed", () => {
    const s = deriveKycState(docs(ALL_VERIFIED));
    expect(s.status).toBe("verified");
    expect(kycEmailEligibility("verified", s).allowed).toBe(true);
  });

  it("partial rejection → correction email lists only rejected docs (partial wording)", () => {
    const s = deriveKycState(docs({ resume: "verified", identity_proof: "verified", pan: "rejected", bank_details: "verified", education: "pending" }));
    expect(s.status).toBe("correction_required");
    expect(kycEmailEligibility("verified", s).allowed).toBe(false);
    const items = correctionItemsFromState(s);
    expect(items.map((i) => i.label)).toEqual(["PAN"]);
    const e = renderKycCorrectionEmail({ employeeName: "Asha", portalUrl: PROD, rejected: items, verifiedCount: s.verified });
    expect(e.subject).toBe(KYC_CORRECTION_SUBJECT);
    expect(e.html).toContain("Some documents have been verified successfully");
    expect(e.html).toContain("Document Type: PAN");
    expect(e.html).not.toContain("Resume");
    expect(e.html).toContain("Review My Documents");
    expect(e.html).toContain(`${PROD}/onboarding`);
    expect(e.html).not.toMatch(/complete\./i);
  });

  it("multiple rejections are consolidated into one message", () => {
    const s = deriveKycState(docs({ resume: "rejected", identity_proof: "verified", pan: "rejected", bank_details: "rejected", education: "verified" }));
    const e = renderKycCorrectionEmail({ employeeName: "A", portalUrl: PROD, rejected: correctionItemsFromState(s), verifiedCount: s.verified });
    expect((e.text.match(/Document Type:/g) ?? []).length).toBe(3);
  });

  it("all rejected → full correction list without 'verified successfully' wording", () => {
    const s = deriveKycState(docs(Object.fromEntries(KYC_REQUIRED_DOCUMENT_TYPES.map((t) => [t, "rejected" as const]))));
    const e = renderKycCorrectionEmail({ employeeName: "A", portalUrl: PROD, rejected: correctionItemsFromState(s), verifiedCount: s.verified });
    expect((e.text.match(/Document Type:/g) ?? []).length).toBe(5);
    expect(e.html).not.toContain("verified successfully");
    expect(e.html).not.toMatch(/verification is (now )?complete/i);
  });

  it("resubmitted document is shown as resubmitted / under review", () => {
    const s = deriveKycState([
      ...docs({ resume: "verified", identity_proof: "verified", bank_details: "verified", education: "verified" }),
      { doc_type: "pan", status: "pending", revision: 2, created_at: "2026-11-19T11:00:00Z" },
    ]);
    expect(s.documents.find((d) => d.docType === "pan")?.state).toBe("resubmitted");
    expect(s.status).toBe("under_review");
  });

  it("success email contains approved copy and no sensitive data", () => {
    const e = renderKycVerifiedEmail({ employeeName: "Asha Example", portalUrl: PROD });
    expect(e.subject).toBe(KYC_VERIFIED_SUBJECT);
    expect(e.html).toContain("Your KYC verification is now complete.");
    expect(e.html).toContain("Open HRM Portal");
    expect(e.html).not.toMatch(/localhost|signedUrl|token|employee-documents/i);
  });

  it("correction reasons are sanitised (PAN, Aadhaar, bank numbers, URLs)", () => {
    const r = sanitizeCorrectionReason("PAN ABCDE1234F mismatch; Aadhaar 1234 5678 9012; acct 001234567890 IFSC HDFC0001234 see https://x.y/z\u0007");
    expect(r).not.toMatch(/ABCDE1234F|1234 5678 9012|001234567890|HDFC0001234|https?:/);
    expect(r).toContain("[redacted]");
    expect(sanitizeCorrectionReason("")).toMatch(/clearer/);
    expect(sanitizeCorrectionReason("x".repeat(400)).length).toBeLessThanOrEqual(280);
  });

  it("in-app notification titles carry no sensitive details", () => {
    expect(KYC_NOTIFICATIONS.verified.title).toBe("Your KYC verification is complete.");
    expect(KYC_NOTIFICATIONS.correction.title).toBe("Some KYC documents need correction. Open My Profile to review.");
    expect(KYC_NOTIFICATIONS.under_review.title).toBe("Your KYC documents are under review.");
  });

  it("SMTP retries back off and are bounded", () => {
    expect([1, 2, 3, 4, 10].map(kycRetryDelayMinutes)).toEqual([1, 2, 4, 8, 60]);
  });
});

describe("Part C/E — migration guarantees (outbox, idempotency, RLS)", () => {
  it("completion event is deduplicated once per KYC cycle", () => {
    expect(MIGRATION).toMatch(/'kyc_verified:' \|\| _user_id::text \|\| ':' \|\| _cycle::text/);
    expect(MIGRATION).toMatch(/ON CONFLICT \(dedupe_key\) DO NOTHING/);
    expect(MIGRATION).toMatch(/IF _old\.status = 'verified' AND _status <> 'verified' THEN\s+_cycle := _cycle \+ 1;/);
  });

  it("emits success only on a real transition into verified", () => {
    expect(MIGRATION).toMatch(/IF _status = 'verified' AND _old\.status IS DISTINCT FROM 'verified' THEN/);
  });

  it("serialises concurrent reviews with a row lock", () => {
    expect(MIGRATION).toMatch(/FROM public\.employee_kyc_state WHERE user_id = _user_id FOR UPDATE/);
  });

  it("groups corrections and cancels stale ones when KYC completes", () => {
    expect(MIGRATION).toMatch(/now\(\) \+ interval '3 minutes'/);
    expect(MIGRATION).toMatch(/Superseded: KYC became fully verified before delivery/);
  });

  it("blocks self-review, enforces verifier role and mandatory reason in the database", () => {
    expect(MIGRATION).toMatch(/You cannot review your own KYC documents/);
    expect(MIGRATION).toMatch(/Only HR or Super Admin can verify KYC documents/);
    expect(MIGRATION).toMatch(/A correction reason is required when rejecting a document/);
  });

  it("history is append-only for clients and outbox is HR/Super Admin read-only", () => {
    expect(MIGRATION).toMatch(/REVOKE ALL ON public\.document_review_events FROM anon, authenticated;\s+GRANT SELECT ON public\.document_review_events TO authenticated;/);
    expect(MIGRATION).toMatch(/CREATE POLICY kyc_notification_outbox_select[\s\S]+has_role\(auth\.uid\(\), 'hr'\) OR public\.has_role\(auth\.uid\(\), 'super_admin'\)/);
    expect(MIGRATION).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*kyc_notification_outbox TO authenticated/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\.claim_kyc_notifications\(integer, uuid, uuid\[\]\) FROM PUBLIC, anon, authenticated/);
  });

  it("backfill writes state only (no retroactive emails)", () => {
    const backfill = MIGRATION.slice(MIGRATION.indexOf("-- 11. Backfill"));
    expect(backfill).toContain("INSERT INTO public.employee_kyc_state");
    expect(backfill).not.toContain("kyc_notification_outbox");
  });
});
