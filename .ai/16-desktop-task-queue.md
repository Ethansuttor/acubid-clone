# Windows desktop app — task queue for a fast coding model

**Written:** August 26, 2026
**Purpose:** [`13-windows-desktop-plan.md`](13-windows-desktop-plan.md) (the
Electron architecture plan), cut into small, bounded tasks a fast coding
model (Gemini Flash) can execute one at a time. The architecture decisions
are already made there — these tasks implement them, in order.
**Rule:** give the model ONE task at a time. Review every diff before
keeping it. Tasks marked **⛔ STOP GATE** must be verified by the owner (or
a stronger model) before the next task is issued.

## Preamble to paste at the top of every task

> Work only inside this repository. Read `AGENTS.md`, `.ai/00-START-HERE.md`,
> `.ai/04-invariants.md`, `.ai/13-windows-desktop-plan.md`, and the files
> named below before editing. Touch ONLY the files this task lists. Do not
> change estimate formulas, geometry, preflight, parsers, migrations, or any
> file in `src/lib/` other than those named. Do not install packages — if a
> dependency is missing, stop and report it. Run the checks named in the
> acceptance criteria and report exact results, including failures. Do not
> commit, push, or delete data.

## Owner-only steps (Gemini never does these)

- **O-1:** `npm install --save-dev electron electron-builder concurrently`
  and `npm install better-sqlite3` — before GD-3.
- **O-2:** Review at each ⛔ STOP GATE.
- **O-3:** The signing / SmartScreen decision at GD-13 (see plan 13
  § Distribution).

## Dependency order

```
GD-1 → GD-2 → GD-3 ⛔ → GD-4 ⛔ → GD-5 → GD-6 → GD-7 ⛔ → GD-8 → GD-9 → GD-10 ⛔
                                                  └→ GD-11 → GD-12
GD-13 → GD-14 ⛔        (after GD-10)
```

---

## Phase 0 — groundwork (no Electron involved yet)

### GD-1 — Runtime mode detection

**Prompt:**

> Read `src/lib/local-config.ts` and `src/lib/supabase.ts`. Add to
> `local-config.ts`: `export type Runtime = "browser" | "desktop";` and
> `export function runtime(): Runtime` returning `"desktop"` when
> `typeof window !== "undefined" && "voltline" in window`, else `"browser"`.
> Add a global type declaration file `src/types/desktop.d.ts` declaring
> `interface Window { voltline?: VoltlineBridge }` with
> `interface VoltlineBridge { version: string }` (it will grow later).
> Change no behavior anywhere. Add a unit test for `runtime()` in
> `tests/local-config.test.ts` covering both cases.

**Acceptance criteria:** no existing file changes behavior; `npm test`,
`npx tsc --noEmit`, `npm run lint` pass.

### GD-2 — Serializable query descriptors

**Prompt:**

> Read `src/lib/localdb.ts` and `tests/localdb.test.ts` to learn the exact
> query-builder surface the app uses (from/select/eq/in/order/single,
> insert/update/upsert/delete, and storage upload/download/remove). Create
> `src/lib/dbdesc.ts` containing: (1) these exact types —
> `type Filter = { op: "eq" | "in"; column: string; value: unknown }`,
> `interface QueryDescriptor { table: string; kind: "select" | "insert" |
> "update" | "upsert" | "delete"; columns?: string; filters: Filter[];
> order?: { column: string; ascending: boolean }[]; single?: boolean;
> payload?: unknown }`, and `interface StorageDescriptor { bucket: string;
> op: "upload" | "download" | "remove"; path: string; dataBase64?: string }`;
> (2) a builder `descriptorClient(exec)` that implements the SAME chainable
> interface as `localdb.ts` but, instead of touching storage, assembles a
> `QueryDescriptor` and passes it to the injected
> `exec: (d: QueryDescriptor) => Promise<{ data: unknown; error: unknown }>`.
> Mirror localdb's thenable/await semantics exactly. Write
> `tests/dbdesc.test.ts` asserting the descriptor produced by each chain
> shape (use a capturing fake `exec`). Do not modify `localdb.ts`.

**Acceptance criteria:** every builder shape used anywhere in `src/store/`
and `src/components/` produces a descriptor (grep for `.from(` /
`.storage` call sites and cover each pattern); `npm test`, typecheck, lint
pass.

### GD-3 — SQLite executor + parity suite  ⛔ STOP GATE

Owner runs **O-1** first.

**Prompt:**

> Read `src/lib/dbdesc.ts`, `src/lib/localdb.ts`,
> `supabase/migrations/0001_schema.sql`, and `0002_bid_math.sql`. Create
> `desktop/db/schema.ts` exporting a single SQL string: the migrations
> translated to SQLite (uuid/timestamptz/text → TEXT, numeric → REAL,
> boolean → INTEGER 0/1; drop RLS statements, policies, and
> `references auth.users`; KEEP every table, column, default, check
> constraint, and `on delete cascade`). Create `desktop/db/executor.ts`
> exporting `class SqliteExecutor { constructor(dbPath: string | ":memory:")
> ; exec(d: QueryDescriptor): Promise<{ data: unknown; error: unknown }>;
> execStorage(d: StorageDescriptor): Promise<{ data: unknown; error:
> unknown }> }` using `better-sqlite3`, returning the same result shapes
> localdb returns (including `single` returning an object not an array, and
> the same error behavior for missing rows). Storage writes files under
> `<dbPath dir>/plans/`. Create `tests/desktop-executor.test.ts`: port the
> table-driven cases from `tests/localdb.test.ts` to run against
> `descriptorClient(new SqliteExecutor(":memory:").exec)` — same inputs,
> same expected outputs. This parity suite is the point of the task.

**Acceptance criteria:** parity tests cover insert/upsert/update/delete,
chained eq, `in`, order asc/desc, single, cascades (deleting an item removes
its assembly_items), and storage round-trip; `npm test`, typecheck, lint
pass. **⛔ Owner reviews the schema translation line-by-line against the
SQL migrations before proceeding.**

### GD-4 — Static export build  ⛔ STOP GATE

**Prompt:**

> FIRST read the export documentation in `node_modules/next/dist/docs/`
> (start at `index.md`, then the app-router docs under `01-app/`) — this
> Next.js version has breaking changes and your training data is stale for
> it. Then: add a `build:desktop` npm script that builds with static export
> (`output: "export"` gated by env var `VOLTLINE_DESKTOP=1` in
> `next.config.ts`). Make `src/app/project/[id]/page.tsx` compatible with
> static export per those docs (client-side param handling; the page is
> already fully client-rendered). The two `/api/` routes are excluded from
> the export — do not delete them; they remain for the web build. The
> normal `npm run build` must be byte-for-byte unaffected when the env var
> is unset.

**Acceptance criteria:** `npm run build:desktop` emits `out/` containing
`index.html`; `npm run build` still succeeds unchanged; typecheck and lint
pass. Report exactly which docs files you read. **⛔ Owner serves `out/`
locally and clicks through project → takeoff → estimate → summary before
proceeding.**

---

## Phase 1 — the Electron shell

### GD-5 — Shell scaffold with enforced security flags

**Prompt:**

> Create `desktop/main.ts`, `desktop/preload.ts`, and
> `desktop/window-options.ts`. `window-options.ts` exports
> `export const WEB_PREFERENCES = { contextIsolation: true,
> nodeIntegration: false, sandbox: true, preload: <path> } as const;` —
> main.ts must build its BrowserWindow from this constant and nothing else.
> main.ts: create the window (1600×1000), load `http://localhost:3000` when
> env `VOLTLINE_DEV=1`, else `out/index.html`. preload.ts: contextBridge
> exposing `window.voltline = { version: app.getVersion() }` only. Add
> `desktop/tsconfig.json` (CommonJS, outDir `desktop/dist`) and npm scripts:
> `desktop:compile` (tsc -p desktop), `desktop:dev` (concurrently next dev +
> electron with VOLTLINE_DEV=1), `desktop:start` (electron against out/).
> Add `tests/desktop-window-options.test.ts` asserting the three security
> flags on `WEB_PREFERENCES` are exactly `true/false/true` — this test is a
> permanent guard, mark it with a comment saying why.

**Acceptance criteria:** `npm run desktop:compile` clean; the security test
passes; existing suite, typecheck, lint pass.

### GD-6 — Typed IPC bridge for queries

**Prompt:**

> Read `desktop/db/executor.ts`, `src/lib/dbdesc.ts`, `desktop/preload.ts`,
> `desktop/main.ts`. Create `desktop/ipc.ts` exporting a const channel list
> `CHANNELS = { query: "voltline:query", storage: "voltline:storage" }` and
> handler registration `registerDb(ipcMain, executor)` that validates the
> incoming descriptor shape (reject unknown tables — allowlist the schema's
> table names — and unknown kinds) before executing. Extend preload to
> expose `query(d)` and `storage(d)` via `ipcRenderer.invoke`. Extend
> `src/types/desktop.d.ts` accordingly. In main.ts, construct
> `SqliteExecutor` with a db path under `app.getPath("userData")` +
> `/vault/voltline.db` and register handlers. No renderer file changes yet.

**Acceptance criteria:** compile + suite + typecheck + lint pass; the
allowlist rejects a made-up table name (unit test the validator as a pure
function in `tests/desktop-ipc.test.ts`).

### GD-7 — Renderer uses SQLite in desktop mode  ⛔ STOP GATE

**Prompt:**

> Read `src/lib/supabase.ts`, `src/lib/local-config.ts`, `src/lib/dbdesc.ts`.
> In `supabase.ts`, when `runtime() === "desktop"`, return
> `descriptorClient(window.voltline.query)` with storage backed by
> `window.voltline.storage`; otherwise return the existing localdb client
> unchanged. Auth in desktop mode mirrors local mode (fixed local user).
> Change nothing else.

**Acceptance criteria:** browser behavior identical (full Playwright suite
passes); typecheck, lint, unit tests pass. **⛔ Owner runs
`npm run desktop:dev`, creates a project, uploads
`test-assets/sample-plan-E101-E102.pdf`, draws takeoffs, closes and
reopens the app, and confirms everything persisted.**

### GD-8 — PDFs as real files

**Prompt:**

> Read `desktop/db/executor.ts` storage handling and `src/lib/pdf.ts`.
> Ensure desktop storage stores uploaded plan files content-addressed:
> filename = sha256 of bytes + `.pdf` under `<userData>/vault/plans/`,
> download returns the bytes, remove deletes only when no `documents` row
> still references that path. Add executor unit tests for upload/download/
> remove and the still-referenced guard.

**Acceptance criteria:** parity + new tests pass; typecheck, lint pass.

### GD-9 — AI proxy through the main process

**Prompt:**

> Read `src/app/api/autocount/route.ts`, `src/app/api/sheetinfo/route.ts`,
> `src/components/takeoff/AutoCount.tsx`, `SheetAnalysis.tsx`. Create
> `src/lib/aiTransport.ts` exporting `autocount(body)` and `sheetinfo(body)`
> which POST to the existing `/api/` routes in browser mode and call
> `window.voltline.ai(kind, body)` in desktop mode. Point the two components
> at it (mechanical swap of their fetch calls — change nothing else in
> them). Create `desktop/ai.ts`: an ipc handler that reuses the SAME
> validation and fan-out logic as the routes by extracting that shared logic
> into `src/lib/autocount/service.ts` and `src/lib/sheetai/service.ts`
> (pure functions taking (detector/analyzer, validated body)); both the
> Next routes and desktop/ai.ts become thin callers of the services. The
> API key in desktop comes from `getApiKey()` in `desktop/settings.ts`
> (stub returning `process.env.ANTHROPIC_API_KEY` until GD-10).

**Acceptance criteria:** the two routes still pass any existing route
tests; renderer never imports `@anthropic-ai/sdk` (grep proves it);
`npm test`, typecheck, lint, Playwright pass.

### GD-10 — Key storage + settings dialog  ⛔ STOP GATE

**Prompt:**

> Create `desktop/settings.ts`: `setApiKey(plaintext)` encrypts with
> Electron `safeStorage` and writes `<userData>/settings.json`;
> `getApiKey()` decrypts; `hasApiKey()` returns boolean. IPC exposes ONLY
> `setApiKey` and `hasApiKey` to the renderer — `getApiKey` must not be
> reachable over IPC (add a test asserting the channel list does not
> contain it). Add a minimal settings section in the app (desktop mode
> only): a password-type input to set the key, showing only "key set /
> not set". The typed key goes straight over IPC and is never stored in
> renderer state after submit.

**Acceptance criteria:** grep shows `getApiKey` referenced only inside
`desktop/`; suite, typecheck, lint pass. **⛔ Owner sets a real key in the
dialog and runs a live auto-count in the desktop app.**

---

## Phase 2 — shipping

### GD-11 — Project bundle export (web + desktop)

**Prompt:**

> Add "Export project bundle" to the project screen: serialize all rows of
> the current project (all 10+ entities) plus its PDFs (base64) into one
> `.voltproj` JSON file, `schema_version: 1`, downloaded via a Blob. Pure
> serializer in `src/lib/bundle.ts` with unit tests (round-trip:
> serialize → parse → deep-equal). No import yet.

**Acceptance criteria:** bundle of the E2E fixture project round-trips in
tests; suite, typecheck, lint pass.

### GD-12 — Project bundle import

**Prompt:**

> Read `src/lib/bundle.ts`. Add "Import bundle" to the project list screen:
> parse, validate schema_version and referential integrity (every foreign
> id resolves inside the bundle — reject otherwise, listing what is
> broken; invariant: parsers reject rather than guess), remap all ids to
> fresh uuids preserving references, insert via the normal client. Works in
> both browser and desktop modes.

**Acceptance criteria:** export from browser → import in browser yields an
identical-looking project with new ids; a bundle with a dangling layer_id
is rejected with a specific message; suite, typecheck, lint, Playwright
pass.

### GD-13 — Installer

**Prompt:**

> Add an `electron-builder` config (`desktop/electron-builder.yml`): appId
> `com.voltline.app`, NSIS target, win x64, files = `desktop/dist`, `out/`,
> `package.json`; npm script `dist:desktop` = build:desktop +
> desktop:compile + electron-builder. Generate a simple placeholder .ico
> from the existing favicon if present, else document that an icon file is
> needed. Do not configure signing or auto-update.

**Acceptance criteria:** `npm run dist:desktop` produces an installer in
`dist/`; document its path and size in the task report.

### GD-14 — Electron smoke test  ⛔ STOP GATE

**Prompt:**

> Read `e2e/helpers.ts` and `playwright.config.ts`. Add
> `e2e/desktop-smoke.spec.ts` using Playwright's `_electron.launch` against
> the compiled shell (skip with a clear message when `desktop/dist` is
> absent): launch, create a project, upload
> `test-assets/sample-plan-E101-E102.pdf`, place one count takeoff, assert
> the save indicator reaches "saved", `app.close()`, relaunch, assert the
> project and takeoff survived. Keep it out of the default web E2E run
> (separate npm script `e2e:desktop`).

**Acceptance criteria:** `npm run e2e:desktop` passes locally; the default
`npx playwright test` run is unaffected. **⛔ Owner installs the GD-13
installer on a clean login and runs the app once.**

---

## Explicitly deferred (do not let the fast model start these)

- Auto-updater (plan 13 D-6 update rules) — after the app has real users
  beyond the owner.
- The vault journal/snapshot folder — that is plan 14 N-3 and follows its
  own queue once N-1/N-2 are done.
- Code signing — owner decision O-3.
