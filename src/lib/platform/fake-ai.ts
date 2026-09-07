/**
 * Runnable in-memory AI transport. It enforces the documented bounds and
 * failure semantics without any provider call, so every AI-adjacent test —
 * cancellation, malformed answers, provider errors, closed routes — runs for
 * free and the "no paid calls in tests" rule stays enforceable.
 */

import {
  AI_LIMITS,
  checkVerifyRequest,
  type AiCallOptions,
  type AiTransport,
  type AnalyzeSheetsRequest,
  type AnalyzeSheetsResponse,
  type VerifyCropsRequest,
  type VerifyCropsResponse,
} from "./ai";
import { fail, ok, type PlatformResult } from "./contracts";

export interface FakeAiScript {
  /** Decision returned for each crop index. Omitted indexes come back with no
   * decision at all, which must leave that candidate unresolved. */
  decisions?: Record<number, { match: boolean; confidence: number }>;
  model?: string;
  /** Force a failure instead of answering. */
  failWith?: { code: "unauthorized" | "unavailable" | "io-failed" | "too-large"; message: string };
  /** Resolve only after the caller aborts, to exercise cancellation. */
  hang?: boolean;
}

export interface FakeAiTransport extends AiTransport {
  readonly calls: { operation: "verifyCrops" | "analyzeSheets"; crops: number }[];
  script: FakeAiScript;
}

function aborted<T>(): PlatformResult<T> {
  return fail("aborted", "The operation was cancelled.");
}

export function createFakeAiTransport(script: FakeAiScript = {}): FakeAiTransport {
  const calls: { operation: "verifyCrops" | "analyzeSheets"; crops: number }[] = [];

  const transport: FakeAiTransport = {
    kind: "privileged-service",
    calls,
    script,

    async verifyCrops(
      request: VerifyCropsRequest,
      options?: AiCallOptions
    ): Promise<PlatformResult<VerifyCropsResponse>> {
      const problem = checkVerifyRequest(request);
      if (problem) return fail(problem.code, problem.message);
      if (options?.signal?.aborted) return aborted();
      calls.push({ operation: "verifyCrops", crops: request.crops.length });
      if (transport.script.hang) {
        await new Promise<void>((resolve) => {
          if (!options?.signal) return;
          options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return aborted();
      }
      if (transport.script.failWith) {
        return fail(transport.script.failWith.code, transport.script.failWith.message);
      }
      const decisions = transport.script.decisions ?? {};
      return ok({
        verifications: request.crops
          .filter((crop) => decisions[crop.index] !== undefined)
          .map((crop) => ({ index: crop.index, ...decisions[crop.index] })),
        model: transport.script.model ?? "fake-verifier",
      });
    },

    async analyzeSheets(
      request: AnalyzeSheetsRequest,
      options?: AiCallOptions
    ): Promise<PlatformResult<AnalyzeSheetsResponse>> {
      if (request.sheets.length === 0) {
        return fail("invalid-input", "No sheets were supplied for analysis.");
      }
      if (request.sheets.length > AI_LIMITS.maxSheetsPerRequest) {
        return fail("too-large", "Too many sheets in one request.");
      }
      if (options?.signal?.aborted) return aborted();
      calls.push({ operation: "analyzeSheets", crops: request.sheets.length });
      if (transport.script.failWith) {
        return fail(transport.script.failWith.code, transport.script.failWith.message);
      }
      return ok({
        proposals: request.sheets.map((sheet) => ({
          id: sheet.id,
          sheetNumber: null,
          sheetTitle: null,
          scaleText: null,
          confidence: 0,
          feetPerInch: null,
        })),
        model: transport.script.model ?? "fake-analyzer",
      });
    },
  };

  return transport;
}
