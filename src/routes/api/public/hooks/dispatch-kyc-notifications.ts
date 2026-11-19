import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

function verifySchedulerSecret(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Drains due KYC notification outbox events (grouped correction emails,
 * retries after SMTP failures). Authenticated with the server-only scheduler
 * secret; returns aggregate counters only — never names, emails or reasons.
 */
export const Route = createFileRoute("/api/public/hooks/dispatch-kyc-notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("x-scheduler-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected = process.env["SCHEDULER_HOOK_SECRET"] ?? process.env["CRON_SECRET"] ?? "";
        if (!verifySchedulerSecret(provided, expected)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const { processKycNotifications } = await import("@/lib/kyc/kyc-notifications.server");
          const { schemaReady, results } = await processKycNotifications({ limit: 25 });
          const count = (o: string) => results.filter((r) => r.outcome === o).length;
          return new Response(
            JSON.stringify({
              schemaReady,
              processed: results.length,
              sent: count("sent"),
              skipped: count("skipped"),
              retryScheduled: count("retry_scheduled"),
              failed: count("failed"),
            }),
            { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
          );
        } catch (error) {
          console.error("[dispatch-kyc-notifications]", error instanceof Error ? error.message : error);
          return new Response(JSON.stringify({ error: "Dispatch failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
