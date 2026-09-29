// Assemble the desktop payload from a desktop-mode Next.js build.
//
// Layout (mirrors an installed app, so path rules are the same when packaged):
//
//   out/desktop/Voltline/
//     voltline | Voltline.exe, *.so/*.dll, *.pak …   Electron runtime (optional)
//     resources/
//       app/                    Electron app: main.js, preloads, status page
//       server/                 standalone Next.js server + traced node_modules
//         .next/static/         client assets, incl. PDF.js + detector workers
//         public/               icons and manifest assets
//         voltline-server-entry.js
//       payload-manifest.json   versions, sizes, per-file SHA-256
//
// Only production output is copied. The copy refuses symlinks that leave the
// build, and the finished tree is scanned for anything that must never ship
// (.env files, .git, caches, test output, PDFs outside dependencies).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bundleDesktop } from "./bundle.mjs";

/**
 * Traced packages deliberately left out. `sharp` (and its `@img/*` native
 * binaries) backs next/image optimisation, which Voltline does not use; the
 * binaries are platform-specific and would be dead native code in the
 * installer. Without it Next.js only loses /_next/image.
 */
const EXCLUDED_TRACED_PACKAGES = ["sharp", "@img"];

/** Paths (relative, forward slashes) that must never appear in the payload. */
function forbiddenReason(relative) {
  const parts = relative.split("/");
  const name = parts[parts.length - 1];
  const inDependencies = parts.includes("node_modules");
  if (parts.includes(".git")) return ".git metadata";
  if (/^\.env(\..*)?$/.test(name)) return "environment file";
  if (relative.includes(".next/cache/") || relative.endsWith(".next/cache")) return "Next.js build cache";
  if (!inDependencies && parts.some((part) => ["test-results", "playwright-report", "eval-out", "e2e", "e2e-desktop", "test-assets", "tests", "supabase", ".artifacts"].includes(part))) {
    return "test or evaluation output";
  }
  if (!inDependencies && /\.pdf$/i.test(name)) return "PDF document";
  if (/\.tsbuildinfo$/.test(name)) return "TypeScript build cache";
  return null;
}

function toPosix(relative) {
  return relative.split(path.sep).join("/");
}

/** Recursive copy that dereferences in-tree symlinks and refuses others. */
function copyTree(source, destination, { treeRoot, skip = () => false }) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const target = fs.realpathSync(source);
    const rootReal = fs.realpathSync(treeRoot);
    if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
      throw new Error(`Refusing to stage ${source}: it links outside the build (${target}).`);
    }
    copyTree(target, destination, { treeRoot, skip });
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      const from = path.join(source, entry);
      if (skip(from)) continue;
      copyTree(from, path.join(destination, entry), { treeRoot, skip });
    }
    return;
  }
  if (stat.isFile()) {
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode & 0o777);
    return;
  }
  throw new Error(`Refusing to stage ${source}: not a regular file or directory.`);
}

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else out.push({ full, relative: toPosix(path.relative(base, full)) });
  }
  return out;
}

function summarize(dir, base) {
  const files = walkFiles(dir, base);
  let bytes = 0;
  const hashes = [];
  for (const file of files) {
    const data = fs.readFileSync(file.full);
    bytes += data.length;
    hashes.push({ path: file.relative, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
  }
  hashes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const tree = createHash("sha256");
  for (const entry of hashes) tree.update(`${entry.path}\0${entry.sha256}\n`);
  return { files: hashes.length, bytes, treeSha256: tree.digest("hex"), entries: hashes };
}

function gitCommit(root) {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

function electronRuntime(root) {
  const electronDir = path.join(root, "node_modules", "electron");
  const dist = path.join(electronDir, "dist");
  const version = JSON.parse(fs.readFileSync(path.join(electronDir, "package.json"), "utf8")).version;
  let binary = null;
  try {
    binary = fs.readFileSync(path.join(electronDir, "path.txt"), "utf8").trim();
  } catch {
    binary = null;
  }
  return { dist, version, binary };
}

export async function stageDesktop({ root, outDir, withRuntime = true }) {
  const standalone = path.join(root, ".next", "standalone");
  const requiredFiles = path.join(root, ".next", "required-server-files.json");
  if (!fs.existsSync(path.join(standalone, "server.js")) || !fs.existsSync(requiredFiles)) {
    throw new Error("No standalone build found. Run `npm run desktop:build` first.");
  }
  const required = JSON.parse(fs.readFileSync(requiredFiles, "utf8"));
  if (required.config?.output !== "standalone") {
    throw new Error("The current .next build is not a desktop (standalone) build. Run `npm run desktop:build`.");
  }
  const buildId = fs.readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim();
  const standaloneBuildId = fs.readFileSync(path.join(standalone, ".next", "BUILD_ID"), "utf8").trim();
  if (buildId !== standaloneBuildId) throw new Error("The standalone output does not match the current build.");

  const outRoot = path.resolve(outDir);
  const expectedParent = path.join(root, "out", "desktop");
  if (outRoot !== expectedParent && !outRoot.startsWith(expectedParent + path.sep)) {
    throw new Error(`Refusing to write the desktop stage outside ${expectedParent}.`);
  }
  const appRoot = path.join(outRoot, "Voltline");
  fs.rmSync(appRoot, { recursive: true, force: true });
  const resources = path.join(appRoot, "resources");
  const appOut = path.join(resources, "app");
  const serverOut = path.join(resources, "server");
  fs.mkdirSync(appOut, { recursive: true });

  // 1. Standalone server and traced dependencies.
  const excluded = EXCLUDED_TRACED_PACKAGES.map((name) => path.join(standalone, "node_modules", name));
  copyTree(standalone, serverOut, {
    treeRoot: standalone,
    skip: (from) => excluded.includes(from) || /^\.env(\..*)?$/.test(path.basename(from)) || path.basename(from) === ".git",
  });
  // 2. Client assets (includes the PDF.js worker and the detector worker).
  copyTree(path.join(root, ".next", "static"), path.join(serverOut, ".next", "static"), {
    treeRoot: path.join(root, ".next", "static"),
  });
  // 3. Public assets, when present.
  const publicDir = path.join(root, "public");
  if (fs.existsSync(publicDir)) {
    copyTree(publicDir, path.join(serverOut, "public"), {
      treeRoot: publicDir,
      skip: (from) => /^\.env(\..*)?$/.test(path.basename(from)),
    });
  }

  // 4. Desktop shell bundles.
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  await bundleDesktop({ root, appOut, serverOut, version });
  const icon = path.join(publicDir, "icon-512.png");
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(appOut, "icon.png"));

  // 5. Worker assets must be present; the workspace cannot render or search without them.
  const media = fs.readdirSync(path.join(serverOut, ".next", "static", "media"));
  const chunks = fs.readdirSync(path.join(serverOut, ".next", "static", "chunks"));
  const workers = {
    pdfWorker: media.find((name) => /^pdf\.worker.*\.mjs$/.test(name)) ?? null,
    workerBootstrap: chunks.find((name) => /^turbopack-worker-.*\.js$/.test(name)) ?? null,
  };
  if (!workers.pdfWorker || !workers.workerBootstrap) {
    throw new Error(`Worker assets are missing from the payload: ${JSON.stringify(workers)}`);
  }

  // 6. Refuse anything that must not ship.
  const problems = [];
  for (const file of walkFiles(resources, resources)) {
    const reason = forbiddenReason(file.relative);
    if (reason) problems.push(`${file.relative} (${reason})`);
  }
  if (problems.length > 0) {
    throw new Error(`The desktop payload contains files that must not ship:\n  ${problems.slice(0, 20).join("\n  ")}`);
  }

  const app = summarize(appOut, appOut);
  const server = summarize(serverOut, serverOut);

  // 7. Optional runtime: a copy of the pinned Electron build, renamed, with its
  // default app removed so it can only ever load resources/app.
  const runtime = electronRuntime(root);
  let runtimeSummary = null;
  let executable = null;
  if (withRuntime) {
    if (!runtime.binary || !fs.existsSync(path.join(runtime.dist, runtime.binary))) {
      throw new Error("The Electron binary is not installed. Run `npx install-electron --no` (see .ai/08-environment.md).");
    }
    if (process.platform === "darwin") {
      throw new Error("Staging a runtime on macOS is not supported; use --no-runtime.");
    }
    for (const entry of fs.readdirSync(runtime.dist)) {
      const from = path.join(runtime.dist, entry);
      if (entry === "resources") {
        for (const inner of fs.readdirSync(from)) {
          if (inner === "default_app.asar") continue;
          copyTree(path.join(from, inner), path.join(resources, inner), { treeRoot: runtime.dist });
        }
        continue;
      }
      copyTree(from, path.join(appRoot, entry), { treeRoot: runtime.dist });
    }
    const renamed = process.platform === "win32" ? "Voltline.exe" : "voltline";
    fs.renameSync(path.join(appRoot, runtime.binary), path.join(appRoot, renamed));
    executable = renamed;
    let bytes = 0;
    let files = 0;
    for (const file of walkFiles(appRoot, appRoot)) {
      if (file.relative.startsWith("resources/")) continue;
      bytes += fs.statSync(file.full).size;
      files += 1;
    }
    runtimeSummary = { files, bytes };
  }

  const manifest = {
    format: "voltline-desktop-payload",
    version: 1,
    voltlineVersion: version,
    builtAt: new Date().toISOString(),
    source: gitCommit(root),
    nextBuildId: buildId,
    nextVersion: JSON.parse(fs.readFileSync(path.join(root, "node_modules", "next", "package.json"), "utf8")).version,
    electronVersion: runtime.version,
    platform: `${process.platform}-${process.arch}`,
    executable,
    excludedTracedPackages: EXCLUDED_TRACED_PACKAGES,
    workers,
    app: { files: app.files, bytes: app.bytes, treeSha256: app.treeSha256 },
    server: { files: server.files, bytes: server.bytes, treeSha256: server.treeSha256 },
    runtime: runtimeSummary,
    files: { app: app.entries, server: server.entries },
  };
  fs.writeFileSync(path.join(resources, "payload-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { appRoot, manifest };
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeStage({ appRoot, manifest }) {
  const lines = [
    `Staged Voltline ${manifest.voltlineVersion} at ${appRoot}`,
    `  app:     ${manifest.app.files} files, ${formatBytes(manifest.app.bytes)}`,
    `  server:  ${manifest.server.files} files, ${formatBytes(manifest.server.bytes)} (Next.js ${manifest.nextVersion}, build ${manifest.nextBuildId})`,
    manifest.runtime
      ? `  runtime: ${manifest.runtime.files} files, ${formatBytes(manifest.runtime.bytes)} (Electron ${manifest.electronVersion}, ${manifest.executable})`
      : "  runtime: not staged (--no-runtime)",
    `  workers: ${manifest.workers.pdfWorker}, ${manifest.workers.workerBootstrap}`,
  ];
  return lines.join("\n");
}
