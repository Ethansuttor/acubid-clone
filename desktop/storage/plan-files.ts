/**
 * Content-addressed plan file storage.
 *
 * Layout under the workspace data directory:
 *
 *   plans/staging/<uuid>.part          bytes being written (never referenced)
 *   plans/objects/<aa>/<sha256>        published, immutable bytes
 *
 * Order of an upload (the database reference is committed by the caller only
 * after `publish` resolves):
 *
 *   1. stage   — write to a new staging file (exclusive create), fsync, close
 *   2. verify  — re-read the staged file and compare its SHA-256 and size to
 *                the bytes that were supplied
 *   3. publish — rename into objects/, then fsync the directories (POSIX)
 *
 * A crash before 3 leaves an orphan staging file; a crash between 3 and the
 * database commit leaves an unreferenced object. Neither can produce a
 * committed reference to missing bytes. Nothing here deletes published
 * objects: garbage collection needs a reference inventory plus a grace
 * period and is deliberately not implemented.
 *
 * Logical storage paths are only database keys. They are never joined into a
 * file-system path, so a hostile path cannot escape the plans directory.
 */

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { StoreError } from "./errors";

const SHA256 = /^[0-9a-f]{64}$/;

export interface StagedFile {
  readonly stagedPath: string;
  readonly sha256: string;
  readonly size: number;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fsyncDirectory(dir: string): Promise<void> {
  // Windows cannot open a directory for flushing; NTFS journals the rename
  // metadata itself. On POSIX the directory entry must be flushed for the
  // rename to be durable before the database reference is committed.
  if (process.platform === "win32") return;
  const handle = await fs.open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class PlanFileStore {
  readonly root: string;
  readonly stagingDir: string;
  readonly objectsDir: string;

  constructor(plansRoot: string) {
    this.root = plansRoot;
    this.stagingDir = path.join(plansRoot, "staging");
    this.objectsDir = path.join(plansRoot, "objects");
  }

  async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.stagingDir, { recursive: true });
    await fs.mkdir(this.objectsDir, { recursive: true });
  }

  objectPath(sha256: string): string {
    if (!SHA256.test(sha256)) throw new StoreError("integrity", "A plan file reference is malformed.");
    return path.join(this.objectsDir, sha256.slice(0, 2), sha256);
  }

  async stage(bytes: Uint8Array): Promise<StagedFile> {
    const sha256 = sha256Hex(bytes);
    const stagedPath = path.join(this.stagingDir, `${randomUUID()}.part`);
    const handle = await fs.open(stagedPath, "wx");
    try {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
        offset += bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const written = await fs.readFile(stagedPath);
    if (written.byteLength !== bytes.byteLength || sha256Hex(written) !== sha256) {
      await fs.rm(stagedPath, { force: true });
      throw new StoreError("integrity", "The plan file could not be written intact. Nothing was saved.");
    }
    return { stagedPath, sha256, size: bytes.byteLength };
  }

  /** True when the published object exists with the expected content. */
  private async objectIsIntact(sha256: string, size: number): Promise<boolean> {
    try {
      const bytes = await fs.readFile(this.objectPath(sha256));
      return bytes.byteLength === size && sha256Hex(bytes) === sha256;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return false;
      throw error;
    }
  }

  async publish(staged: StagedFile): Promise<void> {
    const target = this.objectPath(staged.sha256);
    const shard = path.dirname(target);
    if (await this.objectIsIntact(staged.sha256, staged.size)) {
      await fs.rm(staged.stagedPath, { force: true });
      return;
    }
    await fs.mkdir(shard, { recursive: true });
    try {
      // Also repairs a damaged object with the verified staged bytes.
      await fs.rename(staged.stagedPath, target);
    } catch (error) {
      // Another process may have published the same content concurrently.
      if (await this.objectIsIntact(staged.sha256, staged.size)) {
        await fs.rm(staged.stagedPath, { force: true });
        return;
      }
      throw error;
    }
    await fsyncDirectory(shard);
    await fsyncDirectory(this.objectsDir);
  }

  /** Read and verify published bytes. Missing or altered bytes are `integrity`. */
  async read(sha256: string, size: number): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(this.objectPath(sha256));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        throw new StoreError("integrity", "A stored plan file is missing from the workspace.");
      }
      throw error;
    }
    if (bytes.byteLength !== size || sha256Hex(bytes) !== sha256) {
      throw new StoreError("integrity", "A stored plan file is damaged (checksum mismatch).");
    }
    return bytes;
  }

  async hasObject(sha256: string): Promise<boolean> {
    try {
      await fs.access(this.objectPath(sha256));
      return true;
    } catch {
      return false;
    }
  }

  /** Every published object hash on disk. */
  async listObjects(): Promise<string[]> {
    const hashes: string[] = [];
    let shards: string[] = [];
    try {
      shards = await fs.readdir(this.objectsDir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return hashes;
      throw error;
    }
    for (const shard of shards.sort()) {
      const entries = await fs.readdir(path.join(this.objectsDir, shard)).catch(() => [] as string[]);
      for (const entry of entries.sort()) if (SHA256.test(entry)) hashes.push(entry);
    }
    return hashes;
  }

  /** Staging file names (orphans left behind by an interrupted upload). */
  async listStaging(): Promise<string[]> {
    try {
      return (await fs.readdir(this.stagingDir)).sort();
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }
  }
}
