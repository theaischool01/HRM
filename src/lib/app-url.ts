// Canonical public application URL — the ONLY source for links placed in
// outbound email (account setup, password reset, KYC, recruitment, HR notices).
//
// Rules (covered by tests in `__tests__/app-url-and-kyc-notifications.test.ts`):
//   * Read from validated server configuration, never from request headers.
//   * Priority: PUBLIC_APP_URL → SITE_URL → VITE_SITE_URL → (Vercel production
//     only) VERCEL_PROJECT_PRODUCTION_URL.
//   * Email links must be HTTPS and must never point at localhost, loopback,
//     private-network or `.local` hosts — in ANY environment. A developer
//     running the app locally against the production database and SMTP
//     therefore can no longer email `http://localhost:3000` to an employee.
//   * No silent fallback: if nothing valid is configured, callers get a
//     descriptive error and the email is not sent.
//
// Pure module (no Node APIs) so it is unit-testable and safe to import anywhere.

export type AppUrlEnv = Record<string, string | undefined>;

export const APP_URL_ENV_KEYS = ["PUBLIC_APP_URL", "SITE_URL", "VITE_SITE_URL"] as const;

export type AppUrlValidation =
  | { ok: true; origin: string }
  | { ok: false; reason: string };

const LOOPBACK_HOST_RE = /^(localhost|.*\.localhost|0\.0\.0\.0|\[?::1?\]?|\[?::\]?)$/i;
const PRIVATE_SUFFIX_RE = /\.(local|internal|lan|home|test|invalid|example)$/i;

function isPrivateOrLoopbackIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** True for hosts that must never appear in an email sent to a real person. */
export function isNonPublicHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (LOOPBACK_HOST_RE.test(host)) return true;
  if (host.startsWith("[")) return true; // raw IPv6 literals are never a valid portal
  if (isPrivateOrLoopbackIpv4(host)) return true;
  if (PRIVATE_SUFFIX_RE.test(host)) return true;
  if (!host.includes(".")) return true; // single-label intranet names
  return false;
}

/**
 * Validates a candidate portal URL for use in outbound email.
 * Returns the bare origin (scheme + host + optional port), dropping any path,
 * query string or credentials.
 */
export function validateEmailPortalUrl(raw: string | null | undefined): AppUrlValidation {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "No application URL is configured." };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: `"${value.slice(0, 80)}" is not a valid URL.` };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "The application URL protocol must be https or http." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "The application URL must not contain credentials." };
  }
  if (isNonPublicHost(parsed.hostname)) {
    return {
      ok: false,
      reason: `"${parsed.origin}" is a local/loopback/private address and can never be used in employee emails.`,
    };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Employee email links must use HTTPS." };
  }
  return { ok: true, origin: parsed.origin };
}

export class AppUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppUrlConfigError";
  }
}

function isVercelProduction(env: AppUrlEnv): boolean {
  return String(env["VERCEL_ENV"] ?? "").trim().toLowerCase() === "production";
}

/**
 * Resolves the canonical HTTPS portal origin for emails, or throws
 * `AppUrlConfigError` with an actionable message. Never derives from headers.
 */
export function resolveEmailPortalUrlFromEnv(env: AppUrlEnv): string {
  const explicit = String(env["PUBLIC_APP_URL"] ?? "").trim();
  if (explicit) {
    const check = validateEmailPortalUrl(explicit);
    if (!check.ok) throw new AppUrlConfigError(`PUBLIC_APP_URL is invalid: ${check.reason}`);
    return check.origin;
  }

  const rejected: string[] = [];
  for (const key of ["SITE_URL", "VITE_SITE_URL"] as const) {
    const value = String(env[key] ?? "").trim();
    if (!value) continue;
    const check = validateEmailPortalUrl(value);
    if (check.ok) return check.origin;
    rejected.push(`${key}: ${check.reason}`);
  }

  if (isVercelProduction(env)) {
    const host = String(env["VERCEL_PROJECT_PRODUCTION_URL"] ?? "").trim();
    if (host) {
      const check = validateEmailPortalUrl(host.startsWith("http") ? host : `https://${host}`);
      if (check.ok) return check.origin;
      rejected.push(`VERCEL_PROJECT_PRODUCTION_URL: ${check.reason}`);
    }
  }

  throw new AppUrlConfigError(
    [
      "Cannot build employee email links: set PUBLIC_APP_URL to the deployed HTTPS portal",
      "(for example https://hrm-theta-gilt.vercel.app). Emails were NOT sent.",
      rejected.length ? `Rejected values — ${rejected.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Joins the validated origin with an absolute in-app path. */
export function buildPortalLink(origin: string, path: `/${string}`): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** Throws if any http(s) URL inside rendered email content points at a non-public host. */
export function assertNoNonPublicLinks(content: string): void {
  const urlRe = /https?:\/\/[^\s"'<>)]+/gi;
  for (const match of content.matchAll(urlRe)) {
    try {
      const host = new URL(match[0]).hostname;
      if (isNonPublicHost(host)) {
        throw new AppUrlConfigError(
          `Refusing to send: email content contains a local/private link (${new URL(match[0]).origin}).`,
        );
      }
    } catch (error) {
      if (error instanceof AppUrlConfigError) throw error;
      // Unparseable fragments are ignored; they are not navigable links.
    }
  }
}
