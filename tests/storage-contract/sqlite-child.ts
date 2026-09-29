/**
 * Child process for the SQLite crash, lock and cross-process tests. It is run
 * as `node --import tsx sqlite-child.ts <command> <dataDir> ...` by
 * `sqlite-harness.ts`, so it exercises the store the way the Electron main
 * process would: a separate OS process with its own connection.
 *
 * Progress is reported with synchronous writes to fd 1 so the parent sees a
 * marker at exactly the moment the child reached it, even if it is killed
 * immediately afterwards. This file is not a test (vitest collects only
 * `*.test.ts`).
 */

import { writeSync } from "node:fs";
import { expect as unwrap } from "@/lib/platform/contracts";
import { openSqliteWorkspaceStore, type SqliteStoreHooks } from "../../desktop/storage";

const [command, dataDir, ...args] = process.argv.slice(2);

function say(line: string): void {
  writeSync(1, `${line}\n`);
}

/** Block this thread; the parent kills the process while it is blocked. */
function hang(): never {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 60_000);
  throw new Error("child was not killed");
}

async function open(hooks?: SqliteStoreHooks) {
  return unwrap(await openSqliteWorkspaceStore({ dataDir, hooks, busyTimeoutMs: 20_000 }));
}

async function main(): Promise<void> {
  switch (command) {
    case "stream-inserts": {
      // Endless stream of multi-row batches; each acknowledged batch is reported.
      const perBatch = Number(args[0] ?? 25);
      const store = await open();
      unwrap(await store.insert("projects", [{ id: "p1", name: "Crash test" }]));
      say("READY");
      for (let batch = 1; ; batch += 1) {
        const rows = Array.from({ length: perBatch }, (_, index) => ({
          id: `b${batch}-${index}`,
          project_id: "p1",
          name: `batch-${batch}`,
          sort_order: index,
        }));
        unwrap(await store.insert("layers", rows));
        say(`ACK ${batch}`);
      }
    }
    case "block-before-commit": {
      // One multi-row transaction that is parked immediately before COMMIT.
      const rowCount = Number(args[0] ?? 500);
      let armed = false;
      const store = await open({
        beforeCommit(operation) {
          if (!armed || operation !== "insert") return;
          say("IN_TX");
          hang();
        },
      });
      unwrap(await store.insert("projects", [{ id: "p1", name: "Crash test" }]));
      say("READY");
      armed = true; // only the batch below is parked; the project above committed
      const rows = Array.from({ length: rowCount }, (_, index) => ({
        id: `never-${index}`,
        project_id: "p1",
        name: "uncommitted",
      }));
      await store.insert("layers", rows);
      say("UNEXPECTED-COMMIT");
      return;
    }
    case "block-after-stage":
    case "block-after-publish": {
      const store = await open({
        afterStage() {
          if (command === "block-after-stage") {
            say("STAGED");
            hang();
          }
        },
        afterPublish() {
          say("PUBLISHED");
          hang();
        },
      });
      say("READY");
      await store.uploadFile("p1/plans/e101.pdf", new Blob([new Uint8Array([37, 80, 68, 70, 45])]));
      say("UNEXPECTED-COMMIT");
      return;
    }
    case "hold-lock": {
      const store = await open();
      const lease =
        args[0] === "maintenance"
          ? null
          : unwrap(store.acquireEditingLease());
      if (args[0] === "maintenance") {
        void store.withExclusiveWorkspace(async () => {
          say("HELD");
          await new Promise(() => undefined);
        });
      } else {
        say("HELD");
      }
      // Keep the process alive until it is killed or its stdin closes.
      process.stdin.resume();
      process.stdin.on("end", () => {
        lease?.release();
        void store.close().then(() => process.exit(0));
      });
      return;
    }
    case "insert-snapshots": {
      // Concurrent revision allocation from a second OS process.
      const [projectId, count, tag] = args;
      const store = await open();
      say("READY");
      for (let index = 0; index < Number(count); index += 1) {
        unwrap(
          await store.insert("bid_snapshots", [
            { project_id: projectId, label: `${tag}-${index}`, bid_price: index, payload: { schema_version: 2 } },
          ])
        );
      }
      say("DONE");
      await store.close();
      return;
    }
    case "write-many": {
      // A second concurrent writer; every write must be acknowledged, none lost.
      const [count, tag] = args;
      const store = await open();
      say("READY");
      for (let index = 0; index < Number(count); index += 1) {
        unwrap(await store.insert("items", [{ id: `${tag}-${index}`, description: `${tag} ${index}` }]));
      }
      say("DONE");
      await store.close();
      return;
    }
    default:
      throw new Error(`unknown command ${command}`);
  }
}

main().catch((error: unknown) => {
  writeSync(2, `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
