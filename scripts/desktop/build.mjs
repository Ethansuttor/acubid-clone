#!/usr/bin/env node
// Desktop build (track D1): a desktop-mode Next.js standalone build, then the
// staged payload in out/desktop/Voltline. Portable Node — no shell syntax, no
// inline environment assignments — so the same command works on Windows.
//
//   node scripts/desktop/build.mjs                 build + stage (+ Electron runtime)
//   node scripts/desktop/build.mjs --skip-next-build   re-stage the existing build
//   node scripts/desktop/build.mjs --no-runtime    stage without copying Electron
//
// The ordinary browser build (`npm run build`) never sets
// VOLTLINE_BUILD_TARGET and is unaffected. Both builds share `.next/`, so run
// this again after a browser build before starting the desktop app.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describeStage, stageDesktop } from "./stage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const known = new Set(["--skip-next-build", "--no-runtime"]);
for (const arg of args) {
  if (!known.has(arg)) {
    console.error(`Unknown option ${arg}. Known: ${[...known].join(", ")}`);
    process.exit(2);
  }
}

if (!args.has("--skip-next-build")) {
  const nextBin = createRequire(path.join(root, "package.json")).resolve("next/dist/bin/next");
  console.log("Building Next.js in desktop (standalone) mode…");
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VOLTLINE_BUILD_TARGET: "desktop", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0) {
    console.error(`next build failed (exit ${result.status ?? result.signal}).`);
    process.exit(result.status ?? 1);
  }
}

try {
  const staged = await stageDesktop({
    root,
    outDir: path.join(root, "out", "desktop"),
    withRuntime: !args.has("--no-runtime"),
  });
  console.log(describeStage(staged));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
