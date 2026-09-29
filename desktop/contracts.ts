/**
 * C1 desktop IPC contract — the only shapes allowed to cross the Electron
 * privileged boundary.
 *
 * Rules this file encodes, all of which track D and track S must honor:
 *
 * 1. Everything here is structured-clone serializable. No Blob, no File, no
 *    class instance, no function. Plan bytes travel as `ArrayBuffer`.
 * 2. A TypeScript type is not input validation. The main process revalidates
 *    every field, the sender frame, and the byte size before acting; these
 *    declarations only describe what a valid message looks like.
 * 3. There is no operation that reads a provider key back out. The renderer can
 *    set, clear, and ask the status of a credential and nothing else.
 * 4. Protocol version is checked on every call, not only at startup, so a stale
 *    renderer after an upgrade fails loudly instead of writing with the wrong
 *    assumptions.
 *
 * This module is deliberately dependency-free so the preload script, the main
 * process, and a renderer type-check can all import it.
 */

import type { PlatformErrorCode } from "../src/lib/platform/contracts";

/** Incremented whenever any DTO below changes shape. */
export const IPC_PROTOCOL_VERSION = 1;

/** The single channel name; the operation lives inside the envelope. */
export const IPC_CHANNEL = "voltline.bridge.v1";

/** Name of the object the preload script exposes on `window`. */
export const BRIDGE_GLOBAL = "voltline";

/** Largest single IPC payload the main process will accept, in bytes. */
export const MAX_IPC_PAYLOAD_BYTES = 64 * 1024 * 1024;

export type IpcOperation =
  // storage — record operations
  | "storage.select"
  | "storage.insert"
  | "storage.update"
  | "storage.delete"
  | "storage.replaceAssemblyItems"
  // storage — plan files
  | "storage.putFile"
  | "storage.getFile"
  | "storage.deleteFiles"
  // storage — whole-workspace operations
  | "storage.exportBundle"
  | "storage.restore"
  | "storage.health"
  // optional AI, executed entirely in the privileged process
  | "ai.verifyCrops"
  | "ai.analyzeSheets"
  | "ai.cancel"
  // credential custody: set, clear and status only, never read
  | "credential.set"
  | "credential.clear"
  | "credential.status"
  // runtime
  | "app.capabilities";

export interface IpcRequest<TPayload = unknown> {
  readonly protocol: number;
  /** Correlates a response and lets `ai.cancel` address an in-flight call. */
  readonly requestId: string;
  readonly operation: IpcOperation;
  readonly payload: TPayload;
}

export type IpcResponse<TValue = unknown> =
  | { readonly protocol: number; readonly requestId: string; readonly ok: true; readonly value: TValue }
  | {
      readonly protocol: number;
      readonly requestId: string;
      readonly ok: false;
      readonly error: { readonly code: PlatformErrorCode; readonly message: string };
    };

/* ---------------------------------------------------------------- storage */

export type IpcRow = Record<string, unknown>;

export type IpcFilter =
  | { readonly kind: "eq"; readonly column: string; readonly value: unknown }
  | { readonly kind: "in"; readonly column: string; readonly values: readonly unknown[] };

export interface IpcSelectPayload {
  readonly table: string;
  readonly filters: readonly IpcFilter[];
  readonly order?: { readonly column: string; readonly ascending: boolean };
}

export interface IpcInsertPayload {
  readonly table: string;
  readonly rows: readonly IpcRow[];
}

export interface IpcUpdatePayload {
  readonly table: string;
  readonly patch: IpcRow;
  readonly filters: readonly IpcFilter[];
}

export interface IpcDeletePayload {
  readonly table: string;
  readonly filters: readonly IpcFilter[];
}

export interface IpcReplaceAssemblyItemsPayload {
  readonly assemblyId: string;
  readonly rows: readonly IpcRow[];
}

/** Plan bytes cross the boundary as a transferable buffer, never as a Blob. */
export interface IpcFilePayload {
  readonly path: string;
  readonly bytes: ArrayBuffer;
  readonly contentType: string;
}

export interface IpcPathPayload {
  readonly path: string;
}

export interface IpcPathsPayload {
  readonly paths: readonly string[];
}

/** Serializable form of a workspace bundle: rows plus plan bytes. */
export interface IpcBundle {
  readonly snapshot: {
    readonly format: "voltline-recovery";
    readonly schema_version: 1;
    readonly exported_at: string;
    readonly tables: Record<string, IpcRow[]>;
    readonly files?: { readonly path: string; readonly recovery_filename: string }[];
  };
  readonly files: readonly IpcFilePayload[];
}

export interface IpcHealth {
  readonly readable: boolean;
  readonly writable: boolean;
  readonly pendingMirror: number | null;
  readonly detail: string | null;
}

/* --------------------------------------------------------------------- ai */

export interface IpcVerifyCropsPayload {
  readonly template: string;
  readonly crops: readonly { readonly index: number; readonly image: string }[];
}

export interface IpcVerifyCropsResult {
  readonly verifications: readonly {
    readonly index: number;
    readonly match: boolean;
    readonly confidence: number;
  }[];
  readonly model: string;
}

export interface IpcAnalyzeSheetsPayload {
  readonly sheets: readonly { readonly id: string; readonly image: string }[];
}

export interface IpcAnalyzeSheetsResult {
  readonly proposals: readonly {
    readonly id: string;
    readonly sheetNumber: string | null;
    readonly sheetTitle: string | null;
    readonly scaleText: string | null;
    readonly confidence: number;
    readonly feetPerInch: number | null;
    readonly error?: string;
  }[];
  readonly model: string;
}

export interface IpcCancelPayload {
  /** The `requestId` of the in-flight AI call to abort. */
  readonly requestId: string;
}

/* ------------------------------------------------------------- credential */

export interface IpcCredentialSetPayload {
  /** Cleared by the caller immediately after submission; never logged, never
   * written to a backup, never returned by any operation. */
  readonly secret: string;
}

export interface IpcCredentialStatus {
  readonly configured: boolean;
  /** How the secret is protected. `unavailable` means nothing was stored:
   * Voltline does not silently fall back to plaintext. */
  readonly protection: "os-encrypted" | "unavailable";
  readonly detail: string | null;
}

/* ------------------------------------------------------ operation mapping */

/** Payload and result type for each operation, so both sides stay in step. */
export interface IpcContract {
  "storage.select": { payload: IpcSelectPayload; result: IpcRow[] };
  "storage.insert": { payload: IpcInsertPayload; result: IpcRow[] };
  "storage.update": { payload: IpcUpdatePayload; result: null };
  "storage.delete": { payload: IpcDeletePayload; result: null };
  "storage.replaceAssemblyItems": { payload: IpcReplaceAssemblyItemsPayload; result: null };
  "storage.putFile": { payload: IpcFilePayload; result: { path: string } };
  "storage.getFile": { payload: IpcPathPayload; result: IpcFilePayload };
  "storage.deleteFiles": { payload: IpcPathsPayload; result: null };
  "storage.exportBundle": { payload: null; result: IpcBundle };
  "storage.restore": { payload: IpcBundle; result: null };
  "storage.health": { payload: null; result: IpcHealth };
  "ai.verifyCrops": { payload: IpcVerifyCropsPayload; result: IpcVerifyCropsResult };
  "ai.analyzeSheets": { payload: IpcAnalyzeSheetsPayload; result: IpcAnalyzeSheetsResult };
  "ai.cancel": { payload: IpcCancelPayload; result: null };
  "credential.set": { payload: IpcCredentialSetPayload; result: IpcCredentialStatus };
  "credential.clear": { payload: null; result: IpcCredentialStatus };
  "credential.status": { payload: null; result: IpcCredentialStatus };
  "app.capabilities": {
    payload: null;
    result: {
      readonly protocol: number;
      readonly appVersion: string;
      readonly recordStore: "indexeddb" | "sqlite";
      readonly fileStore: "indexeddb" | "filesystem";
      readonly managedCredentials: boolean;
    };
  };
}

/** The shape the preload script exposes to the renderer. */
export interface VoltlineBridge {
  readonly protocol: number;
  invoke<K extends keyof IpcContract>(
    operation: K,
    payload: IpcContract[K]["payload"]
  ): Promise<IpcResponse<IpcContract[K]["result"]>>;
}

/**
 * Shape check used by the main process before dispatch. It is the cheap first
 * gate, not the whole validation: each handler still checks its own payload.
 */
export function isIpcRequest(value: unknown): value is IpcRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<IpcRequest>;
  return (
    request.protocol === IPC_PROTOCOL_VERSION &&
    typeof request.requestId === "string" &&
    request.requestId.length > 0 &&
    request.requestId.length <= 64 &&
    typeof request.operation === "string" &&
    IPC_OPERATIONS.has(request.operation as IpcOperation)
  );
}

export const IPC_OPERATIONS: ReadonlySet<IpcOperation> = new Set<IpcOperation>([
  "storage.select",
  "storage.insert",
  "storage.update",
  "storage.delete",
  "storage.replaceAssemblyItems",
  "storage.putFile",
  "storage.getFile",
  "storage.deleteFiles",
  "storage.exportBundle",
  "storage.restore",
  "storage.health",
  "ai.verifyCrops",
  "ai.analyzeSheets",
  "ai.cancel",
  "credential.set",
  "credential.clear",
  "credential.status",
  "app.capabilities",
]);
