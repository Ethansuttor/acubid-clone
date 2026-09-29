# Strategy, revenue paths and prioritized tasks

Written September 29, 2026 from a full review of commit `9f929a0`
(branch `platform-seam-and-acceptance-harness`, PR #3). This is a proposal
for the owner to accept or change. It does not replace the execution rules
in [18-parallel-execution-plan.md](18-parallel-execution-plan.md), and none
of its tasks is dispatched by this document.

## What the product is for

Voltline turns a set of electrical drawings into a defensible bid price:
takeoff, pricing through the contractor's own items and assemblies, the
commercial markups, and consistent outputs. It exists to replace
Accubid/LiveCount for its owner. Its thesis ([01-product.md](01-product.md))
is that money is lost to uncounted scope and purchased labor units, not to
click speed.

The current plan scopes a **single-user Windows app** and explicitly lists
billing, team editing and cloud sync as non-goals. Earning revenue from
the product changes that scope. The sections below say what would have to
change and in what order.

## Review findings (September 29)

Checks run on `9f929a0`, Windows 11, Node from the local install:

| Check | Result |
| --- | --- |
| `npx vitest run` | 542 tests passed across 33 files |
| `npx tsc --noEmit`, `npm run lint`, `npm run build` | All clean |
| `npx playwright test` | 17 of 17 passed (58 s), local Chrome, port 3000 verified free first |
| Real-job acceptance (G5), installed desktop, real-plan detection (G6) | Not run. No inputs exist yet. |

Repository and security findings, worst first:

1. **Exposed login.** The repository is public. Its git history contains
   the Supabase URL, publishable key and the owner's sign-in password
   (formerly in `e2e/helpers.ts` and `08-environment.md`). Project
   `volt-takeoff` is still provisioned; it hibernates but wakes on request.
   The app no longer uses Supabase. **Owner action:** pause or delete the
   project, or at minimum rotate the password. Removing the string from the
   current tree does not remove it from history.
2. **PR #3 carries generated output.** Commit `0f1a154` ("idk") tracks 829
   files under `eval-out/` and a `scripts/__pycache__/*.pyc`. Remove them
   and add both paths to `.gitignore` before merging.
3. **Unmerged work.** `origin/claude/markdown-files-review-ad60sv` holds the
   web-app manifest and icons ("install as app"). Its bid-math commit is
   superseded by `0003_bid_math_gaps.sql`; the manifest never landed.
4. **Production AI is off.** Both API routes return unauthorized whenever
   `NODE_ENV === "production"` (`src/app/api/*/route.ts`). Any packaged or
   deployed build has no AI until track D3 or a hosted proxy exists.
5. **Doc sprawl.** Two files numbered 12 and two numbered 13, plus retired
   queues. Consolidate once PR #3 merges.

## Market reference

Approximate public figures from vendor and aggregator pages, September
2026. Not verified quotes.

| Product | Price |
| --- | --- |
| Accubid | Quote-only; reported about $3k–15k per user per year |
| McCormick | Reported about $200–300 per user per month |
| ConEst IntelliBid | Reported about $115–150 per user per month |
| STACK, Togal | $199–299 per user per month |
| Quotr | $299.90 per month; also sells done-for-you takeoff priced per square foot |

## Revenue paths, in order

1. **Own bids first.** Until one real bid reconciles (G5), nothing else is
   credible. The value here is jobs won at the right price.
2. **Estimating as a service.** The owner uses Voltline to produce takeoffs
   or estimates for other contractors, per bid. Earliest cash, no
   licensing or billing infrastructure, and each job yields real labeled
   drawings, the input G6 is missing.
3. **Software subscription.** Positioning: Accubid-grade estimating plus
   reviewed AI scope checking at mid-market pricing, about $149–249 per seat
   per month with AI usage metered as an add-on. For scale only:
   50 contractors × 1.5 seats × $199 per month ≈ $179k per year.

Keep the desktop-first architecture. Selling it still needs a small hosted
service, because the provider API key cannot ship inside a desktop app.
That service provides license activation, payments, the AI proxy with
usage metering, update distribution and opt-in crash reports.

**Onboarding blocker:** the "user owns their labor units" rule is correct,
but a new customer starts with an empty database. Selling requires a
migration path (import wizard) and starter assembly templates. Check a
competitor's license terms before building importers for its formats.

## Features not on the existing roadmap

| Feature | Why |
| --- | --- |
| Win/loss tracking: outcome, winning number, GC, job type, markup; win rate and margin by segment | Directly steers where a contractor bids and at what margin; also a selling point |
| Catalog import wizard with column mapping | Removes the largest switching cost |
| Price provenance and age, with a preflight warning for stale prices | Copper and gear move weekly; an old price is a plausible wrong number |
| General conditions calculator: hours to crew and duration, then monthly supervision, trucks, lifts, trailer | A common place bids quietly lose money |
| Starter assembly templates, labeled as needing the user's labor units | Makes a first bid possible for a new user |
| Read-only bid review page for a manager | Cheap first step toward multi-user without shared editing |

Each feature that produces money or quantity follows
[04-invariants.md](04-invariants.md): pure logic in `src/lib`,
hand-calculated tests, no silent drops, and AI output reviewed before it
counts.

## Prioritized tasks

| # | Task | Why | How |
| --- | --- | --- | --- |
| P0 | Close the Supabase exposure | Anyone can sign in with a password in public history | Owner: pause/delete `volt-takeoff` or rotate the password; optionally make the repo private |
| P0 | Clean and merge PR #3; bring over the manifest from `ad60sv` | Current code is not on `main`; repository bloat | Untrack `eval-out/` and `__pycache__/`, ignore them, merge, cherry-pick `src/app/manifest.ts` and icons, delete dead branches |
| P1 | Reproduce one real bid (A2–A4, G5) | Gate for trusting or selling anything | Harness exists (`npm run acceptance`, [19](19-real-estimate-acceptance.md)); supply one completed job's PDFs, line export, catalog and settings |
| P1 | Windows installer and SQLite storage (tracks D, S) | The product used daily | Follow [13](13-windows-desktop-plan.md) and [14](14-durability-and-sync-plan.md) |
| P1 | Priced alternates and allowances (B-301) | Nearly every bid needs them | Settle inclusion, tax and markup policy with the estimator first; then scenario pricing in `estimate.ts` with a hand-calculated fixture |
| P2 | Hosted license / AI-proxy / backup service | Required to sell; restores AI in packaged builds | Service holds the key, meters usage, checks license; desktop calls it through the `src/lib/platform/ai.ts` seam |
| P2 | Import wizard and starter templates | New customers cannot start without them | Column-mapping UI on the existing `csv.ts` merge and validation |
| P2 | Win/loss tracking | Direct revenue lever for users | New outcome table and dashboard; touches no bid math |
| P2 | Real-plan detection evaluation (V1–V4, G6) | AI claims are unverified; it is the sales demo | Label 3–5 real plan sets (service work supplies them); report precision, recall and runtime separately |
| P3 | Specification reader and scope-gap audit (S-101/102) | The differentiator competitors do not sell | Findings cite a sheet or spec line and enter the review queue; never change the bid on their own |
| P3 | Legend to layers to whole-set count (T-201/202) | The demo that wins customers | Extend the existing local symbol search |
| P3 | Actuals to labor-unit feedback (O-401) | Long-term moat | Reviewed suggestions only; see the deferred [12-spectrum-job-cost-plan.md](12-spectrum-job-cost-plan.md) |

Defer cloud team editing, natural-language queries and change orders until
paying users ask for them.
