---
name: desktop-shell
description: Work on the Voltline Windows desktop app — anything under desktop/ (Electron main process, preload, IPC bridge, SQLite executor, settings, packaging), the static export build, or the code that switches the renderer between browser and desktop mode. Covers the non-negotiable security flags, the enumerated IPC surface, API-key custody, update timing, and the storage parity suite.
---

# Working on the desktop shell

The plan is `.ai/13-windows-desktop-plan.md`; the task queue is
`.ai/16-desktop-task-queue.md`. This skill is the set of rules that must hold
no matter which task you are on.

The premise that makes this cheap: **the product does not know it is in
Electron.** All arithmetic is pure, persistence sits behind a query-builder
contract, and only two thin API routes exist. If a change to the shell
requires editing `src/lib/estimate.ts`, something has gone wrong.

## 1. The renderer is untrusted

Three flags, and they are not negotiable:

```ts
// desktop/window-options.ts — the ONLY place these are set
export const WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: <path>,
} as const;
```

`main.ts` builds its `BrowserWindow` from this constant and nothing else, and
a unit test asserts all three values. That test is a permanent guard, not a
formality — treat deleting or relaxing it as the defect, not the fix.

Main treats the renderer exactly like a web page: everything crossing the
bridge is untrusted input.

## 2. IPC is an enumerated list, never a pipe

There is no generic "run this SQL" or "eval this" channel. The renderer sends
a **serialisable descriptor**; main validates it before touching anything:

- Table names are checked against an **allowlist** built from the schema.
- Operation kinds are checked against a closed set.
- The validator is a pure function with its own unit tests
  (`tests/desktop-ipc.test.ts`), so it can be tested without Electron.

When you add a capability, add a named channel and a validator branch. Never
widen an existing channel to "accept an object and do what it says."

## 3. The API key never reaches the renderer

This is invariant 7, extended: *"the key never reaches the browser"* becomes
*"the key never reaches the renderer process."*

- Stored via Electron `safeStorage` (Windows DPAPI) in `desktop/settings.ts`.
- IPC exposes `setApiKey` and `hasApiKey` **only**. `getApiKey` must not be
  reachable over IPC — there is a test asserting the channel list omits it.
- The renderer shows "key set / not set", never the value; the typed key goes
  straight over IPC and is not retained in renderer state after submit.

```sh
grep -rn "getApiKey" src desktop   # must return hits only inside desktop/
grep -rn "@anthropic-ai/sdk" src   # must return hits only in lib/*/claude.ts
```

## 4. One schema, two engines, one parity suite

The desktop SQLite executor implements the **same query-builder contract** as
`src/lib/localdb.ts`. That is the entire reason no component changes.

**No storage backend ships without passing the shared parity suite** — the
localdb test cases re-run against the SQLite executor, same inputs, same
expected outputs, including `single` semantics, `in` filters, order
direction, cascades, and storage round-trips. A behavioural difference
between backends must be a red test, never a runtime surprise.

Schema changes are covered by the `schema-migration` skill: SQL, localdb,
`types.ts`, and `desktop/db/schema.ts` move in the same commit.

Translation notes for SQLite: `uuid`/`timestamptz`/`text` → `TEXT`,
`numeric` → `REAL`, `boolean` → `INTEGER` 0/1; drop RLS, policies, and
`references auth.users`; **keep** every table, column, default, check
constraint, and `on delete cascade`.

## 5. PDFs are files, not blobs

Plan bytes are content-addressed on disk (`plans/<sha256>.pdf`) and
referenced from `documents.storage_path`. Never store binary in the database.
Removal only when no row still references the path — an orphaned upload and a
missing file are both bugs (see `.ai/06-bug-history.md` #13).

## 6. Read the Next docs before touching the export

`AGENTS.md` is explicit: this Next.js version has breaking changes and
training-data recall for it is stale. Before changing `next.config.ts` or the
static export, read `node_modules/next/dist/docs/` and say which files you
read. The normal `npm run build` must stay byte-for-byte unaffected when
`VOLTLINE_DESKTOP` is unset.

## 7. Updates never interrupt work

- Check at launch, download in the background, **apply on quit only**.
- Never while unsynced operations exist.
- No forced restarts, ever. Bid day is the day an auto-update is most likely
  to fire and least acceptable.

## 8. Verify

Unit tests do not know the shell exists, so they must keep passing untouched.
The web Playwright suite must stay green — desktop mode is additive.

```sh
npm run desktop:compile
npm test
npm run typecheck
npm run lint
npm run test:e2e             # web suite, unaffected
npm run e2e:desktop          # _electron.launch smoke: launch → edit → kill → relaunch → survived
```

The desktop smoke test's real job is the **relaunch assertion**. A shell that
renders is not a shell that persists.

## Before you report

Say which of the security flags, the IPC allowlist, the key-custody greps,
and the parity suite you actually ran. Packaging output belongs in the
report too: installer path and size, and whether it is signed — an unsigned
build trips SmartScreen, and that is a decision the owner makes explicitly,
not something discovered at install time.
