# Environment

## Running it

```sh
npm install
cp .env.example .env.local   # then add ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

```
NEXT_PUBLIC_SUPABASE_URL=https://ulswnsdyxfrwvznyraqy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...      # public by design
ANTHROPIC_API_KEY=sk-ant-...                          # server-side only
ANTHROPIC_MODEL=claude-sonnet-4-6                     # optional override
NEXT_PUBLIC_LOCAL_MODE=1                              # optional, dev only
```

`.env.local` is gitignored. `.env.example` holds the Supabase URL and
publishable key (safe to commit — RLS is the access control) and a placeholder
for the Anthropic key. **No real Anthropic key has ever been committed.**

## Supabase

- Project **`volt-takeoff`**, ref `ulswnsdyxfrwvznyraqy`, region `us-east-1`,
  org `Ethansuttor's Org`.
- Both migrations are **applied and verified** against it. The columns
  `waste_pct` / `tax_pct` / `labor_factor_pct` on `projects`,
  `typical_multiplier` on `layers`, and the `direct_costs` table with its RLS
  policy all exist. The app's exact insert shapes were tested against the live
  database and accepted.
- Sign-in user: `ethan.suttor@gmail.com`, temporary password
  **`volt-takeoff-2026`** — the owner should change this.
- Free-tier projects **auto-pause after inactivity**. If sign-in starts
  failing, check the project status and restore it from the dashboard.
- Outstanding advisory: leaked-password protection is disabled (a dashboard
  toggle).

For any other database, run `supabase/migrations/*.sql` in order.
`0002_bid_math.sql` is required, not optional — the app writes its columns,
so creating a project against a `0001`-only database fails outright.

## Local mode

`NEXT_PUBLIC_LOCAL_MODE=1` replaces the Supabase client with a
localStorage-backed stand-in (`src/lib/localdb.ts`) implementing the narrow
subset the app uses. Any email/password signs in. Used for offline dev and
for E2E in sandboxes without Supabase egress.

It is development-only by construction: the API routes honour its auth bypass
only when `NODE_ENV !== "production"`.

## Sandbox constraints (the Claude Code remote environment)

These bit hard during development — know them before debugging:

- **Egress to `supabase.co` is blocked** by the environment's network policy
  (the proxy answers 403 to CONNECT). This is why local mode exists. Direct
  `curl` to the Supabase REST endpoint will always fail here regardless of
  project state; use the Supabase MCP connector to inspect the database.
- **Playwright** must use the pre-installed browser:
  `executablePath: "/opt/pw-browsers/chromium"`. Do not run
  `playwright install`. The config also routes through `HTTPS_PROXY` with
  `bypass: "localhost,127.0.0.1"`.
- **`node_modules` can be pruned** between sessions. If `vitest: not found`,
  run `npm install`.
- Foreground `sleep` is blocked; use a backgrounded command.

## Stack versions

Next 16 · React 19 · TypeScript 5.9 · Tailwind 4 · Zustand 5 ·
pdfjs-dist 4.10 · ExcelJS 4.4 · `@anthropic-ai/sdk` · Vitest 4 · Playwright.

## Repository

`Ethansuttor/acubid-clone`, branch
`claude/electrical-estimating-takeoff-mbpfi3`, tracked by **PR #1**.
Push to that branch; it updates the PR.
