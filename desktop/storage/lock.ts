/**
 * Cross-process workspace lock.
 *
 * The lock is a small, otherwise unused SQLite database next to the workspace
 * (`workspace.lock`). Holding it means holding an open `BEGIN EXCLUSIVE`
 * transaction on that file, which SQLite implements with OS file locks
 * (POSIX advisory locks on Linux/macOS, LockFileEx on Windows). Two
 * properties follow, and both are tested:
 *
 * - Another process, or another connection in the same process, gets
 *   SQLITE_BUSY immediately (busy timeout 0) and is told `occupied`.
 * - When the holder exits or is killed, the operating system drops the lock.
 *   There is no stale lock file to clean up and no PID guessing.
 *
 * Like SQLite itself, this requires a local file system. A network or cloud
 * sync folder is not a supported workspace location.
 */

import { DatabaseSync } from "node:sqlite";
import { isBusy } from "./errors";

export class WorkspaceLockFile {
  private db: DatabaseSync | null = null;
  private held = false;

  constructor(private readonly file: string) {}

  /** True when the lock was acquired; false when someone else holds it. */
  tryAcquire(): boolean {
    if (this.held) return false;
    this.db ??= new DatabaseSync(this.file, { timeout: 0 });
    try {
      this.db.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      if (isBusy(error)) return false;
      throw error;
    }
    this.held = true;
    return true;
  }

  release(): void {
    if (!this.held || !this.db) return;
    this.held = false;
    if (this.db.isTransaction) this.db.exec("ROLLBACK");
  }

  get isHeld(): boolean {
    return this.held;
  }

  close(): void {
    this.release();
    this.db?.close();
    this.db = null;
  }
}
