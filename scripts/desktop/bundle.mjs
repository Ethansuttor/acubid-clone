// Bundle the desktop shell's TypeScript sources with esbuild.
//
//   app/main.js           main process (Node, CommonJS, `electron` external)
//   app/preload.js        C1 workspace bridge (sandboxed preload: one file,
//                         may require nothing but `electron`)
//   app/shell-preload.js  status-page preload (same constraints)
//   app/shell/*           status page (browser script + static html/css)
//   server/voltline-server-entry.js  utility-process entry next to server.js
//
// Portable Node; no shell syntax. Used by stage.mjs.

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const ELECTRON_TARGET = "node24";
// Electron 44's Chromium; syntax level only, no polyfills are injected.
const RENDERER_TARGET = "chrome140";

/** A sandboxed preload can only require these; anything else fails at runtime. */
const SANDBOX_REQUIRES = new Set(["electron"]);

function assertSandboxSafe(file) {
  const text = fs.readFileSync(file, "utf8");
  const requires = [...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  const illegal = requires.filter((name) => !SANDBOX_REQUIRES.has(name));
  if (illegal.length > 0) {
    throw new Error(`${path.basename(file)} requires ${illegal.join(", ")}; a sandboxed preload may only require electron.`);
  }
}

export async function bundleDesktop({ root, appOut, serverOut, version }) {
  const desktop = path.join(root, "desktop");
  const common = {
    bundle: true,
    logLevel: "warning",
    legalComments: "none",
    sourcemap: false,
    minify: false,
    absWorkingDir: root,
  };

  await build({
    ...common,
    entryPoints: [path.join(desktop, "main", "index.ts")],
    outfile: path.join(appOut, "main.js"),
    platform: "node",
    format: "cjs",
    target: ELECTRON_TARGET,
    external: ["electron"],
  });

  for (const [entry, outfile] of [
    [path.join(desktop, "preload", "bridge.ts"), path.join(appOut, "preload.js")],
    [path.join(desktop, "preload", "shell.ts"), path.join(appOut, "shell-preload.js")],
  ]) {
    await build({
      ...common,
      entryPoints: [entry],
      outfile,
      platform: "node",
      format: "cjs",
      target: RENDERER_TARGET,
      external: ["electron"],
    });
    assertSandboxSafe(outfile);
  }

  const shellOut = path.join(appOut, "shell");
  fs.mkdirSync(shellOut, { recursive: true });
  await build({
    ...common,
    entryPoints: [path.join(desktop, "shell", "status.ts")],
    outfile: path.join(shellOut, "status.js"),
    platform: "browser",
    format: "iife",
    target: RENDERER_TARGET,
  });
  for (const file of ["status.html", "status.css"]) {
    fs.copyFileSync(path.join(desktop, "shell", file), path.join(shellOut, file));
  }

  await build({
    ...common,
    entryPoints: [path.join(desktop, "server-entry", "entry.ts")],
    outfile: path.join(serverOut, "voltline-server-entry.js"),
    platform: "node",
    format: "cjs",
    target: ELECTRON_TARGET,
  });

  fs.writeFileSync(
    path.join(appOut, "package.json"),
    `${JSON.stringify(
      {
        name: "voltline-desktop",
        productName: "Voltline",
        version,
        private: true,
        description: "Voltline electrical estimating and takeoff",
        main: "main.js",
      },
      null,
      2
    )}\n`
  );
}
