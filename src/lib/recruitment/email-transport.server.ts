// Server-only Email Delivery Transport (Resend REST API).
// NEVER import this module from client components — only inside server functions.

export type EmailDeliveryStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed";

export type EmailProviderStatusReport = {
  configured: boolean;
  provider: "resend";
  senderDisplay: string | null;
  issues: string[];
};

const EMAIL_EXTRACTOR_RE = /(?:^|<)\s*([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)\s*(?:>|$)/;

/**
 * Inspects environment variables safely WITHOUT ever returning or logging secret API keys.
 * Sending remains locked until both `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` exist.
 */
export function inspectEmailProviderConfig(
  env: Record<string, string | undefined> = process.env,
): EmailProviderStatusReport {
  const issues: string[] = [];
  const rawKey = String(env["RESEND_API_KEY"] ?? "").trim();
  const rawFrom = String(env["RESEND_FROM_EMAIL"] ?? "").trim();

  if (!rawKey) {
    issues.push("RESEND_API_KEY is not set in server environment variables.");
  } else if (/your-resend|<|placeholder|example|changeme/i.test(rawKey)) {
    issues.push("RESEND_API_KEY still contains a placeholder value.");
  } else if (!rawKey.startsWith("re_") || rawKey.length < 12) {
    issues.push("RESEND_API_KEY format is invalid (expected Resend key starting with 're_').");
  }

  let senderDisplay: string | null = null;
  if (!rawFrom) {
    issues.push("RESEND_FROM_EMAIL is not set in server environment variables.");
  } else if (/<your|placeholder|example\.com/i.test(rawFrom)) {
    issues.push("RESEND_FROM_EMAIL still contains a placeholder address.");
  } else {
    const match = rawFrom.match(EMAIL_EXTRACTOR_RE);
    if (!match?.[1]) {
      issues.push(
        'RESEND_FROM_EMAIL must be a valid sender (e.g. "The AI School HR <hr@theaischool.in>").',
      );
    } else if (/@resend\.dev$/i.test(match[1])) {
      issues.push(
        "RESEND_FROM_EMAIL uses Resend's sandbox domain (@resend.dev). Configure a verified organization domain before sending candidate emails.",
      );
    } else {
      senderDisplay = rawFrom;
    }
  }

  return {
    configured: issues.length === 0,
    provider: "resend",
    senderDisplay,
    issues,
  };
}

export type SendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string | undefined;
  replyTo?: string | undefined;
  idempotencyKey: string;
};

export type SendEmailTransportResult =
  | {
      ok: true;
      /**
       * Honest status rule: synchronous provider acceptance ALWAYS maps to `"sent"`.
       * `"delivered"` is ONLY set when confirmed asynchronously by a provider delivery event.
       */
      status: "sent";
      provider: "resend";
      providerMessageId: string;
    }
  | {
      ok: false;
      status: "failed";
      provider: "resend";
      errorMessage: string;
    };

export interface EmailTransport {
  send(payload: SendEmailPayload): Promise<SendEmailTransportResult>;
}

export function createResendEmailTransport(options?: {
  env?: Record<string, string | undefined> | undefined;
  fetchImpl?: typeof fetch | undefined;
  allowInTests?: boolean | undefined;
}): EmailTransport {
  const env = options?.env ?? process.env;

  return {
    async send(payload: SendEmailPayload): Promise<SendEmailTransportResult> {
      const isTestEnv =
        env["VITEST"] === "true" ||
        env["NODE_ENV"] === "test" ||
        process.env["VITEST"] === "true";

      if (isTestEnv && !options?.allowInTests) {
        return {
          ok: false,
          status: "failed",
          provider: "resend",
          errorMessage:
            "Blocked in automated test environment: live recruitment emails are never dispatched during tests.",
        };
      }

      const config = inspectEmailProviderConfig(env);
      if (!config.configured || !config.senderDisplay) {
        return {
          ok: false,
          status: "failed",
          provider: "resend",
          errorMessage: `Email provider is not configured: ${config.issues.join(" ")}`,
        };
      }

      const apiKey = String(env["RESEND_API_KEY"] ?? "").trim();
      const fetchFn = options?.fetchImpl ?? fetch;

      try {
        const response = await fetchFn("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": payload.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.senderDisplay,
            to: [payload.to],
            subject: payload.subject,
            html: payload.html,
            ...(payload.text ? { text: payload.text } : {}),
            ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
          }),
        });

        let bodyJson: { id?: string; message?: string; name?: string } | null = null;
        try {
          bodyJson = (await response.json()) as {
            id?: string;
            message?: string;
            name?: string;
          };
        } catch {
          bodyJson = null;
        }

        if (!response.ok || !bodyJson?.id) {
          const detail =
            bodyJson?.message ||
            bodyJson?.name ||
            `Resend HTTP ${response.status} ${response.statusText}`;
          return {
            ok: false,
            status: "failed",
            provider: "resend",
            errorMessage: detail,
          };
        }

        // CRITICAL: Never mark "delivered" here — Resend API 200 only confirms handoff ("sent").
        return {
          ok: true,
          status: "sent",
          provider: "resend",
          providerMessageId: bodyJson.id,
        };
      } catch (error) {
        return {
          ok: false,
          status: "failed",
          provider: "resend",
          errorMessage:
            error instanceof Error ? error.message : "Network error contacting Resend API.",
        };
      }
    },
  };
}

/**
 * Maps verified provider webhook event types (e.g. Resend webhooks) to message status.
 * Only `"email.delivered"` promotes a message to `"delivered"`.
 */
export function resolveStatusFromProviderEvent(
  eventType: string,
): { status: "sent" | "delivered" | "failed"; errorMessage?: string } | null {
  switch (eventType) {
    case "email.sent":
      return { status: "sent" };
    case "email.delivered":
      return { status: "delivered" };
    case "email.bounced":
      return { status: "failed", errorMessage: "Provider reported recipient bounce." };
    case "email.complained":
      return { status: "failed", errorMessage: "Provider reported spam complaint." };
    case "email.delivery_delayed":
      return { status: "sent" };
    default:
      return null;
  }
}

