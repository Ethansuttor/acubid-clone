/**
 * Translate SQLite, file-system and validation failures into the C1 error
 * codes. Messages are shown to the estimator, so they never include a file
 * path, a SQL statement, or drawing content.
 */

import { fail, type PlatformErrorCode, type PlatformResult } from "../../src/lib/platform/contracts";
import { StorageValidationError } from "./codec";

/** A failure the store raises itself with a known code and a safe message. */
export class StoreError extends Error {
  constructor(
    readonly code: PlatformErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StoreError";
  }
}

interface SqliteLikeError {
  code?: unknown;
  errcode?: unknown;
  errstr?: unknown;
  message?: unknown;
}

// SQLite result codes (https://www.sqlite.org/rescode.html).
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_NOMEM = 7;
const SQLITE_READONLY = 8;
const SQLITE_IOERR = 10;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;
const SQLITE_CONSTRAINT = 19;
const SQLITE_NOTADB = 26;
const CONSTRAINT_FOREIGNKEY = 787;
const CONSTRAINT_PRIMARYKEY = 1555;
const CONSTRAINT_UNIQUE = 2067;
const CONSTRAINT_TRIGGER = 1811;

const TRIGGER_FAILURES: Record<string, { code: PlatformErrorCode; message: string }> = {
  "voltline:snapshot-frozen": {
    code: "conflict",
    message: "Issued bid revisions are frozen and cannot be changed.",
  },
  "voltline:plan-file-in-use": {
    code: "conflict",
    message: "This plan file is still used by a document and was not removed.",
  },
  "voltline:plan-file-immutable": {
    code: "conflict",
    message: "A different plan file is already stored under this name.",
  },
  "voltline:missing-plan-file": {
    code: "invalid-input",
    message: "The plan file for this document has not been stored. Nothing was saved.",
  },
};

export function isSqliteError(error: unknown): error is SqliteLikeError & Error {
  return (
    error instanceof Error &&
    (error as SqliteLikeError).code === "ERR_SQLITE_ERROR" &&
    typeof (error as SqliteLikeError).errcode === "number"
  );
}

export function isBusy(error: unknown): boolean {
  if (!isSqliteError(error)) return false;
  const primary = (error.errcode as number) & 0xff;
  return primary === SQLITE_BUSY || primary === SQLITE_LOCKED;
}

function sqliteFailure(error: SqliteLikeError & Error): { code: PlatformErrorCode; message: string } {
  const errcode = error.errcode as number;
  const primary = errcode & 0xff;
  const text = String(error.message ?? "");
  if (primary === SQLITE_CONSTRAINT) {
    if (errcode === CONSTRAINT_TRIGGER) {
      const token = Object.keys(TRIGGER_FAILURES).find((key) => text.includes(key));
      if (token) return TRIGGER_FAILURES[token];
    }
    if (errcode === CONSTRAINT_PRIMARYKEY || errcode === CONSTRAINT_UNIQUE) {
      if (text.includes("bid_snapshots.revision")) {
        return {
          code: "conflict",
          message: "That bid revision number already exists for this project. Nothing was saved.",
        };
      }
      if (text.includes("sheets.page_number")) {
        return { code: "conflict", message: "That document already has a sheet for this page." };
      }
      return { code: "conflict", message: "That record already exists." };
    }
    if (errcode === CONSTRAINT_FOREIGNKEY) {
      return {
        code: "invalid-input",
        message: "This change refers to a record that does not exist. Nothing was saved.",
      };
    }
    return { code: "invalid-input", message: "This change failed a data check. Nothing was saved." };
  }
  if (primary === SQLITE_BUSY || primary === SQLITE_LOCKED) {
    return {
      code: "occupied",
      message: "Another Voltline process is using the workspace. This change was not saved.",
    };
  }
  if (primary === SQLITE_FULL) {
    return { code: "io-failed", message: "The disk is full. This change was not saved." };
  }
  if (primary === SQLITE_READONLY) {
    return { code: "io-failed", message: "The workspace is read-only. This change was not saved." };
  }
  if (primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB) {
    return { code: "integrity", message: "The workspace database is damaged." };
  }
  if (primary === SQLITE_IOERR || primary === SQLITE_CANTOPEN || primary === SQLITE_NOMEM) {
    return { code: "io-failed", message: "The workspace database could not be written or read." };
  }
  return { code: "io-failed", message: "The workspace database reported an error." };
}

const FS_MESSAGES: Record<string, string> = {
  ENOSPC: "The disk is full.",
  EDQUOT: "The disk quota is exhausted.",
  EROFS: "The workspace folder is read-only.",
  EACCES: "Voltline does not have permission to use the workspace folder.",
  EPERM: "Voltline does not have permission to use the workspace folder.",
  EBUSY: "A workspace file is in use by another program.",
  EMFILE: "Too many files are open.",
  EIO: "The disk reported a read or write error.",
};

function isAbort(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function describeFailure(
  error: unknown,
  fallback: string
): { code: PlatformErrorCode; message: string } {
  if (isAbort(error)) return { code: "aborted", message: "The operation was cancelled." };
  if (error instanceof StoreError) return { code: error.code, message: error.message };
  if (error instanceof StorageValidationError) return { code: "invalid-input", message: error.message };
  if (isSqliteError(error)) return sqliteFailure(error);
  const fsCode = (error as { code?: unknown } | null)?.code;
  if (typeof fsCode === "string" && FS_MESSAGES[fsCode]) {
    return { code: "io-failed", message: `${fallback} ${FS_MESSAGES[fsCode]}` };
  }
  return { code: "io-failed", message: fallback };
}

export function storageFailure(error: unknown, fallback: string): PlatformResult<never> {
  const { code, message } = describeFailure(error, fallback);
  return fail(code, message);
}
