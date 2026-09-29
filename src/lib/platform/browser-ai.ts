"use client";

/**
 * Browser AI transport: posts to the existing Next.js API routes, which hold
 * the provider key server-side and fail closed in production. Behavior matches
 * what `pipeline.ts` and `SheetAnalysis.tsx` do today — same bounds, same
 * timeout, same "no retries, no escalation" rule.
 */

import {
  AI_LIMITS,
  checkVerifyRequest,
  type AiCallOptions,
  type AiTransport,
  type AnalyzeSheetsRequest,
  type AnalyzeSheetsResponse,
  type SheetProposal,
  type VerifyCropsRequest,
  type VerifyCropsResponse,
} from "./ai";
import { fail, failureFrom, ok, type PlatformResult } from "./contracts";
import { validVerificationMap } from "../autocount/local";

function timeoutSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(AI_LIMITS.requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** HTTP status to contract error code. A closed route is not an outage. */
function statusFailure(status: number, detail: string): PlatformResult<never> {
  if (status === 401 || status === 403) {
    return fail("unauthorized", "Optional AI review is not enabled for this build.");
  }
  if (status === 503) return fail("unavailable", detail || "No AI provider is configured.");
  if (status === 413) return fail("too-large", detail || "The AI request was too large.");
  if (status === 400) return fail("invalid-input", detail || "The AI request was rejected.");
  return fail("io-failed", detail || `Optional AI review unavailable (HTTP ${status}).`);
}

async function detailOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    // A non-JSON error body carries no usable detail; the status stands alone.
  }
  return "";
}

export function createBrowserAiTransport(authHeader: string): AiTransport {
  return {
    kind: "web-route",

    async verifyCrops(
      request: VerifyCropsRequest,
      options?: AiCallOptions
    ): Promise<PlatformResult<VerifyCropsResponse>> {
      const problem = checkVerifyRequest(request);
      if (problem) return fail(problem.code, problem.message);
      const body = JSON.stringify({
        mode: "verify",
        template: request.template,
        crops: request.crops,
      });
      if (new TextEncoder().encode(body).length > AI_LIMITS.maxVerifyRequestBytes) {
        return fail("too-large", "The verification request exceeds 2 MB. Send fewer crops.");
      }
      try {
        const response = await fetch("/api/autocount", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: authHeader },
          body,
          signal: timeoutSignal(options?.signal),
        });
        if (!response.ok) return statusFailure(response.status, await detailOf(response));
        const result: unknown = await response.json();
        const payload = result as { verifications?: unknown; model?: unknown };
        // A missing or malformed decision leaves its candidate unresolved; it
        // never removes a local candidate.
        const valid = validVerificationMap(
          payload.verifications,
          request.crops.map((crop) => crop.index)
        );
        return ok({
          verifications: [...valid.values()],
          model: typeof payload.model === "string" ? payload.model : "AI review",
        });
      } catch (error) {
        return failureFrom(error, "Optional AI review failed.");
      }
    },

    async analyzeSheets(
      request: AnalyzeSheetsRequest,
      options?: AiCallOptions
    ): Promise<PlatformResult<AnalyzeSheetsResponse>> {
      if (request.sheets.length === 0) {
        return fail("invalid-input", "No sheets were supplied for analysis.");
      }
      if (request.sheets.length > AI_LIMITS.maxSheetsPerRequest) {
        return fail(
          "too-large",
          `Analyse at most ${AI_LIMITS.maxSheetsPerRequest} sheets per request.`
        );
      }
      try {
        const response = await fetch("/api/sheetinfo", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: authHeader },
          body: JSON.stringify({ sheets: request.sheets }),
          signal: timeoutSignal(options?.signal),
        });
        if (!response.ok) return statusFailure(response.status, await detailOf(response));
        const result: unknown = await response.json();
        const payload = result as { proposals?: unknown; model?: unknown };
        if (!Array.isArray(payload.proposals)) {
          return fail("io-failed", "Sheet analysis returned no readable proposals.");
        }
        return ok({
          proposals: payload.proposals as SheetProposal[],
          model: typeof payload.model === "string" ? payload.model : "AI review",
        });
      } catch (error) {
        return failureFrom(error, "Sheet analysis failed.");
      }
    },
  };
}
