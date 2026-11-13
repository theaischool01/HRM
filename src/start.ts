import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const ABORT_ERROR_CODES = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE"]);
const ABORT_ERROR_MESSAGES = new Set([
  "aborted",
  "The operation was aborted",
  "BodyStreamBuffer was aborted",
]);

function matchesAbortError(
  candidate: unknown,
  signalAborted: boolean,
  depth = 0
): boolean {
  if (depth > 4 || candidate == null || typeof candidate !== "object") {
    return false;
  }

  const record = candidate as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };

  if (record.status === 499 || record.statusCode === 499) {
    return true;
  }
  if (record.name === "AbortError") {
    return true;
  }
  if (typeof record.code === "string" && ABORT_ERROR_CODES.has(record.code)) {
    return true;
  }
  if (typeof record.message === "string") {
    if (ABORT_ERROR_MESSAGES.has(record.message)) {
      return true;
    }
    if (signalAborted && /\babort(?:ed)?\b/i.test(record.message)) {
      return true;
    }
  }

  return record.cause !== undefined
    ? matchesAbortError(record.cause, signalAborted, depth + 1)
    : false;
}

/** Detect errors raised when a client aborts or closes an in-flight request. */
export function isClientAbortError(error: unknown, request?: Request): boolean {
  return matchesAbortError(error, request?.signal?.aborted === true);
}

/** Annotate a client-abort error with HTTP 499 so downstream error loggers skip stack dumps. */
export function markClientAbortError(error: unknown): void {
  if (error == null || typeof error !== "object") {
    return;
  }
  const target = error as {
    status?: number;
    statusCode?: number;
    statusText?: string;
  };
  try {
    target.status ??= 499;
    target.statusCode ??= 499;
    target.statusText ??= "Client Closed Request";
  } catch {
    // Ignore frozen/non-writable error objects.
  }
}

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (isClientAbortError(error, request)) {
      markClientAbortError(error);
      return new Response(null, {
        status: 499,
        statusText: "Client Closed Request",
      });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
