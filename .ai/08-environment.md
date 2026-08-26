# Environment

## Running it

```sh
npm install
cp .env.example .env.local   # then add ANTHROPIC_API_KEY if testing live AI
npm run dev                  # http://localhost:3000
```

Environment variables:

```
# Optional AI integration (server-side only)
ANTHROPIC_API_KEY=sk-ant-...                          # server-side only
ANTHROPIC_MODEL=claude-sonnet-4-6                     # optional override

```

`.env.local` is gitignored. `.env.example` provides template variables and
a placeholder for the Anthropic key. **No real Anthropic API keys or user passwords
are committed to the repository.**

## Local-first Environment

Voltline runs as a **local-first application** by default:
- `LOCAL_ONLY = true` is configured in `src/lib/local-config.ts`.
- The local username is `1`; the password is intentionally empty. This is a
  development convenience, not production authentication.
- `src/lib/localdb.ts` provides a browser `localStorage`-backed relational
  client supporting all 10 project entities (`projects`, `documents`, `sheets`,
  `layers`, `takeoffs`, `items`, `assemblies`, `assembly_items`, `direct_costs`,
  `bid_snapshots`).
- Plan set PDF binaries are stored locally in the client storage layer.
- Fast local authentication defaults to local estimator user profiles (`Estimator 1`)
  with zero external network dependencies.

## Cloud Backend Readiness & Migrations

The current client does not read Supabase environment variables. For a future
deployment against a cloud PostgreSQL / Supabase backend:
- `supabase/migrations/0001_schema.sql` (core relational schema and RLS policies).
- `supabase/migrations/0002_bid_math.sql` (commercial bid math columns `waste_pct`,
  `tax_pct`, `labor_factor_pct`, `typical_multiplier`, and the `direct_costs` table).
- When configuring a live Supabase environment, configure `NEXT_PUBLIC_SUPABASE_URL`
  and `NEXT_PUBLIC_SUPABASE_ANON_KEY` via secure environment variables. Never commit
  plaintext service role keys or user credentials into repository documentation or code.

## Tooling constraints

- **Playwright** can use pre-installed browser binaries:
  `executablePath: "/opt/pw-browsers/chromium"` (or standard `npx playwright test`).
- **`node_modules` can be pruned** between sessions. If `vitest: not found`,
  run `npm install`.
- On restricted hosts, Playwright, Next.js builds, or the benchmark may need
  permission to spawn worker/browser processes.

## Stack versions

Next 16 · React 19 · TypeScript 5.9 · Tailwind 4 · Zustand 5 ·
pdfjs-dist 4.10 · ExcelJS 4.4 · `@anthropic-ai/sdk` · Vitest 4 · Playwright.

## Repository

`Ethansuttor/acubid-clone`, branch `main` in the current checkout. Do not push
or create a pull request unless the repository owner explicitly asks.
