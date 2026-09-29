/**
 * Dispatch for C1 operations after the gate has accepted a message.
 *
 * D2 ships the lifecycle only. Storage (SQLite, track S / I1), AI transport
 * and credential custody (D3) do not exist in this build, so every one of
 * those operations answers with an explicit `unavailable` contract error.
 * Nothing falls back silently: the workspace keeps using its own browser
 * IndexedDB store, which is what `app.capabilities` reports.
 */

import { IPC_PROTOCOL_VERSION, type IpcContract, type IpcOperation, type IpcRequest, type IpcResponse } from "../contracts";
import { errorResponse } from "./ipc-gate";

export interface HandlerContext {
  readonly appVersion: string;
}

type CapabilitiesResult = IpcContract["app.capabilities"]["result"];

export const UNAVAILABLE_MESSAGES = {
  storage:
    "Desktop storage is not part of this build. The workspace is stored in this window's local browser database (preview).",
  ai: "Optional AI review is not available in this desktop build. Local symbol search still works.",
  credential: "Provider credentials cannot be managed in this desktop build.",
} as const;

function familyOf(operation: IpcOperation): keyof typeof UNAVAILABLE_MESSAGES | "app" {
  const family = operation.split(".")[0];
  if (family === "storage" || family === "ai" || family === "credential") return family;
  return "app";
}

export function capabilities(context: HandlerContext): CapabilitiesResult {
  return {
    protocol: IPC_PROTOCOL_VERSION,
    appVersion: context.appVersion,
    recordStore: "indexeddb",
    fileStore: "indexeddb",
    managedCredentials: false,
  };
}

export async function dispatchIpc(request: IpcRequest, context: HandlerContext): Promise<IpcResponse<unknown>> {
  const { requestId, operation, payload } = request;
  const family = familyOf(operation);
  if (family !== "app") {
    return errorResponse(requestId, "unavailable", UNAVAILABLE_MESSAGES[family]);
  }
  if (operation === "app.capabilities") {
    if (payload !== null) {
      return errorResponse(requestId, "invalid-input", "app.capabilities takes no payload.");
    }
    return { protocol: IPC_PROTOCOL_VERSION, requestId, ok: true, value: capabilities(context) };
  }
  return errorResponse(requestId, "unavailable", "That operation is not available in this desktop build.");
}
