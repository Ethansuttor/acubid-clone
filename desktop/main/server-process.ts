/**
 * D1 runtime: run the standalone Next.js server inside Electron's own bundled
 * Node (an Electron utility process). No `node` from PATH, no working
 * directory assumptions: every path derives from the server payload location.
 *
 * Readiness handshake, per launch:
 *   1. main generates a random launch id and a secret request token;
 *   2. it forks this payload's entry script and sends both over the child's
 *      private parent port (never argv or environment);
 *   3. the entry script binds 127.0.0.1 on an OS-assigned port (or the one
 *      explicitly requested; a busy requested port fails the launch), requires the
 *      token on every request, stamps every response with the launch id, and
 *      reports {launchId, port} back over the parent port;
 *   4. main probes /login with the token and accepts only a 200 that carries
 *      the same launch id. Anything else — an early exit, a foreign listener,
 *      or the startup deadline passing — fails visibly and kills the child.
 */

import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { LOOPBACK_HOST, SERVER_ENTRY_FILE, SERVER_NEXT_FILE } from "./config";
import type { Logger } from "./log";
import type { UpstreamTarget } from "./proxy";
import { OutputTail, serverEnvironment, waitForReady } from "./server-env";

export type StartupFailureKind = "payload-missing" | "spawn-failed" | "exited" | "timeout" | "handshake";

export class StartupError extends Error {
  constructor(
    readonly kind: StartupFailureKind,
    message: string,
    readonly detail: string = ""
  ) {
    super(message);
    this.name = "StartupError";
  }
}

export interface ServerExit {
  readonly code: number;
  readonly expected: boolean;
  readonly output: string;
}

export interface ServerLaunch {
  readonly target: UpstreamTarget;
  readonly pid: number | undefined;
  readonly startedAt: number;
  /** Resolves after the child has exited (or was already gone). */
  stop(): Promise<void>;
  onExit(listener: (exit: ServerExit) => void): void;
}

export interface LaunchOptions {
  readonly serverDir: string;
  readonly timeoutMs: number;
  /** Explicit loopback port, or null for an OS-assigned one. */
  readonly port: number | null;
  readonly log: Logger;
}

/** Files that must exist before we even try; a missing one is a broken install. */
export function checkPayload(serverDir: string): string[] {
  const required = [SERVER_ENTRY_FILE, SERVER_NEXT_FILE, path.join(".next", "BUILD_ID"), path.join(".next", "static")];
  return required.filter((relative) => !fs.existsSync(path.join(serverDir, relative)));
}

export async function launchServer(options: LaunchOptions): Promise<ServerLaunch> {
  const { serverDir, timeoutMs, port: requestedPort, log } = options;
  const missing = checkPayload(serverDir);
  if (missing.length > 0) {
    throw new StartupError(
      "payload-missing",
      "Voltline's application files are incomplete. Reinstall Voltline.",
      `Missing from ${serverDir}: ${missing.join(", ")}`
    );
  }

  const launchId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tail = new OutputTail();
  const deadline = Date.now() + timeoutMs;
  let child: UtilityProcess;
  try {
    child = utilityProcess.fork(path.join(serverDir, SERVER_ENTRY_FILE), [], {
      serviceName: "Voltline Local Server",
      stdio: "pipe",
      cwd: serverDir,
      env: serverEnvironment(process.env, requestedPort),
    });
  } catch (error) {
    throw new StartupError("spawn-failed", "Voltline could not start its local server.", String(error));
  }

  const record = (stream: string) => (chunk: Buffer | string) => {
    for (const line of tail.push(chunk.toString())) log.info(`[server ${stream}] ${line}`);
  };
  child.stdout?.on("data", record("out"));
  child.stderr?.on("data", record("err"));

  let exited = false;
  let exitCode = 0;
  let expectedExit = false;
  const exitListeners: ((exit: ServerExit) => void)[] = [];
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", (code) => {
      exited = true;
      exitCode = code;
      log.info(`server ${launchId} exited with code ${code}${expectedExit ? " (requested)" : ""}`);
      for (const listener of exitListeners) listener({ code, expected: expectedExit, output: tail.text() });
      resolve();
    });
  });
  child.on("error", (type, location) => log.error(`server ${launchId} fatal error ${type} at ${location}`));

  const stop = async () => {
    expectedExit = true;
    if (exited) return;
    const pid = child.pid;
    child.kill();
    const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000));
    if ((await Promise.race([exitPromise, timer])) === "timeout" && pid !== undefined && !exited) {
      // Last resort, and only for the pid this launch created.
      log.warn(`server ${launchId} did not stop; terminating pid ${pid}`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
      await Promise.race([exitPromise, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
  };

  const fail = async (error: StartupError): Promise<never> => {
    await stop();
    throw error;
  };

  // Steps 2–3: send the secrets once the child exists; wait for its report.
  const listening = new Promise<{ port: number } | StartupError>((resolve) => {
    child.once("spawn", () => {
      log.info(`server ${launchId} spawned as pid ${child.pid}`);
      child.postMessage({ type: "start", launchId, token, port: requestedPort ?? 0 });
    });
    child.on("message", (message: unknown) => {
      const report = message as { type?: unknown; launchId?: unknown; port?: unknown; address?: unknown } | null;
      if (!report || report.type !== "listening") return;
      if (report.launchId !== launchId) {
        resolve(new StartupError("handshake", "Voltline's local server did not identify itself correctly."));
        return;
      }
      const port = report.port;
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535 || report.address !== LOOPBACK_HOST) {
        resolve(
          new StartupError(
            "handshake",
            "Voltline's local server did not bind to this computer's loopback address.",
            `Reported ${String(report.address)}:${String(port)}`
          )
        );
        return;
      }
      if (requestedPort !== null && port !== requestedPort) {
        resolve(
          new StartupError(
            "handshake",
            "Voltline's local server is not on the port that was requested.",
            `Requested ${requestedPort}, reported ${port}`
          )
        );
        return;
      }
      resolve({ port });
    });
    void exitPromise.then(() =>
      resolve(
        new StartupError(
          "exited",
          `Voltline's local server stopped during startup (exit code ${exitCode}).`,
          tail.text()
        )
      )
    );
    setTimeout(
      () =>
        resolve(
          new StartupError(
            "timeout",
            `Voltline's local server did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`,
            tail.text()
          )
        ),
      Math.max(0, deadline - Date.now())
    );
  });

  const reported = await listening;
  if (reported instanceof StartupError) return fail(reported);

  // Step 4: prove the listener at that port is this launch's child.
  const probe = await waitForReady(reported.port, token, launchId, deadline, () => exited);
  if (!probe.ok) {
    if (exited) {
      return fail(
        new StartupError("exited", `Voltline's local server stopped during startup (exit code ${exitCode}).`, tail.text())
      );
    }
    return fail(
      new StartupError(
        "timeout",
        `Voltline's local server did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`,
        `${probe.reason}\n${tail.text()}`
      )
    );
  }

  log.info(`server ${launchId} ready on ${LOOPBACK_HOST}:${reported.port}`);
  return {
    target: { port: reported.port, token, launchId },
    pid: child.pid,
    startedAt: Date.now(),
    stop,
    onExit(listener) {
      if (exited) listener({ code: exitCode, expected: expectedExit, output: tail.text() });
      else exitListeners.push(listener);
    },
  };
}
