import { describe, expect, it } from "vitest";
import { isClientAbortError, markClientAbortError } from "@/start";

describe("client abort error detection", () => {
  it("recognizes Node HTTP ECONNRESET aborted errors from abortIncoming", () => {
    const error = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    expect(isClientAbortError(error)).toBe(true);
  });

  it("recognizes AbortError instances", () => {
    const domAbort = new DOMException("The operation was aborted", "AbortError");
    expect(isClientAbortError(domAbort)).toBe(true);

    const errAbort = new Error("Aborted");
    errAbort.name = "AbortError";
    expect(isClientAbortError(errAbort)).toBe(true);
  });

  it("recognizes wrapped errors whose cause is an aborted error", () => {
    const cause = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    const wrapped = new Error("Failed reading request body", { cause });
    expect(isClientAbortError(wrapped)).toBe(true);
  });

  it("recognizes abort-related messages when request.signal is aborted", () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request("http://localhost:8080/_serverFn/test", {
      signal: controller.signal,
    });
    const error = new Error("Client aborted while streaming request");
    expect(isClientAbortError(error, request)).toBe(true);
  });

  it("does not misclassify genuine application errors as client aborts", () => {
    expect(isClientAbortError(new Error("Database connection failed"))).toBe(false);
    expect(isClientAbortError(new TypeError("Cannot read properties of undefined"))).toBe(
      false
    );
    expect(
      isClientAbortError(
        Object.assign(new Error("Internal Server Error"), { statusCode: 500 })
      )
    ).toBe(false);

    const controller = new AbortController();
    controller.abort();
    const request = new Request("http://localhost:8080/_serverFn/test", {
      signal: controller.signal,
    });
    expect(isClientAbortError(new Error("Database query syntax error"), request)).toBe(
      false
    );
  });

  it("stamps HTTP 499 metadata without overwriting existing status codes", () => {
    const error = Object.assign(new Error("aborted"), { code: "ECONNRESET" }) as Error & {
      code: string;
      status?: number;
      statusCode?: number;
      statusText?: string;
    };

    markClientAbortError(error);

    expect(error.status).toBe(499);
    expect(error.statusCode).toBe(499);
    expect(error.statusText).toBe("Client Closed Request");
  });
});

