/**
 * Local diagnostic log: <data dir>/logs/voltline-desktop.log, rotated at
 * 1 MB with one previous generation kept. Lifecycle events and the server's
 * console output only — never IPC payloads, plan contents, or credentials.
 */

import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 1024 * 1024;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  readonly file: string | null;
}

export function createLogger(dataDir: string | null): Logger {
  let file: string | null = null;
  if (dataDir) {
    try {
      const dir = path.join(dataDir, "logs");
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, "voltline-desktop.log");
    } catch {
      file = null;
    }
  }
  const write = (level: string, message: string) => {
    const line = `${new Date().toISOString()} ${level} ${message.replace(/\s+$/, "")}\n`;
    if (level === "ERROR") process.stderr.write(line);
    else process.stdout.write(line);
    if (!file) return;
    try {
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size + line.length > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line);
    } catch {
      // Logging must never take the app down.
    }
  };
  return {
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message) => write("ERROR", message),
    get file() {
      return file;
    },
  };
}
