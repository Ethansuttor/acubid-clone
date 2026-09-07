# Decisions and why

Answers to "why is it like this?" so you don't undo a deliberate choice.

---

**Geometry in PDF units, quantities derived at read time.**
Recalibrating a sheet must fix every measurement on it. Storing feet would
leave stale numbers that look fine. Costs a multiply per read; worth it.

**`extendEstimate` returns `{lines, issues}` rather than just lines.**
It used to return lines and silently `continue` past anything it couldn't
resolve. Three separate silent-shortfall bugs came from that. Changing the
return type forced every call site to acknowledge issues, and the type
checker found them all.

**Issues carry a `severity`.**
"180 ft of conduit is missing" and "this item is priced per foot but the
layer counts each" are both worth saying and must not be styled the same, or
the loud one gets ignored.

**Base-chain rationale (additional terms documented below): waste → tax → material total; labor factor → labor cost; prime
(incl. O&P-applicable direct costs) → overhead → subtotal → profit → plus
at-cost items → bid.**
Tax applies after waste because you buy the waste. Labor factoring adjusts
hours, not the rate, because that is how estimators reason about conditions.
Direct costs are split by an explicit per-item flag rather than a global
rule, because whether O&P applies to a sub quote is a commercial judgement.

**Direct costs marked "at cost" are added after profit.**
So they are carried through at face value before the final-price bond. With
bond set to zero, the E2E asserts the invariant by
toggling one item and checking the bid moves by exactly
`amount × (1+OH) × (1+profit) − amount`.

**The active client is intentionally local-only.**
`LOCAL_ONLY = true` and the client factory always returns the IndexedDB
adapter (with legacy localStorage migration and a durable outbox). The hardcoded username `1` with an empty password is a temporary
single-user development choice, not real authentication. The Supabase-shaped
boundary remains so a future backend can replace the adapter without rewriting
the estimator. Separately, AI API routes accept the local bearer token only
when `NODE_ENV !== "production"`; production AI needs real server auth.

**`SheetCanvas` is keyed by sheet id in `TakeoffView`.**
Per-sheet state used to be reset inside the page-loading effect, which React
Compiler flags and which is easy to get subtly wrong. A remount is the
idiomatic reset and deleted the reset code.

**One FIFO write queue in the store.**
The adapter's query builders are lazy thenables, so queueing defers the
operation. A fast add→undo could otherwise have the delete land before the
insert and resurrect the row on reload.

**Drawing-scale parsing is deliberately strict.**
It auto-calibrates sheets, so a misread mis-measures every run. It requires
an inch marker or a fraction on the paper side, requires a trailing inches
term to carry its own marker (so `1' 24X36` doesn't read the sheet size as
24 inches), rejects inches ≥ 12, and returns `null` when a string yields two
different scales. Being unable to read a scale is cheap; reading it wrong is
not. See [`06-bug-history.md`](06-bug-history.md).

**Assembly CSV import will not persist a partial assembly.**
`mergeAssemblies` reports `touched` (assemblies the file described components
for) and `incomplete` (assemblies with an unresolved item code). The importer
writes components only for `touched && !incomplete`. Replacing a good
assembly with a short one under-extends every takeoff that uses it.

**Item deletion warns instead of being blocked or silent.**
The FK cascade removes `assembly_items` rows, so nothing downstream can
detect the shortfall afterwards. `itemUsage()` / `assemblyUsage()` power a
pre-delete warning naming the affected assemblies and layers.

**Next 16.**
`npm audit` flagged three high-severity CVEs reachable through Next 15.
Upgrading cleared all three. The advisory assessment was historical. Re-run dependency/advisory inspection
when relevant; do not infer current vulnerability count or reachability from
this record.

**`next lint` replaced with a flat ESLint config.**
Next 16 removed `next lint`; the script had been silently broken (treating
`lint` as a directory). `eslint.config.mjs` composes
`eslint-config-next/core-web-vitals` and `/typescript`.

**Default model `claude-sonnet-4-6`, overridable via `ANTHROPIC_MODEL`.**
Both AI modules sit behind interfaces (`SymbolDetector`, `SheetAnalyzer`) so
the model or prompting strategy can be swapped without touching the UI.

**Bid-math gap knobs: where each one lands in the chain.**
Added August 26, 2026 (`0003_bid_math_gaps.sql`). Placements are commercial
conventions, chosen and documented rather than configurable: escalation on
material after waste and before tax (you pay tax on the escalated price);
labor burden as its own line on bare labor cost; small tools as % of bare
labor carried in prime; contingency as % of prime with overhead and profit
applied to it; bond as % of the final bid price via the closed form
`bid = preBond / (1 - r)` — a bond >= 100% yields Infinity and preflight
refuses the bid rather than the math guessing a cap. Sales tax on a direct
cost is opt-in per cost (`taxable`, default false) because quotes usually
arrive tax-included and silent tax would double-count; the tax follows that
cost's own O&P treatment. Every placement has a hand-calculated test in
`tests/bidmath.test.ts` and an E2E in `e2e/bidmath-gaps.spec.ts`.

**Visual language: a workbench, not a landing page.**
The UI had drifted into generic-SaaS defaults that read as machine-generated:
an eyebrow/headline/explainer triplet atop every page, uppercase letterspaced
labels on all 30-odd panel and field labels, 22 em dashes in microcopy,
sparkle iconography plus a purple `--color-ai` token for anything automated,
and content capped at 1024-1152px inside a 1440px viewport so panels floated
on a dotted void.

Chosen direction, applied September 6, 2026: sentence case everywhere with
uppercase reserved for table column headers and printed-proposal letterhead;
one heading per page and no explainer paragraph; em dashes replaced with
periods and colons except as list separators in `<select>` options and as the
empty-cell placeholder; square panel corners and a single elevated surface per
screen; grouped icon-only toolbars over rows of equal-weight labeled pills;
rate entry as a two-column table of figures rather than stacked full-width
fields. `--color-ai` (purple) became `--color-pending` (amber): the state it
actually marks is "machine-proposed, not yet accepted by an estimator", which
is a review state, not a branding opportunity.

Deliberately rejected: ReactBits and the marketing half of 21st.dev. Animated
gradient text, aurora backgrounds and splash cursors are the current signature
of generated UI, and motion decoration on a screen where a wrong number loses
a job costs credibility. The structural patterns worth borrowing from the
component-registry world are the dense ones - collapsible icon rails, command
palettes, sticky-header data grids - and those were reimplemented against the
existing hand-rolled CSS rather than pulled in as shadcn/ui dependencies.

Note that E2E specs assert on visible copy. Renaming a control means updating
its spec, or keeping the old string as the `aria-label` when the visible text
must be shorter than the accessible name (see `DataProtectionCard`'s
Download/Restore pair, where visible text stays a subset of the accessible
name so WCAG 2.5.3 still holds).

## Bid breakdown allocates exactly, and never pro-rata (September 7, 2026)

B-302 ("breakdown by system") was implemented as `bidBreakdown()` in
`src/lib/estimate.ts`. The design question was how to get from a group's
material and labor to that group's share of the **bid price**, since overhead,
profit, contingency and bond are charged on the whole bid.

The obvious answer is a pro-rata split of the bid by each group's share of
prime cost. That was rejected. Every step of `summarize()` is a percentage of
material base, labor base, or a direct cost, with no additive constant, so the
whole chain is linear: running `summarize()` on one group's own base yields
precisely that group's share of waste, escalation, tax, burden, small tools,
contingency, overhead, profit and the circular bond. The parts therefore sum
to the whole exactly, and `bidBreakdown` re-uses `summarize()` itself rather
than reimplementing an allocation.

An arbitrary pro-rata split need not equal a group's own cost treatment even
when the total reconciles. Re-running the current linear formulas on each
group preserves the group's own bases. If a non-linear term is added (a
stepped markup, capped fee, or minimum), independent group recalculation may
no longer sum to the overall bid. That requires an explicit allocation policy;
reusing summarize() alone does not guarantee additivity. The
`reconciles` flag is the tripwire: if the group shares ever fail to sum to
`summary.bidPrice`, the Summary panel and the Excel sheet both withhold the
breakdown and say so instead of showing a split that contradicts the total.

Two allocation rules follow invariant 1. A layer with no tag is reported under
"Unassigned" — never dropped, and never spread across the tagged groups, which
would move real money into a system that does not own it. Direct costs are not
layer-tagged, so they are their own group rather than being attributed to a
system by guesswork.

## September 7 planning reconciliation

The next target is installed Windows estimating with a known-job comparison
and verified recovery. The [parallel plan](18-parallel-execution-plan.md)
replaces the old GD/GA/N dispatch order; no code is implemented by this decision.

- Use Electron with bundled Next.js standalone initially. Static export is
  deferred because dynamic local project IDs and POST APIs require changes.
- Keep the existing .voltline.json import format; extend formats only for a
  measured size/streaming need, with backward compatibility.
- Establish typed storage/AI seams before parallel workers diverge. Include
  compound operations that bypass the query factory today.
- SQLite row changes and outbox records commit together before saved is
  acknowledged. File publication and backup are separate failure boundaries.
- Treat cloud sync as follow-on work; distinguish local saves, backups, and
  cloud receipts. Do not promise absolute data-loss prevention.
- Separate implementation, verification, and estimator acceptance. No time
  estimate or model-specific approval gate substitutes for evidence.
