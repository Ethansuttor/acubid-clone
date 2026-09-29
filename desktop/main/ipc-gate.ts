/**
 * Validation for the privileged side of the C1 bridge. Free of Electron
 * imports so it is unit tested in Node.
 *
 * Order of checks for every call on the C1 channel:
 *   1. sender    — the message came from a workspace window's webContents;
 *   2. frame     — from that window's main frame, currently at the app origin;
 *   3. envelope  — exactly {protocol, requestId, operation, payload};
 *   4. protocol  — equal to IPC_PROTOCOL_VERSION (checked on every call);
 *   5. operation — a member of IPC_OPERATIONS;
 *   6. size      — the payload, walked structurally, fits MAX_IPC_PAYLOAD_BYTES
 *                  and contains only plain data (no cycles, no exotic objects).
 * Each operation handler then validates its own payload shape.
 */

import {
  IPC_OPERATIONS,
  IPC_PROTOCOL_VERSION,
  MAX_IPC_PAYLOAD_BYTES,
  isIpcRequest,
  type IpcOperation,
  type IpcRequest,
  type IpcResponse,
} from "../contracts";
import type { PlatformErrorCode } from "../../src/lib/platform/contracts";
import { APP_ORIGIN } from "../shared/constants";
import { measurePayload } from "../shared/payload-size";
import { urlOrigin } from "./navigation";

/** The minimum an Electron IPC event must offer for sender/frame checks. */
export interface GateEvent {
  readonly sender: { readonly id: number };
  /** Electron reports null when the frame navigated away or was destroyed. */
  readonly senderFrame: { readonly url: string; readonly parent: unknown | null } | null;
}

export type IpcErrorResponse = Extract<IpcResponse<never>, { readonly ok: false }>;

export type GateDecision =
  | { readonly ok: true; readonly request: IpcRequest }
  | { readonly ok: false; readonly response: IpcErrorResponse };

const ENVELOPE_KEYS = new Set(["protocol", "requestId", "operation", "payload"]);

export function errorResponse(requestId: string, code: PlatformErrorCode, message: string): IpcErrorResponse {
  return { protocol: IPC_PROTOCOL_VERSION, requestId, ok: false, error: { code, message } };
}

/** A requestId that is safe to echo back even from a malformed message. */
function echoableRequestId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const id = (value as { requestId?: unknown }).requestId;
  return typeof id === "string" && id.length > 0 && id.length <= 64 ? id : "";
}

export function isAppOriginUrl(url: string): boolean {
  return urlOrigin(url) === APP_ORIGIN;
}

/**
 * Decide whether a C1 message may be dispatched. `allowedSenderIds` holds the
 * webContents ids of workspace windows; every other sender — a status page,
 * a devtools host, anything created later — is refused.
 */
export function gateIpcMessage(
  event: GateEvent,
  message: unknown,
  allowedSenderIds: ReadonlySet<number>,
  limitBytes: number = MAX_IPC_PAYLOAD_BYTES
): GateDecision {
  const requestId = echoableRequestId(message);
  const refuse = (code: PlatformErrorCode, text: string): GateDecision => ({
    ok: false,
    response: errorResponse(requestId, code, text),
  });

  if (!allowedSenderIds.has(event.sender.id)) {
    return refuse("unauthorized", "This window may not use the desktop bridge.");
  }
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null || !isAppOriginUrl(frame.url)) {
    return refuse("unauthorized", "Only the Voltline workspace page may use the desktop bridge.");
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return refuse("invalid-input", "The desktop bridge received a malformed request.");
  }
  const proto = Object.getPrototypeOf(message);
  if (proto !== Object.prototype && proto !== null) {
    return refuse("invalid-input", "The desktop bridge received a malformed request.");
  }
  const keys = Object.keys(message);
  if (keys.length !== ENVELOPE_KEYS.size || keys.some((key) => !ENVELOPE_KEYS.has(key))) {
    return refuse("invalid-input", "The desktop bridge request has missing or unexpected fields.");
  }
  const envelope = message as Partial<IpcRequest>;
  if (envelope.protocol !== IPC_PROTOCOL_VERSION) {
    return refuse(
      "invalid-input",
      `This window uses desktop bridge protocol ${String(envelope.protocol)}, but Voltline expects ${IPC_PROTOCOL_VERSION}. Restart Voltline.`
    );
  }
  if (typeof envelope.operation !== "string" || !IPC_OPERATIONS.has(envelope.operation as IpcOperation)) {
    return refuse("invalid-input", "The desktop bridge does not offer that operation.");
  }
  if (!isIpcRequest(message)) {
    return refuse("invalid-input", "The desktop bridge request is malformed.");
  }
  const size = measurePayload(envelope.payload, limitBytes);
  if (!size.ok) return refuse(size.code, size.message);
  return { ok: true, request: message };
}
