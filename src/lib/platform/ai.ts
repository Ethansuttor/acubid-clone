/**
 * C1 AI seam. Provider-neutral transport for the two optional AI features
 * Voltline has: bounded crop verification during symbol search, and sheet
 * title-block analysis. Both are proposals — nothing they return may change a
 * quantity without the estimator confirming it.
 *
 * The transport carries requests; it does not decide anything. No provider SDK,
 * no API key, and no prompt text belongs on this side of the seam: the browser
 * adapter posts to the existing API routes, and the desktop adapter will call a
 * privileged service over the bridge. A renderer bundle must never contain a
 * provider secret.
 */

import type { VerificationResult, VerifyCropItem } from "../autocount/types";
import type { SheetInfo } from "../sheetai/types";
import type { AiTransportKind, PlatformResult } from "./contracts";

/**
 * Bounds that already govern the shipped routes and pipeline. They live here so
 * the browser and desktop transports enforce the same limits instead of each
 * re-deriving them. Changing one is an integration-agent change, and the route
 * validators (`validateVerifyRequest`) remain the enforcing authority on the
 * server side — these constants must not drift from it.
 */
export const AI_LIMITS = {
  /** Ambiguous candidates offered to the model in one detection run. */
  maxCandidatesPerRun: 48,
  /** Crops in a single verification request. */
  maxCropsPerRequest: 12,
  /** Largest edge, in pixels, of a candidate or template crop. */
  maxCropEdge: 256,
  /** Largest verification request body. */
  maxVerifyRequestBytes: 2 * 1024 * 1024,
  /** Sheets analysed in one sheet-analysis request. */
  maxSheetsPerRequest: 40,
  /** Wall-clock bound applied by the caller in addition to any server timeout. */
  requestTimeoutMs: 45_000,
} as const;

export interface VerifyCropsRequest {
  /** PNG data URL of the example symbol, at most `maxCropEdge` on each side. */
  readonly template: string;
  readonly crops: readonly VerifyCropItem[];
}

export interface VerifyCropsResponse {
  /**
   * Decisions for the crops the model actually answered for. A missing,
   * duplicate, or out-of-range entry is dropped by the caller and its candidate
   * stays unresolved; a negative decision never deletes a local candidate.
   */
  readonly verifications: readonly VerificationResult[];
  /** Identifier of whatever answered, shown next to pending results. */
  readonly model: string;
}

export interface AnalyzeSheetsRequest {
  readonly sheets: readonly { readonly id: string; readonly image: string }[];
}

export interface SheetProposal extends SheetInfo {
  readonly id: string;
  /** Feet per inch of paper derived from `scaleText`; null when unusable. */
  readonly feetPerInch: number | null;
  readonly error?: string;
}

export interface AnalyzeSheetsResponse {
  readonly proposals: readonly SheetProposal[];
  readonly model: string;
}

export interface AiCallOptions {
  /** Cancellation propagates to the provider call; a cancelled call reports
   * `aborted` and no partial decisions. */
  readonly signal?: AbortSignal;
}

/**
 * Failure semantics shared by every adapter:
 * - a request over a documented bound fails locally with `too-large` or
 *   `invalid-input` and is never sent;
 * - a closed production route reports `unauthorized`;
 * - an unconfigured key reports `unavailable`;
 * - a provider or network failure reports `io-failed`;
 * - cancellation reports `aborted`.
 * In every failure case the caller keeps its local candidates and leaves them
 * pending. Adapters never retry on their own and never escalate spending.
 */
export interface AiTransport {
  readonly kind: AiTransportKind;
  verifyCrops(
    request: VerifyCropsRequest,
    options?: AiCallOptions
  ): Promise<PlatformResult<VerifyCropsResponse>>;
  analyzeSheets(
    request: AnalyzeSheetsRequest,
    options?: AiCallOptions
  ): Promise<PlatformResult<AnalyzeSheetsResponse>>;
}

/** Bounds check every adapter runs before spending anything. */
export function checkVerifyRequest(request: VerifyCropsRequest): {
  code: "invalid-input" | "too-large";
  message: string;
} | null {
  if (!request.template.startsWith("data:image/png;base64,")) {
    return { code: "invalid-input", message: "The example symbol must be a PNG crop." };
  }
  if (request.crops.length === 0) {
    return { code: "invalid-input", message: "No candidate crops were supplied." };
  }
  if (request.crops.length > AI_LIMITS.maxCropsPerRequest) {
    return {
      code: "too-large",
      message: `Send at most ${AI_LIMITS.maxCropsPerRequest} crops per request.`,
    };
  }
  const indices = new Set<number>();
  for (const crop of request.crops) {
    if (!Number.isInteger(crop.index) || crop.index < 0 || indices.has(crop.index)) {
      return { code: "invalid-input", message: "Candidate crops must be uniquely numbered." };
    }
    indices.add(crop.index);
    if (!crop.image.startsWith("data:image/png;base64,")) {
      return { code: "invalid-input", message: "Each candidate crop must be a PNG image." };
    }
  }
  return null;
}

let active: AiTransport | null = null;

export function setAiTransport(transport: AiTransport | null): void {
  active = transport;
}

/** Null means no AI review is available; callers stay local-only and say so. */
export function aiTransport(): AiTransport | null {
  return active;
}
