# Environment and runtime

Updated September 7, 2026.

## Run the browser application

Install the pinned dependency tree with npm ci when the lockfile matches the
manifest; use npm install when intentionally updating dependencies. Run npm run
dev and open http://localhost:3000. For a production browser build use npm run
build followed by npm start. No desktop scripts exist in the reviewed baseline.

Optional development AI variables: ANTHROPIC_API_KEY and ANTHROPIC_MODEL in
.env.local. Copy .env.example only if .env.local does not already exist.
Do not overwrite an existing environment file or print its contents to a log.
Local symbol search requires no key and sends no images.

The login username is 1 and the password is empty. This local access screen
is not server authentication. Both AI endpoints reject production requests;
setting an environment key does not bypass that guard.

## Local data

IndexedDB holds 11 logical tables, PDF blobs, and an append-only mutation
journal. Authentication state and legacy migration inputs use localStorage.
The app does not currently connect to Supabase or read its environment keys.

Browser storage belongs to an origin/profile. Changing host, port, or profile
can make a different workspace appear. Use portable backup to migrate;
Electron cannot automatically read Chrome's IndexedDB. Backup limits and the
empty-target restore rule are in [00-START-HERE.md](00-START-HERE.md).

## Tooling

Playwright configuration prefers PLAYWRIGHT_CHROMIUM_PATH, installed Chrome
or Edge, then managed Chromium. It starts/reuses localhost:3000. Do not assume
a Linux-only executable path or that an existing server belongs to your branch.
Follow [parallel coordination](18-parallel-execution-plan.md) for separate
checkouts, ports, and profiles.

If a dependency or browser binary is missing, install the needed compatible
dependency within the task's authorization. Environment permissions or network
restrictions vary by host; report actual failures instead of repeating old
sandbox assumptions. Do not weaken verification to hide a missing runtime.

Use package.json/package-lock.json and installed package versions as current
version evidence. Read Next.js guides in node_modules/next/dist/docs/ before
framework changes.

## Future backends

Historical SQL migrations include 0001_schema.sql, 0002_bid_math.sql,
0003_bid_math_gaps.sql, and 20260826142738_durable_bid_structure.sql.
Their presence does not establish live-cloud schema state or authorization
to apply them. Desktop SQLite uses explicit compatible migrations and a
contract suite; cloud activation is separate follow-on work.

Inspect git status and the actual branch at task start. Do not assume every
checkout is main or discard dirty changes. This documentation does not
authorize publishing or changing external infrastructure.
