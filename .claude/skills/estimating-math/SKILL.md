---
name: estimating-math
description: Change anything that produces a quantity, a dollar, or an hour in Voltline — bid math, extension, assemblies, rates, markups, direct costs, the Excel export, or a parser feeding them. Use when touching src/lib/estimate.ts, geometry.ts, excel.ts, csv.ts, units.ts, or sheetai/scale.ts. Covers the hand-calculated fixture, the no-silent-drop rule, and the order of operations in a bid.
---

# Changing the money

This app is used on live bids. A wrong number that looks plausible is worse
than a crash. Work in this order — do not skip step 1.

## 1. Do the arithmetic by hand first

Before writing code or a test, work the example out on paper. Then write the
assertion from your hand math, then run it.

Twice in this project a test expectation was wrong and the app was right. The
fixture caught it both times because the hand math came first. If your test
fails, suspect your arithmetic before suspecting the code.

## 2. Know where the math lives

All of it is in pure modules with no React and no I/O:

- `src/lib/geometry.ts` — one takeoff object → a real-world measurement
- `src/lib/estimate.ts` — quantities, assembly expansion, rollup, totals,
  bid summary, issue reporting

Components render results; they never calculate. `src/lib/excel.ts` formats
what these return and computes nothing of its own — that is why the Estimate
tab, Summary tab, and export can never disagree.

## 3. The pipeline

```
layerQuantities(layers, takeoffs, sheets)   -> LayerQuantity[]
  applies sheet calibration, rise/drop per run, typical multiplier
extendEstimate(quantities, items, assemblies, assemblyItems)
  -> { lines, issues }   expands assemblies into component lines
estimateTotals(lines)    -> { materialBase, laborHoursBase }
summarize({ ...totals, rates, directCosts }) -> EstimateSummary
```

## 4. The bid order (do not reorder without asking the user)

```
material from takeoff
  + waste %                 (you buy the waste)
  + sales tax %             (on material AFTER waste)
  = material total
  + escalation %            (of material total — price movement to buyout)
labor hours from takeoff
  ± labor factor %          (adjusts HOURS, not the rate)
  x labor rate              = labor cost           (bare labor)
  + labor burden %          (of labor cost — payroll tax, insurance, fringe)
  + small tools %           (of labor cost — consumables)
  = labor total
+ direct costs flagged ohp_applies, plus tax on the ones flagged taxable
  = prime cost
  + contingency %           (of prime cost — a cost, so it is marked up)
  + overhead %              = subtotal
  + profit %
+ direct costs flagged at-cost, plus their tax  (never marked up)
  = price before bond
  + bond %                  (of the BID PRICE, which includes the bond:
                             bid = price before bond / (1 - bond%/100))
  = BID PRICE
```

Every term added after the first three lines is **zero by default**, and at
zero the chain reduces exactly to the original bid. Prove that with a test
whenever you add another one.

Percentages name their own base in the UI label ("Labor burden (% of labor
cost)"), because the base is the part an estimator cannot infer from a number.

## 4b. Never silently emit a markup you could not apply

`summarize()` also returns `warnings: string[]` — problems with the *markup
inputs* rather than with takeoff quantity. Today: a bond rate outside
`0 <= p < 100` (the circular solve has no answer, so no bond is added), and a
bond charged both as a percentage and as a `bond`-category direct cost.

Same rule as quantity: it is rendered in the Summary tab and at the top of the
Excel Summary sheet in red. There is deliberately **no CHECK constraint** on
`bond_pct` — a rejected write would leave the bad rate on screen and drop the
warning on reload. See `.ai/05-decisions.md`.

## 5. Never silently drop quantity

If a layer carries takeoff quantity that cannot be priced, `extendEstimate`
must return an `EstimateIssue` for it. Kinds today: `unlinked`,
`missing-item`, `missing-assembly`, `empty-assembly`, `missing-component`,
`uncalibrated` (all `severity: "missing"`) and `unit-mismatch`
(`severity: "warning"`).

Issues render in **three** places — keep all three in sync:
`EstimateView` banner, `SummaryView` banner, top of the Excel Summary sheet.

If you add a new way for a layer to fail to price, add a matching issue kind.
An exported bid that is quietly incomplete is the worst outcome this codebase
can produce.

## 6. Other rules

- **Rounding is display-only.** `money()` rounds to cents for UI and export;
  internal math stays full precision. Assert to 8+ decimal places.
- **Geometry stays in PDF user-space units.** Quantities are derived at read
  time from the sheet calibration, so recalibrating fixes everything. Never
  persist a computed length.
- **Parsers reject rather than guess.** Return `null` / an error and let the
  caller keep the previous value. See `parseNumericInput`, `parseDrawingScale`.
- **Pending AI takeoffs never count.** `countableTakeoffs` is an allowlist of
  `status === "confirmed"`.

## 7. Verify

Read `.ai/07-verification.md` for the fixture's expected figures, then:

```sh
npm test                # 165 unit tests, 9 files
npx playwright test     # E2E — proves it is wired up, not just correct
```

New estimating behaviour needs both: a unit test for the arithmetic and an
E2E that drives it through the real UI. Add a zero-value case proving the
fixture's original numbers are unchanged.
