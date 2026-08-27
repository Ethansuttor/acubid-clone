@AGENTS.md

# Voltline — electrical estimating & takeoff

**New session? Read [`.ai/00-START-HERE.md`](.ai/00-START-HERE.md) first.**
The [`.ai/`](.ai/README.md) directory is a context pack written specifically
so you don't have to rediscover this codebase: architecture, the estimating
domain vocabulary, the invariants, a log of decisions, and every bug already
found and fixed.

## The one rule that outranks everything

This app is used on **live electrical bids for real money**. Correctness of
the arithmetic — quantities, extensions, labor hours, bid totals — outranks
features, speed, and elegance. A crash is recoverable; a bid that is quietly
8% short loses a job or wins one at a loss.

Concretely, and non-negotiably:

- **Quantity is never silently dropped.** If a layer carries takeoff quantity
  that can't be priced, `extendEstimate` reports an `EstimateIssue` and the
  UI and Excel export both show it. See `.ai/04-invariants.md`.
- **Nothing an AI produces reaches the bid unreviewed.** Detections land as
  pending; sheet analysis returns proposals.
- **Parsers reject rather than guess.** A plausible wrong number is the most
  expensive bug this project can have.
- **All arithmetic lives in `src/lib/estimate.ts` and `src/lib/geometry.ts`**
  — pure, tested against a hand-calculated fixture. Components never compute.

## Working here

- Before changing money or quantity: `.ai/04-invariants.md` and
  `.ai/06-bug-history.md`. Skills: `estimating-math`, `ai-feature`.
- Before saying it works: `.ai/07-verification.md`. Skill: `voltline-verify`.
  Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e`,
  `npm run bench`, and `npm run build`.
- Before changing a table, column, or row shape: skill `schema-migration`.
  One schema, several backends, one commit.
- Before touching saving, loading, or sync: skill `durable-persistence`.
- Working under `desktop/`: skill `desktop-shell`.
- Post-award money (budgets, change orders, billing, WIP): skill
  `job-cost-math`. Why each skill exists: `.ai/15-proposed-skills.md`.
- Do the arithmetic by hand *before* writing the test. Twice a test
  expectation was wrong and the app was right.
- Keep `.ai/` current: a new decision goes in `05`, a fixed bug in `06`. If a
  file there contradicts the code, the code is right — fix the file in the
  same commit.

The local-only client, temporary login, optional AI configuration, and browser
tooling notes are in `.ai/08-environment.md`.
