/**
 * Environment and readiness helpers for the local server child. Pure Node,
 * no Electron import, so they are unit tested directly.
 */

import http from "node:http";
import { LAUNCH_ID_HEADER, LAUNCH_TOKEN_HEADER, LOOPBACK_HOST } from "./config";

/**
 * Variables the server may inherit. Everything else — NODE_OPTIONS,
 * ELECTRON_RUN_AS_NODE, proxy settings, provider keys, a developer's .env
 * exports — stays out of the child. The desktop server makes no outbound
 * network calls; optional AI will run in the privileged process (D3).
 */
const INHERITED = [
  // Windows runtime essentials (crypto, temp paths, home directory).
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  // POSIX equivalents.
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
];

export function serverEnvironment(source: Readonly<Record<string, string | undefined>>, port: number | null = null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) env[name] = value;
  }
  env.NODE_ENV = "production";
  env.NEXT_TELEMETRY_DISABLED = "1";
  // The entry script forces the listener onto 127.0.0.1 and the requested port
  // (an OS-assigned one when none was requested) regardless; these keep
  // server.js's own defaults and messages consistent with it.
  env.HOSTNAME = LOOPBACK_HOST;
  env.PORT = String(port ?? 0);
  return env;
}

export type ProbeResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** One readiness request: the page must answer 200 *and* carry this launch's
 * identity, proving the listener at `port` is the child we started. */
export function probeOnce(port: number, token: string, launchId: string, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: LOOPBACK_HOST,
        port,
        path: "/login",
        headers: { [LAUNCH_TOKEN_HEADER]: token, "accept-encoding": "identity" },
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        const identity = response.headers[LAUNCH_ID_HEADER];
        if (identity !== launchId) {
          resolve({ ok: false, reason: "a process without this launch's identity answered" });
        } else if (response.statusCode !== 200) {
          resolve({ ok: false, reason: `the login page returned status ${response.statusCode}` });
        } else {
          resolve({ ok: true });
        }
      }
    );
    request.on("timeout", () => request.destroy(new Error("probe timed out")));
    request.on("error", (error) => resolve({ ok: false, reason: error.message }));
  });
}

/** Retry `probeOnce` until it succeeds or the deadline passes. */
export async function waitForReady(
  port: number,
  token: string,
  launchId: string,
  deadline: number,
  isCancelled: () => boolean
): Promise<ProbeResult> {
  let last: ProbeResult = { ok: false, reason: "not probed" };
  while (Date.now() < deadline && !isCancelled()) {
    last = await probeOnce(port, token, launchId, Math.max(250, Math.min(5_000, deadline - Date.now())));
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return last.ok ? last : { ok: false, reason: isCancelled() ? "startup was cancelled" : `timed out (${last.reason})` };
}

/** Bounded tail of the child's output for the failure screen and log. */
export class OutputTail {
  private lines: string[] = [];
  private partial = "";
  constructor(private readonly max = 40) {}
  push(chunk: string): string[] {
    const text = this.partial + chunk;
    const parts = text.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    const complete = parts.filter((line) => line.length > 0).map((line) => line.slice(0, 2_000));
    this.lines.push(...complete);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    return complete;
  }
  text(): string {
    return [...this.lines, this.partial].filter(Boolean).join("\n");
  }
}
