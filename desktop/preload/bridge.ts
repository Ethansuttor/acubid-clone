/**
 * Workspace preload (sandboxed). Exposes exactly the C1 bridge — `protocol`
 * and `invoke` on `window.voltline` — and nothing else: no ipcRenderer, no
 * Node, no file paths. Bundled to a single file because a sandboxed preload
 * cannot load local modules.
 *
 * This is only the first gate. The main process re-validates sender, frame,
 * envelope, protocol, operation and size on every call.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
  BRIDGE_GLOBAL,
  IPC_CHANNEL,
  IPC_OPERATIONS,
  IPC_PROTOCOL_VERSION,
  MAX_IPC_PAYLOAD_BYTES,
  type IpcContract,
  type IpcOperation,
  type IpcResponse,
  type VoltlineBridge,
} from "../contracts";
import { APP_ORIGIN } from "../shared/constants";
import { measurePayload } from "../shared/payload-size";

function localError(requestId: string, code: "invalid-input" | "too-large" | "io-failed", message: string): IpcResponse<never> {
  return { protocol: IPC_PROTOCOL_VERSION, requestId, ok: false, error: { code, message } };
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

const bridge: VoltlineBridge = {
  protocol: IPC_PROTOCOL_VERSION,
  async invoke<K extends keyof IpcContract>(
    operation: K,
    payload: IpcContract[K]["payload"]
  ): Promise<IpcResponse<IpcContract[K]["result"]>> {
    const requestId = newRequestId();
    if (typeof operation !== "string" || !IPC_OPERATIONS.has(operation as IpcOperation)) {
      return localError(requestId, "invalid-input", "The desktop bridge does not offer that operation.");
    }
    const size = measurePayload(payload, MAX_IPC_PAYLOAD_BYTES);
    if (!size.ok) return localError(requestId, size.code, size.message);
    try {
      return (await ipcRenderer.invoke(IPC_CHANNEL, {
        protocol: IPC_PROTOCOL_VERSION,
        requestId,
        operation,
        payload,
      })) as IpcResponse<IpcContract[K]["result"]>;
    } catch {
      return localError(requestId, "io-failed", "The desktop bridge could not reach Voltline's main process.");
    }
  },
};

// Only the workspace origin gets the bridge. The main process enforces this
// too; checking here keeps it out of any page that is not the app.
if (globalThis.location?.origin === APP_ORIGIN) {
  contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, bridge);
}
