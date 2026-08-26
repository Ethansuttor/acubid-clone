# Voltline as a real Windows app

**Written:** August 26, 2026
**Status:** plan only — no code written, nothing here is implemented.
**Question it answers:** can Voltline become an installed Windows application
instead of a browser tab, what does that buy, what does it cost, and which
shell should carry it?

> Version numbers, package behavior, and certificate prices in this draft are
> planning-grade and must be re-verified at implementation time. In particular,
> AGENTS.md warns that this repo's Next.js version has breaking changes —
> the static-export step below has a mandatory read-the-docs checkpoint.

Related: [`14-durability-and-sync-plan.md`](14-durability-and-sync-plan.md)
(the desktop shell is what makes its "vault folder" fully trustworthy),
[`12-spectrum-job-cost-plan.md`](12-spectrum-job-cost-plan.md) (D-S4).

---

## Verdict

**Feasible, and unusually cheap for this codebase.** Roughly 3–5 weeks of
shell work and near-zero rewrite of the product itself, because Voltline was
accidentally designed for this:

1. **All arithmetic is pure** (`src/lib/*.ts`) — no DOM, no server, no I/O.
   It runs identically anywhere JavaScript runs.
2. **Persistence already sits behind a contract** (invariant 8): every
   database call goes through the Supabase-shaped query builder that
   `localdb.ts` implements over localStorage. A desktop app implements the
   *same contract* over SQLite and no component, store, or lib changes.
3. **Only two server routes exist** (`/api/autocount`, `/api/sheetinfo`),
   and both are thin proxies around the Anthropic SDK — Node code that moves
   into a desktop main process nearly verbatim.
4. The UI is client-rendered React; PDF.js, ExcelJS, and the canvas all run
   in the page already.

The app is a web page wearing a web server as a coat. The desktop version
takes the coat off.

---

## What a desktop app buys (in order of importance to this product)

1. **Real files.** A folder the user owns, visible in Explorer, backed up by
   whatever they already back up. This is the enabling condition for the
   vault design in [`14-durability-and-sync-plan.md`](14-durability-and-sync-plan.md).
2. **No eviction risk.** Browser storage (localStorage, IndexedDB) is a
   cache the *browser* owns: it can be evicted under storage pressure, and
   one "clear browsing data" click currently deletes the entire business.
   This is arguably the single largest data-loss risk in today's product.
   A desktop app's SQLite file and vault folder are ordinary files — the
   browser cannot take them away.
3. **Bigger plan sets.** Real process memory, no per-origin quota, PDFs
   stored as files instead of base64 blobs in localStorage.
4. **Offline always, no hosting.** Nothing to deploy, no dev server to
   start, no dependency on anyone's uptime for a bid-day tool.
5. **OS integration.** A taskbar identity, native menus and shortcuts,
   drag-a-PDF-onto-the-window, a `.voltproj` file association for project
   bundles.
6. **Better key custody.** `ANTHROPIC_API_KEY` moves from a hosted env var
   to the user's own machine, encrypted with Windows DPAPI. For a
   single-estimator tool this is *stronger* custody, and invariant 7
   survives intact (see Security posture).

## What it costs

- A build → sign → install → update pipeline that doesn't exist today
  (one-time setup, plus a signing decision — see Distribution).
- A second runtime to verify. Mitigated by choosing Electron: same Chromium
  the Playwright suite already drives.
- The Next.js static-export step (honest friction, below).
- Installer-era support: the user updates the app instead of refreshing a tab.

---

## Options considered

| Option | What it is | Size | Testing story | AI routes | Verdict |
|---|---|---|---|---|---|
| **Electron** | Bundled Chromium + Node | ~150–250 MB installed | **Playwright drives it natively** (`_electron.launch`) | Move to main process, same Node SDK, near-verbatim | **Chosen** |
| Tauri 2 | Rust shell + WebView2 | ~10–20 MB | WebDriver via tauri-driver — weaker than Playwright | Rewrite in Rust or run a sidecar | Better product on paper; worse fit for this repo |
| PWA | Installable web app | 0 | unchanged | unchanged | Doesn't remove eviction risk — not a "real app" where it counts |
| Native rewrite (WPF/MAUI) | Throw away the React codebase | — | — | — | Discards a working, tested product. No. |

## Recommendation: Electron

Three reasons, all specific to this repository:

1. **The verification culture survives.** This project's trust story is
   Playwright + the hand-calculated fixture. Playwright launches and drives
   Electron first-class, so the *shipped shell* is what gets tested. Tauri
   would split the story: UI tested in a browser, shell tested with a
   different, more brittle toolchain.
2. **The AI routes port, not rewrite.** Both API routes are Node code around
   `@anthropic-ai/sdk`; in Electron's main process they keep their language,
   their SDK, and their tests.
3. **Boring storage.** `better-sqlite3` in Electron is a decade-mature path.

Tauri's genuine advantages — binary size, RAM — do not matter for one
estimator's work PC. Revisit only if size/memory becomes a real complaint;
the seam (the query-builder contract) is identical either way, so nothing
in this plan is wasted by a later switch.

Independent of all of this: the web build should call
`navigator.storage.persist()` today. One line, reduces (does not eliminate)
eviction risk for everyone on the browser version.

---

## Architecture

```
┌ renderer — the existing app, static-exported ──────────────────────┐
│  React components · Zustand store · pure libs · PDF.js · ExcelJS   │
│  Talks to storage through the SAME query-builder contract as today │
│  Never touches Node, the disk, or the API key                      │
├ preload — a typed IPC bridge; contextIsolation ON, nodeIntegration OFF
└ main process
     storage engine — SQLite implementing the localdb contract
     vault writer   — plan 14's journal + snapshot folder
     AI proxy       — @anthropic-ai/sdk; key via safeStorage (DPAPI)
     updater        — electron-updater; apply-on-quit only
```

`src/lib/local-config.ts` grows a third mode:
`"browser-local" | "desktop" | "cloud"`.

**What does not change:** every pure lib, every component, the store's
shape, undo/redo, preflight, snapshots, catalog diagnostics, the Excel
export, and every existing test for all of it.

## The storage engine — the only real work

- One SQLite database (location chosen with plan 14's vault — user-visible,
  user-chosen folder preferred over `%APPDATA%`; decide at D-2).
- Implements the **same query-builder subset** `localdb.ts` implements over
  localStorage. **Parity suite:** the existing localdb tests are
  parameterized to run against *both* implementations. A behavioral
  difference between backends is a red test, not a runtime surprise. This
  suite is a gate, not a nice-to-have.
- PDFs become real files, content-addressed (`plans/<sha256>.pdf`),
  referenced from `documents.storage_path` — never blobs in the DB.
- Migrations: the same numbered SQL files, tracked in a `_migrations` table.
  Three backends must move in lockstep — see the proposed `schema-migration`
  skill in [`15-proposed-skills.md`](15-proposed-skills.md).

## Next.js static export — the honest friction

- `output: "export"`; the dynamic `project/[id]` route needs client-side
  param handling; the two API routes leave the bundle (they move to main).
- **Mandatory checkpoint before D-1:** re-read this repo's actual Next.js
  docs at `node_modules/next/dist/docs/` for current export behavior and
  flags. AGENTS.md says this version diverges from training data; this plan
  must not be trusted for exact configuration.
- If export friction proves larger than expected, the fallback is bundling
  `next start` inside Electron — works, uglier, decided at D-1 with
  evidence rather than preference.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — and
  a unit test that asserts all three, so a refactor can't silently relax
  them. The renderer is treated as an untrusted web page by main.
- IPC is an explicit, enumerated, typed command list. There is no generic
  "run this SQL" channel: the query builder serializes to a constrained
  descriptor that main validates before touching SQLite.
- The API key: entered once in a settings dialog, encrypted at rest via
  `safeStorage` (Windows DPAPI), used only in main, never sent to the
  renderer, never logged. Invariant 7 is *extended*, not weakened:
  "the key never reaches the browser" becomes "the key never reaches the
  renderer process."

## Distribution

- `electron-builder` → NSIS installer; a portable `.exe` as a bonus.
- **Signing decision:** unsigned builds trip SmartScreen. For strictly
  personal use, documenting the one-time bypass is acceptable; the moment
  anyone else installs it, buy an OV code-signing certificate (order of
  $100–400/year — verify current pricing). Decide by audience, on purpose.
- Updates: `electron-updater` against GitHub Releases. Check at launch,
  download in background, **install on quit only — never mid-session, and
  never while unsynced ops exist** (plan 14). Nothing updates itself on bid
  day.

## Migrating today's data

Browser localStorage and a desktop app cannot see each other's storage.
The bridge is explicit: **"Export project bundle"** (`.voltproj` — JSON plus
the PDFs, zipped) in the web build → **"Import bundle"** in the desktop app.
Build the export half regardless of this plan: it is also the manual backup
button the web app should already have.

---

## Milestones

Planning estimates, not commitments. D-4 is plan 14's N-3 landing here.

| # | Work | Est. |
|---|---|---|
| D-1 | Static export + config mode + **Next docs checkpoint**; full Playwright suite green against the exported build | 2–3 d |
| D-2 | Electron shell; SQLite engine; **parity suite** running localdb tests against both backends | 4–6 d |
| D-3 | AI proxy in main + key storage + settings dialog | 2–3 d |
| D-4 | Vault folder integration (plan 14, N-3) | — |
| D-5 | `.voltproj` export/import bundles (web + desktop) | 2–3 d |
| D-6 | Installer, signing decision, updater with apply-on-quit | 2–4 d |

Verification: unit tests unchanged (pure libs don't know the shell exists);
Playwright continues in full against the web build; plus an
`_electron.launch` smoke suite — launch, open project, draw a takeoff,
kill the process, relaunch, assert nothing was lost (jointly with plan 14's
crash-recovery suite).

## Failure modes

| # | Failure | Mitigation |
|---|---|---|
| 1 | `better-sqlite3` native ABI mismatch vs Electron version | Pin versions; `electron-rebuild` in the build script; parity suite catches breakage |
| 2 | SmartScreen frightens the user off an unsigned build | The signing decision is made explicitly at D-6, not discovered at install time |
| 3 | Static export silently changes a route/behavior | D-1 checkpoint + full Playwright against the exported build before any shell work |
| 4 | An update interrupts live work | Apply-on-quit invariant; no forced restarts, ever |
| 5 | Storage backends drift apart | Parity suite is a merge gate |
| 6 | A refactor re-enables Node in the renderer | The three security flags are asserted by a test |

## Invariants to add when built (not before)

- The API key never reaches the renderer process (invariant 7, extended).
- Updates apply on quit only, and never while unsynced operations exist.
- No storage backend may load a real project until it passes the shared
  parity suite.
