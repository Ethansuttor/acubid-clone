/**
 * C1 platform contracts — the frozen seam between Voltline's application code
 * and the runtime it happens to be executing in (browser today, packaged
 * Windows desktop next).
 *
 * These declarations are environment-neutral on purpose: they must be
 * importable from a Node test, a client component, and the Electron main
 * process alike. Nothing here may import IndexedDB, Electron, `next/*`, or a
 * provider SDK.
 *
 * Changing an exported signature in this file after C1 is an integration-agent
 * change: workers request it rather than editing it in a track branch.
 */

/**
 * Bumped when a contract in this file, `./storage`, `./ai`, or
 * `desktop/contracts` changes shape in a way an older peer cannot satisfy.
 * The desktop bridge refuses to talk to a renderer built against a different
 * major value rather than guessing what the other side meant.
 */
export const PLATFORM_CONTRACT_VERSION = 1;

export type PlatformKind = "browser" | "desktop";

/**
 * What the current runtime can actually do. Callers branch on capabilities,
 * never on a user-agent string, and a capability that is absent must produce a
 * visible explanation rather than a silent no-op.
 */
export interface PlatformCapabilities {
  readonly kind: PlatformKind;
  readonly contractVersion: number;
  /** Primary record store backing the workspace. */
  readonly recordStore: "indexeddb" | "sqlite" | "memory";
  /** Plan PDFs are stored as blobs (browser) or as files on disk (desktop). */
  readonly fileStore: "indexeddb" | "filesystem" | "memory";
  /**
   * True when the adapter can guarantee no other editor holds the workspace
   * for the duration of a maintenance job. Web Locks satisfy this within one
   * browser origin/profile only; they do not coordinate a second OS process.
   */
  readonly exclusiveWorkspaceLock: boolean;
  /** An optional user-selected second copy of the journal and snapshot. */
  readonly folderMirror: boolean;
  /** Portable single-file backup export/import. */
  readonly portableBackup: boolean;
  /** How optional AI review reaches a provider, if at all. */
  readonly aiTransport: AiTransportKind;
  /** True when a provider key is held by the runtime, never by the renderer. */
  readonly managedCredentials: boolean;
}

export type AiTransportKind = "web-route" | "privileged-service" | "unavailable";

/**
 * Error codes are part of the contract; message text is not. Callers switch on
 * `code` and show `message` to the estimator.
 *
 * - `unavailable`     the capability does not exist in this runtime
 * - `unauthorized`    the runtime refused the request (production API guard)
 * - `invalid-input`   caller-supplied data failed validation; nothing was written
 * - `not-found`       the addressed record or file does not exist
 * - `conflict`        the write would violate a uniqueness or ownership rule
 * - `occupied`        another editor or process holds the workspace
 * - `too-large`       the payload exceeds a documented bound
 * - `integrity`       stored or supplied bytes failed a checksum/graph check
 * - `aborted`         the caller cancelled; no partial result is reported
 * - `io-failed`       the underlying store or transport failed
 */
export type PlatformErrorCode =
  | "unavailable"
  | "unauthorized"
  | "invalid-input"
  | "not-found"
  | "conflict"
  | "occupied"
  | "too-large"
  | "integrity"
  | "aborted"
  | "io-failed";

export interface PlatformError {
  readonly code: PlatformErrorCode;
  /** Shown to the estimator. Never contains a key, a path outside the
   * workspace, or drawing content. */
  readonly message: string;
}

export type PlatformResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PlatformError };

export function ok<T>(value: T): PlatformResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: PlatformErrorCode, message: string): PlatformResult<T> {
  return { ok: false, error: { code, message } };
}

export function isOk<T>(result: PlatformResult<T>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Convert a thrown value into a result without losing an abort. An adapter
 * that catches broadly must use this so a cancelled job is never reported as
 * a storage failure — a failed save has to stay visible, and a cancellation
 * must not look like one.
 */
export function failureFrom(error: unknown, fallback: string): PlatformResult<never> {
  if (error instanceof DOMException && error.name === "AbortError") {
    return fail("aborted", "The operation was cancelled.");
  }
  if (error instanceof Error && error.name === "AbortError") {
    return fail("aborted", "The operation was cancelled.");
  }
  return fail("io-failed", error instanceof Error && error.message ? error.message : fallback);
}

/** Unwrap for call sites that already treat failure as fatal (tests, scripts). */
export function expect<T>(result: PlatformResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`${result.error.code}: ${result.error.message}`);
}
