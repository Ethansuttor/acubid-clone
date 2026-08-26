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

**Bid order: waste → tax → material total; labor factor → labor cost; prime
(incl. O&P-applicable direct costs) → overhead → subtotal → profit → plus
at-cost items → bid.**
Tax applies after waste because you buy the waste. Labor factoring adjusts
hours, not the rate, because that is how estimators reason about conditions.
Direct costs are split by an explicit per-item flag rather than a global
rule, because whether O&P applies to a sub quote is a commercial judgement.

**Direct costs marked "at cost" are added after profit.**
So they are carried through at face value. The E2E asserts the invariant by
toggling one item and checking the bid moves by exactly
`amount × (1+OH) × (1+profit) − amount`.

**The active client is intentionally local-only.**
`LOCAL_ONLY = true` and the client factory always returns the localStorage
adapter. The hardcoded username `1` with an empty password is a temporary
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
Upgrading cleared all three. Two moderate advisories remain via
`exceljs → uuid`; the only offered fix is downgrading exceljs, and the flaw
is in a uuid code path exceljs does not use.

**`next lint` replaced with a flat ESLint config.**
Next 16 removed `next lint`; the script had been silently broken (treating
`lint` as a directory). `eslint.config.mjs` composes
`eslint-config-next/core-web-vitals` and `/typescript`.

**Default model `claude-sonnet-4-6`, overridable via `ANTHROPIC_MODEL`.**
Both AI modules sit behind interfaces (`SymbolDetector`, `SheetAnalyzer`) so
the model or prompting strategy can be swapped without touching the UI.
