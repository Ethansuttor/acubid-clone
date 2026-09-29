// Launch helpers for the packaged-desktop suite. Everything here drives the
// staged app (out/desktop/Voltline by default) exactly as a user would start
// it: the app's own bundled runtime, a chosen data directory, any working
// directory. Nothing imports application code.

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const APP_ORIGIN = "voltline://app";
export const SHELL_ORIGIN = "voltline://shell";

export const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
export const noSandboxRequested = process.env.VOLTLINE_E2E_NO_SANDBOX === "1";
/** True when the OS sandbox is really in force for renderers under test. */
export const osSandboxExpected = !noSandboxRequested;

export interface Snapshot {
  appOrigin: string;
  dataDir: string;
  serverDir: string;
  appDir: string;
  logFile: string | null;
  serverState: string;
  server: { pid: number | undefined; port: number; launchId: string } | null;
  lastServerExit: { code: number; at: string } | null;
  startupError: { kind: string; message: string } | null;
  closeGuard: string | null;
  secondInstanceCount: number;
  blockedRequests: number;
  refusedBridgeCalls: number;
  workspaceWebContentsId: number | null;
  statusWebContentsId: number | null;
  noticeWebContentsId: number | null;
}

export interface StagedApp {
  /** Directory holding the runtime executable and resources/. */
  readonly dir: string;
  readonly executable: string;
}

/** The staged app under test. Override with VOLTLINE_DESKTOP_APP. */
export function stagedApp(): StagedApp {
  const dir = path.resolve(process.env.VOLTLINE_DESKTOP_APP ?? path.join(REPO_ROOT, "out", "desktop", "Voltline"));
  const executable = path.join(dir, process.platform === "win32" ? "Voltline.exe" : "voltline");
  if (!fs.existsSync(executable) || !fs.existsSync(path.join(dir, "resources", "app", "main.js"))) {
    throw new Error(`No staged Voltline at ${dir}. Run \`npm run desktop:build\` first.`);
  }
  return { dir, executable };
}

/** A fresh, empty data directory. Never the estimator's real profile. */
export function makeDataDir(label = "data"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `voltline-e2e-${label}-`));
}

export function removeDir(dir: string): void {
  if (process.env.VOLTLINE_E2E_KEEP === "1") return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

export interface LaunchOptions {
  readonly dataDir: string;
  readonly app?: StagedApp;
  /** Extra Voltline/Chromium switches. */
  readonly args?: readonly string[];
  /** Working directory for the launched process; default: a directory that is not the repo. */
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly startupTimeoutMs?: number;
  /** Do not wait for the workspace window (used by failure-path tests). */
  readonly waitForWorkspace?: boolean;
}

export class LaunchedApp {
  /** Captured at launch: Playwright drops its handle once the app has exited. */
  readonly child: ChildProcess;

  constructor(
    readonly electron: ElectronApplication,
    readonly dataDir: string,
    readonly app: StagedApp
  ) {
    this.child = electron.process();
  }

  get pid(): number {
    const pid = this.child.pid;
    if (!pid) throw new Error("The Electron process has no pid.");
    return pid;
  }

  snapshot(): Promise<Snapshot> {
    return this.electron.evaluate(() => {
      const hook = (globalThis as unknown as { __voltlineDesktop?: { snapshot(): unknown } }).__voltlineDesktop;
      if (!hook) throw new Error("Voltline's diagnostics hook is missing.");
      return hook.snapshot();
    }) as Promise<Snapshot>;
  }

  /** The first window at the given origin, waiting for it to appear. */
  async windowAt(origin: string, timeoutMs = 60_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.electron.windows().find((page) => !page.isClosed() && page.url().startsWith(`${origin}/`));
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No window at ${origin} within ${timeoutMs} ms. Windows: ${this.electron.windows().map((p) => p.url()).join(", ") || "none"}`);
  }

  workspace(timeoutMs?: number): Promise<Page> {
    return this.windowAt(APP_ORIGIN, timeoutMs);
  }

  shell(timeoutMs?: number): Promise<Page> {
    return this.windowAt(SHELL_ORIGIN, timeoutMs);
  }

  /** Graceful quit through the app itself. Resolves when the process is gone. */
  async quit(timeoutMs = 30_000): Promise<void> {
    const exited = this.waitForExit(timeoutMs);
    await this.electron.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exited;
  }

  /** Abrupt termination: no beforeunload, no will-quit, no cleanup. */
  async kill(): Promise<void> {
    const exited = this.waitForExit(30_000);
    process.kill(this.pid, "SIGKILL");
    await exited;
  }

  waitForExit(timeoutMs = 30_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Voltline did not exit within ${timeoutMs} ms.`)), timeoutMs);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
  }

  /** Best-effort teardown for tests that may have left the app running. */
  async dispose(): Promise<void> {
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      await this.electron.close();
    } catch {
      try {
        process.kill(this.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

function launchEnvironment(extra: Record<string, string | undefined> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[name] = value;
  }
  // The app under test must behave as on an offline machine and must not pick
  // up developer settings.
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"]) {
    delete env[name];
  }
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

export async function launchVoltline(options: LaunchOptions): Promise<LaunchedApp> {
  const app = options.app ?? stagedApp();
  if (isRoot && !noSandboxRequested) {
    throw new Error(
      "Chromium will not run as root with its sandbox. Run this suite as an ordinary user, " +
        "or set VOLTLINE_E2E_NO_SANDBOX=1 to run with --no-sandbox (the OS sandbox is then NOT verified)."
    );
  }
  const args = [
    ...(noSandboxRequested ? ["--no-sandbox"] : []),
    `--voltline-data-dir=${options.dataDir}`,
    ...(options.startupTimeoutMs ? [`--voltline-startup-timeout-ms=${options.startupTimeoutMs}`] : []),
    ...(options.args ?? []),
  ];
  const electronApp = await electron.launch({
    executablePath: app.executable,
    args,
    cwd: options.cwd ?? os.tmpdir(),
    env: launchEnvironment(options.env),
    timeout: 60_000,
  });
  const launched = new LaunchedApp(electronApp, options.dataDir, app);
  if (options.waitForWorkspace !== false) {
    try {
      await launched.workspace(options.startupTimeoutMs ? options.startupTimeoutMs + 30_000 : 90_000);
    } catch (error) {
      await launched.dispose();
      throw error;
    }
  }
  return launched;
}

/** Run a second copy of the app (not under Playwright control). */
export function spawnPlain(app: StagedApp, args: readonly string[], cwd: string = os.tmpdir()): ChildProcess {
  return spawn(app.executable, [...(noSandboxRequested ? ["--no-sandbox"] : []), ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: launchEnvironment(undefined) as NodeJS.ProcessEnv,
  });
}

/** Wait until pending local persistence writes settle (same signal the web E2E uses). */
export async function waitSaved(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ws = (window as unknown as { __ws?: { getState(): { pendingWrites: number } } }).__ws;
    return !!ws && ws.getState().pendingWrites === 0;
  });
}

export async function expectNoUnsavedWork(page: Page): Promise<void> {
  await waitSaved(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __ws: { getState(): { saveState: string } } }).__ws.getState().saveState))
    .not.toBe("error");
}
