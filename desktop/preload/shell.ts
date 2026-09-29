/**
 * Status-page preload (sandboxed). Status pages (starting, failed to start,
 * server stopped) can ask the main process for one of a fixed set of actions
 * and nothing else. They never receive the C1 workspace bridge.
 */

import { contextBridge, ipcRenderer } from "electron";
import { SHELL_ACTIONS, SHELL_GLOBAL, SHELL_IPC_CHANNEL, SHELL_ORIGIN, type ShellAction } from "../shared/constants";

if (globalThis.location?.origin === SHELL_ORIGIN) {
  contextBridge.exposeInMainWorld(SHELL_GLOBAL, {
    act(action: ShellAction): Promise<boolean> {
      if (!SHELL_ACTIONS.has(action)) return Promise.resolve(false);
      return ipcRenderer.invoke(SHELL_IPC_CHANNEL, { action }).then(
        (accepted: unknown) => accepted === true,
        () => false
      );
    },
  });
}
