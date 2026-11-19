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
 * Throttled invitation drain, called on a schedule. Authenticated with a
 * dedicated, server-only scheduler secret (never shipped to the browser); it
 * performs no read of user data and returns only aggregate counters.
 */
export const Route = createFileRoute("/api/public/hooks/dispatch-invitations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("x-scheduler-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected = process.env["SCHEDULER_HOOK_SECRET"] ?? "";

        if (!verifySchedulerSecret(provided, expected)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }


        try {
          const { dispatchInvitationBatch } = await import("@/lib/invitations.server");
          // Redirect target comes from validated PUBLIC_APP_URL config, never request.url / Host.
          const result = await dispatchInvitationBatch();
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (error) {
          console.error("[dispatch-invitations]", error);
          return new Response(JSON.stringify({ error: "Dispatch failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
