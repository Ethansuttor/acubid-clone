#!/usr/bin/env node
// Launch the staged desktop app (out/desktop/Voltline) for a manual check.
//
//   node scripts/desktop/run.mjs [-- <app switches>]
//   node scripts/desktop/run.mjs --voltline-data-dir=/absolute/scratch/dir
//
// Everything after the script name is passed to Voltline unchanged. Without
// --voltline-data-dir the app uses the per-user default data folder, i.e. the
// same workspace an installed Voltline would use; pass a scratch folder for
// experiments. Uses the Electron runtime staged next to the payload, never a
// `node` or `electron` from PATH.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stage = process.env.VOLTLINE_DESKTOP_APP
  ? path.resolve(process.env.VOLTLINE_DESKTOP_APP)
  : path.join(root, "out", "desktop", "Voltline");
const executable = path.join(stage, process.platform === "win32" ? "Voltline.exe" : "voltline");

if (!fs.existsSync(executable)) {
  console.error(`No staged desktop app at ${executable}. Run \`npm run desktop:build\` first.`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const child = spawn(executable, args, { stdio: "inherit", windowsHide: false });
child.on("error", (error) => {
  console.error(`Could not start ${executable}: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
