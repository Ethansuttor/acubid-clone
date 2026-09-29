/**
 * Desktop shell configuration and command-line parsing (track D1/D2).
 *
 * Pure module: no Electron import, so unit tests and the build scripts can
 * load it. Origin constants live in ../shared/constants so the sandboxed
 * preloads can share them.
 */

import path from "node:path";

/** The subset of `node:path` used here; tests pass `path.win32` or `path.posix`. */
type PathApi = Pick<typeof path, "isAbsolute" | "normalize" | "resolve">;

export {
  APP_ORIGIN,
  APP_HOST,
  APP_SCHEME,
  SHELL_HOST,
  SHELL_ORIGIN,
  SHELL_IPC_CHANNEL,
} from "../shared/constants";

/** Per-launch request token header the proxy adds and the server requires. */
export const LAUNCH_TOKEN_HEADER = "x-voltline-launch-token";
/** Per-launch identity header the server adds and the proxy verifies. */
export const LAUNCH_ID_HEADER = "x-voltline-launch-id";

export const LOOPBACK_HOST = "127.0.0.1";

export const APP_NAME = "Voltline";
/** Windows taskbar identity; D4 packaging must use the same value. */
export const APP_USER_MODEL_ID = "com.voltline.desktop";

export const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
export const MIN_STARTUP_TIMEOUT_MS = 1_000;
export const MAX_STARTUP_TIMEOUT_MS = 600_000;

/** How long close waits for the page to report its saves settled before
 * asking the estimator what to do. */
export const CLOSE_SETTLE_WINDOW_MS = 5_000;
export const CLOSE_POLL_INTERVAL_MS = 250;

/** Relative location of the standalone server next to the Electron app. The
 * same rule works for the staged tree (`resources/app` + `resources/server`)
 * and for a packaged build (`resources/app.asar` + `resources/server`). */
export const SERVER_DIR_NAME = "server";
export const SERVER_ENTRY_FILE = "voltline-server-entry.js";
export const SERVER_NEXT_FILE = "server.js";

export interface DesktopOptions {
  /** Absolute data directory, or null for the per-user default. */
  readonly dataDir: string | null;
  readonly startupTimeoutMs: number;
  /**
   * Loopback port for the local server. `null` (the default) lets the OS pick
   * a free one, which is safe because the renderer's origin never contains
   * it. An explicit port is a diagnostics/test switch: if it is busy the
   * launch fails visibly instead of picking another or adopting whatever
   * already listens there.
   */
  readonly serverPort: number | null;
  /** How long a blocked close waits before asking the estimator. */
  readonly closeSettleMs: number;
}

export type OptionsResult =
  | { readonly ok: true; readonly options: DesktopOptions }
  | { readonly ok: false; readonly message: string };

const DATA_DIR_SWITCH = "--voltline-data-dir=";
const TIMEOUT_SWITCH = "--voltline-startup-timeout-ms=";
const PORT_SWITCH = "--voltline-server-port=";
const CLOSE_SETTLE_SWITCH = "--voltline-close-settle-ms=";

/** Explicit server ports stay out of the privileged range. */
export const MIN_SERVER_PORT = 1_024;
export const MAX_SERVER_PORT = 65_535;
export const MIN_CLOSE_SETTLE_MS = 100;
export const MAX_CLOSE_SETTLE_MS = 60_000;

/**
 * Parse the only switches the shell accepts. Unknown arguments are ignored
 * (Chromium and test runners add their own). A malformed Voltline switch is an
 * error rather than a silent default: a typo in `--voltline-data-dir` must not
 * quietly open the estimator's real workspace.
 */
export function parseDesktopArgs(argv: readonly string[], platformPath: PathApi = path): OptionsResult {
  let dataDir: string | null = null;
  let startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS;
  let serverPort: number | null = null;
  let closeSettleMs = CLOSE_SETTLE_WINDOW_MS;
  for (const arg of argv) {
    if (arg.startsWith(DATA_DIR_SWITCH)) {
      const value = arg.slice(DATA_DIR_SWITCH.length);
      if (!value || !platformPath.isAbsolute(value)) {
        return { ok: false, message: "--voltline-data-dir must be an absolute path." };
      }
      dataDir = platformPath.normalize(value);
    } else if (arg.startsWith(TIMEOUT_SWITCH)) {
      const raw = arg.slice(TIMEOUT_SWITCH.length);
      const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(value) || value < MIN_STARTUP_TIMEOUT_MS || value > MAX_STARTUP_TIMEOUT_MS) {
        return {
          ok: false,
          message: `--voltline-startup-timeout-ms must be an integer from ${MIN_STARTUP_TIMEOUT_MS} to ${MAX_STARTUP_TIMEOUT_MS}.`,
        };
      }
      startupTimeoutMs = value;
    } else if (arg.startsWith(PORT_SWITCH)) {
      const raw = arg.slice(PORT_SWITCH.length);
      const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(value) || value < MIN_SERVER_PORT || value > MAX_SERVER_PORT) {
        return { ok: false, message: `--voltline-server-port must be an integer from ${MIN_SERVER_PORT} to ${MAX_SERVER_PORT}.` };
      }
      serverPort = value;
    } else if (arg.startsWith(CLOSE_SETTLE_SWITCH)) {
      const raw = arg.slice(CLOSE_SETTLE_SWITCH.length);
      const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(value) || value < MIN_CLOSE_SETTLE_MS || value > MAX_CLOSE_SETTLE_MS) {
        return {
          ok: false,
          message: `--voltline-close-settle-ms must be an integer from ${MIN_CLOSE_SETTLE_MS} to ${MAX_CLOSE_SETTLE_MS}.`,
        };
      }
      closeSettleMs = value;
    } else if (arg.startsWith("--voltline-")) {
      return { ok: false, message: `Unknown Voltline option ${arg.split("=")[0]}.` };
    }
  }
  return { ok: true, options: { dataDir, startupTimeoutMs, serverPort, closeSettleMs } };
}

/** Where the standalone server lives relative to the Electron app path. */
export function resolveServerDir(appPath: string, platformPath: PathApi = path): string {
  return platformPath.resolve(appPath, "..", SERVER_DIR_NAME);
}
