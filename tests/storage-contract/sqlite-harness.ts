/**
 * Shared helpers for the SQLite storage tests: disposable data directories,
 * store factories, raw read-only inspection, and child-process control for the
 * crash and cross-process tests. Every directory is created under the OS temp
 * folder and removed after the test file finishes.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll } from "vitest";
import { expect as unwrap } from "@/lib/platform/contracts";
import {
  DATABASE_FILE,
  openSqliteWorkspaceStore,
  type SqliteStoreHooks,
  type SqliteWorkspaceStore,
} from "../../desktop/storage";

const created: string[] = [];
const openStores: SqliteWorkspaceStore[] = [];

afterAll(async () => {
  for (const store of openStores.splice(0)) await store.close();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDataDir(label = "store"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `voltline-s2-${label}-`));
  created.push(dir);
  return dir;
}

export async function openStore(
  dataDir: string = tempDataDir(),
  hooks?: SqliteStoreHooks
): Promise<SqliteWorkspaceStore> {
  const store = unwrap(await openSqliteWorkspaceStore({ dataDir, hooks }));
  openStores.push(store);
  return store;
}

/** A separate read-only connection, as an outside observer of committed state. */
export function inspect<T>(dataDir: string, query: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(dataDir, DATABASE_FILE), { readOnly: true });
  try {
    return query(db);
  } finally {
    db.close();
  }
}

export function countRows(dataDir: string, table: string): number {
  return inspect(dataDir, (db) => Number(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()?.n));
}

const CHILD = path.resolve(__dirname, "sqlite-child.ts");

export interface Child {
  readonly process: ChildProcessWithoutNullStreams;
  /** Resolves with the first stdout line starting with `marker`. */
  waitFor(marker: string, timeoutMs?: number): Promise<string>;
  /** Resolves when the child exits, with its code/signal and full output. */
  exited(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>;
  kill(): Promise<void>;
}

/** Run the child script under Node + tsx, like the store would run in Electron main. */
export function startChild(args: string[]): Child {
  const child = spawn(process.execPath, ["--import", "tsx", CHILD, ...args], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  let stdout = "";
  let stderr = "";
  const waiters: { marker: string; resolve: (line: string) => void }[] = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    for (const line of stdout.split("\n")) {
      for (const waiter of [...waiters]) {
        if (line.startsWith(waiter.marker)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(line);
        }
      }
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>(
    (resolve) => child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }))
  );
  return {
    process: child,
    waitFor(marker, timeoutMs = 30_000) {
      const already = stdout.split("\n").find((line) => line.startsWith(marker));
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`child did not print ${marker} within ${timeoutMs} ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`)),
          timeoutMs
        );
        waiters.push({
          marker,
          resolve: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        });
        void exit.then(({ code, signal }) => {
          clearTimeout(timer);
          reject(new Error(`child exited (${code ?? signal}) before ${marker}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        });
      });
    },
    exited: () => exit,
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exit;
    },
  };
}
