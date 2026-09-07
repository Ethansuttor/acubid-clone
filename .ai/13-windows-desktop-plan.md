# Windows desktop implementation packet — track D

Updated September 7, 2026. Status: planned; no Electron code exists in the
reviewed baseline. Start with [parallel coordination](18-parallel-execution-plan.md).
The old static-export-first GD queue is superseded.

## Architectural choice

Retain React, Next.js, PDF.js, the worker, and the pure estimating functions.
For the first installer, bundle a Next.js standalone production server and
launch it from Electron. This minimizes simultaneous changes to routing,
storage, and rendering. Static export is a possible later simplification,
not a prerequisite or a one-line configuration change.

The current project route is dynamic (/project/[id]); the API routes accept
POST requests. Local project IDs are created after build time. Merely adding
"use client" cannot make those unknown IDs statically exportable.

Read the installed guides before implementing:
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
- node_modules/next/dist/docs/01-app/02-guides/static-exports.md

The standalone guide documents the traced server and separate static/public
assets. The packager must include the required assets, including PDF and
detector workers. Verify the installed Electron version's process-launch and
packaging APIs rather than copying version-specific commands from this plan.

## D1 — Reproducible standalone payload

Dependencies: C0, C1 contracts; storage is not required.
Own: scripts/desktop/** and build staging code.
Request root script/config/lockfile edits from the integration agent.

1. Add a desktop-specific standalone build mode while keeping the ordinary
   browser build available. Use portable Node scripts, not POSIX-only inline
   environment assignments in npm commands.
2. Stage only production server files, traced dependencies, static assets,
   and public assets when present. Do not bundle .env files, .git, user PDFs,
   test outputs, recovery folders, or development caches.
3. Choose a supported bundled Node execution mechanism (for example an
   Electron utility process if the chosen runtime supports the server).
   Prove it against the production payload; do not depend on node.exe from
   PATH or assume process.execPath behaves as plain Node.
4. Add a readiness handshake and bounded startup timeout. Derive paths from
   packaged resource locations, never the working directory.
5. Document payload locations, runtime versions, and scripts actually added.

Acceptance: launch staged production assets from a different working directory
with no external Node executable required. Open /login, a newly created
project, and a PDF; confirm both worker assets load. Offline startup must
succeed. AI network calls are optional and separately tested.

## D2 — Electron lifecycle and persistent identity

Dependencies: D1. Own: desktop main/preload/lifecycle, e2e-desktop/**.

- Use contextIsolation=true, nodeIntegration=false, sandbox=true. Expose
  only the C1 versioned bridge; validate IPC sender, frame, payload,
  operation, and size at the privileged boundary. A TypeScript type is not
  input validation. Restrict navigation and new windows to expected content.
- Bind the local server to loopback. Select and document a stable origin and
  persistent Electron session/userData location for the IndexedDB preview.
  A changing port changes the origin and can make existing data appear lost.
- On an occupied chosen port, fail visibly or use a documented stable-origin
  proxy; never load an arbitrary existing server or silently change the
  persistence origin. A readiness signal must identify this launch's child.
- Start one app instance per data directory. A second launch focuses the
  current window. Bring privileged maintenance under the same storage lock.
- Wait for server readiness before opening the workspace. Surface startup
  and unexpected child-exit errors; clean up only this app's child processes.
- On close, wait for pending local commits. Offer retry/cancel when saving
  fails; any explicit force-close must say unsaved edits may be lost.
  Do not wait indefinitely for cloud sync or optional backup replication.
- Use isolated user-data roots for tests; never launch a crash test against
  the estimator's real profile.

Acceptance: packaged lifecycle tests cover launch, new project, PDF upload,
count, save, close/reopen, forced termination after acknowledgement, second
launch, port collision, server crash, and launch from a path containing spaces.
A graceful close alone is not a crash-recovery test.

D2 may use IndexedDB as an explicitly limited preview. It does not establish
SQLite durability or migrate browser data automatically.

## D3 — AI transport and credential custody

Dependencies: C1 AI contract and D2 bridge.
Coordinate pipeline/API service edits with the integration agent and V.
Own: desktop AI service, key custody, settings component, dedicated tests.

Current production routes always return 401. Do not remove their production
authorization guard to make desktop AI appear to work. Prefer invoking a
desktop-only privileged service over the bounded preload bridge; leave web
production requests closed until a separate authenticated web design exists.

1. Extract reusable service validation from the routes without importing
   server/provider code into any client bundle. Inspect pipeline.ts and
   SheetAnalysis.tsx: AutoCount.tsx is now largely the review wrapper, so old
   prompts directing every fetch change there are stale.
2. Implement identical bounded verification behavior: currently at most 48
   ambiguous crops per run, 12 per request, maximum 256x256 crops, and a
   2 MB verification request. Retain existing server/body bounds and tests.
3. Preserve pending status, explicit human acceptance, cancellation, and
   unresolved results on missing/malformed/failed AI decisions. Negative
   model decisions must not silently remove local candidates.
4. Store a user-supplied key through supported OS-backed encryption in the
   privileged process. If encryption is unavailable, report the condition;
   do not silently persist plaintext. Provide set/clear/status operations,
   not a key-read IPC endpoint. A typed key necessarily passes through the
   input briefly; clear it after submission and exclude it from logs,
   telemetry, backups, and renderer persistence.
5. Share cancellation and error semantics with the browser transport. Check
   configured model availability only when live integration is authorized;
   do not invent newer model names or hardcode budget assumptions.

Acceptance: malformed IPC, wrong sender, missing key, invalid response,
provider error, cancellation, and request bounds covered without paid calls.
Local symbol search issues zero API calls. Key retrieval is absent from the
renderer interface and built client assets contain no provider secret.
A live run, if authorized and configured, is reported separately from mocks.

## D4 — Installer and release candidate

Dependencies: D2, I1 storage integration, I2 AI integration (or AI explicitly
disabled in this candidate), A4 acceptance for a replacement-readiness claim.

Use one packaging tool; electron-builder/NSIS is the default proposal, subject
to compatible-version verification. Do not add a second packaging stack.
Rebuild SQLite native modules for Electron if the selected driver needs it,
and test the packaged binary, not only the system-Node test runner.

Include the bundled server/runtime, preload, SQLite runtime, and assets.
Keep mutable data outside the installation directory. An ordinary update or
uninstall must preserve user data unless the user explicitly chooses removal.
Record installer path, size, app version, architecture, signing status, and
hash. Build local artifacts without publishing them.

Test installation using a standard Windows account or clean VM with no
development toolchain. Exercise offline startup, import, edit, restart,
backup/restore, and upgrade from the previous candidate. Verify that schema
migration makes a recovery checkpoint and failures preserve the old data.
A development preview's browser/IndexedDB data migration remains available.

Automatic updates are deferred until install/upgrade recovery works. Future
updates must never force a restart during estimating and must finish local
commits before applying. Network sync backlog alone must not make a desktop
application impossible to quit or update safely.

## Handoff and evidence

Follow the master report template. Include a packaged smoke-test result,
startup failure behavior, origin/session choices, key-custody checks, and any
remaining user-data migration limitation. Do not report "Windows ready" from
an Electron window screenshot alone.

References checked September 7, 2026:
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron utility processes](https://www.electronjs.org/docs/latest/api/utility-process)
- [Persistent sessions](https://www.electronjs.org/docs/latest/api/session)
- [Packaging and distribution](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)

These references support platform behavior; the D1–D4 sequence is this
repository's implementation recommendation, not a framework requirement.
