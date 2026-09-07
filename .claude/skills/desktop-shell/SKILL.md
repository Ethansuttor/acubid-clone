---
name: desktop-shell
description: Implement or review Voltline's Electron lifecycle, typed IPC bridge, native AI credential custody, and Windows packaging. Read the current desktop packet; do not assume static export or SQLite is already implemented.
---

# Desktop shell

Read [.ai/13-windows-desktop-plan.md](../../../.ai/13-windows-desktop-plan.md)
and [parallel ownership](../../../.ai/18-parallel-execution-plan.md).
The user's instructions control scope; these guidelines do not create extra
owner-only approval gates.

## Runtime boundary

The first build bundles a Next.js standalone server. Static export is deferred:
unknown local project IDs and POST APIs need more than client rendering.
Read the installed Next output/static-export guides before changing the build.
Preserve the ordinary web build behavior, not byte-for-byte build output.

Use supported bundled runtime launch APIs. A developer's node.exe, current
directory, .env file, or running dev server must not be required by the installer.
Package PDF/detection workers and traced/static assets, then verify them offline.

Maintain a stable data directory and origin/session while IndexedDB is used.
Handle occupied ports without connecting to an unknown server or silently
changing the persistence origin. Manage only this application's child processes.

## Privileged operations

Keep contextIsolation=true, nodeIntegration=false, and sandbox=true.
Validate IPC sender/frame and bounded payloads against the versioned contract.
Do not expose arbitrary SQL, file paths, process execution, or provider keys.
Do not relax renderer security merely to get a library working.

Key entry briefly passes through a user input. Clear it on submission; do not
persist it in renderer storage/state/logs. Encrypt stored credentials through
supported OS facilities; expose set/clear/status, never a key-read command.
If encryption fails, report it rather than storing plaintext.

Keep web production AI authorization closed. Desktop requests use the private
bridge and shared validated service logic. Follow existing candidate limits,
pending review, cancellation, and unresolved-error behavior.

## Storage and lifecycle

Swapping supabase() alone is incomplete: assembly replacement, backup/restore,
and maintenance locking currently call browser helpers directly. Integrate
all of them through C1 before claiming desktop storage is active.

Preserve IDs and frozen snapshot/PDF references on migration. Desktop SQLite
needs active-backend contract tests and versioned migrations; do not execute
Postgres SQL verbatim or create future backends for unrelated changes.

Single-instance/maintenance exclusion protects one data directory. Close waits
for local commits and surfaces failures. Updates never force restarts during
work; an unsynced cloud backlog alone is not an indefinite quit blocker.

## Verification

Use current script names after they exist. The required outcomes are staged
production startup, packaged lifecycle, real PDF worker operation, save/reopen,
forced termination after acknowledgement, port collision, second instance,
migration/restore, and installer upgrade on a clean standard-user environment.

Report security/IPC/key-custody checks, runtime versions, data/origin strategy,
installer path/hash/size/signing status, and unverified gates. Do not publish
or purchase signing services based solely on this skill.
