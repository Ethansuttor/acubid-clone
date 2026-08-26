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
labor hours from takeoff
  ± labor factor %          (adjusts HOURS, not the rate)
  x labor rate              = labor cost
+ direct costs flagged ohp_applies
  = prime cost
  + overhead %              = subtotal
  + profit %
+ direct costs flagged at-cost   (added after profit, never marked up)
  = BID PRICE
```

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
npm test                # unit
npx playwright test     # E2E — proves it is wired up, not just correct
```

New estimating behaviour needs both: a unit test for the arithmetic and an
E2E that drives it through the real UI. Add a zero-value case proving the
fixture's original numbers are unchanged.
