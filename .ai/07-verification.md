# How to verify

Run these before claiming anything works. Report what actually happened,
including failures and their output.

```sh
npm test                # 169 unit tests, 10 files (~1s)
npx tsc --noEmit        # typecheck
npm run lint            # eslint flat config
npx playwright test     # 8 E2E tests in 7 specs  (~31s)
npx next build          # production build
```

The E2E config starts its own dev server on port 3100 in local mode and uses
the pre-installed Chromium at `/opt/pw-browsers/chromium`.

## The fixture project — the ground truth

`tests/fixtures/fixture-project.ts` is a small hand-calculated bid. Every
figure in it was worked out by hand and is asserted line by line. When you
change estimating math, this is what tells you whether you broke it.

Sheet scale: 200 PDF units = 20 ft, so **0.1 ft per unit**.

Takeoff:
- 8 receptacle assemblies (`A-REC`) — plus one **pending** AI detection that
  must not count
- 4 troffers (direct item link)
- lighting wire: 1200 units → **120 FT**
- feeder EMT: 400 + 150 units = 550 units = 55 ft, `rise_drop_ft` 5 → **60 FT**

`A-REC` expands per each into: 1 duplex ($2.85 / 0.20 hr), 1 plate
($0.55 / 0.05), 1 box ($3.10 / 0.25), 1 mud ring ($1.85 / 0.06),
6 FT of ½" EMT ($0.68 / 0.032), 18 FT of #12 ($0.18 / 0.008).

Expected:

| | |
|---|---|
| Material (extended) | **$566.16** |
| Labor (extended) | **13.528 hr** |
| `W-12` rollup across assembly + direct run | 264 FT → $47.52 |
| At $95/hr, 12% OH, 10% profit | labor $1,285.16 · prime $1,851.32 · OH $222.1584 · subtotal $2,073.4784 · profit $207.34784 · **bid $2,280.82624** |

With waste 5%, tax 8.25%, labor factor +15%, a $12,000 quote (O&P applies)
and an $850 permit (at cost): **bid $18,247.62099152**.

Adding every remaining markup on top of that — escalation 3% of the material
total, labor burden 32% and small tools 2% of labor cost, contingency 5% of
prime cost, the $12,000 quote flagged taxable, and a bond at 1.2% of the bid
price — gives **bid $21,329.11971991182** (bond $255.94943663894). The full
line-by-line hand math is in the header of `tests/bidmath-markups.test.ts`.

Every one of those terms is zero by default, and at zero the figures above are
unchanged — `tests/bidmath-markups.test.ts` asserts that too.

## Rules for changing the math

1. **Do the arithmetic by hand first**, then write the assertion, then run it.
   Twice during this project a test expectation was wrong and the app was
   right — the fixture caught it both times.
2. Assert to 8+ decimal places. `money()` rounding is display-only.
3. If you add a bid-math term, add a case where it is zero and prove the
   fixture's original numbers are unchanged.
4. New estimating behaviour needs a unit test **and** an E2E that drives it
   through the real UI. Unit tests prove the math; E2E proves it is wired up.

## Writing E2E tests

`e2e/helpers.ts` gives you `signIn`, `clickPdf` (viewer coords → screen), and
`waitSaved`. `window.__ws` is the store; `window.__voltview` is the canvas
transform.

- Prefer `data-testid` over positional selectors. Two specs broke when panels
  gained inputs and indices shifted.
- The AI specs mock `/api/autocount` and `/api/sheetinfo` with `page.route`,
  because there is no API key in the dev environment.
- Sheet-analysis and auto-count both require a **count** layer to be the
  active layer; clicking a layer row makes it active.
- Numeric cells render formatted (`1,250.00`), so match the formatted string.

## What is NOT verified

Both AI features have only ever run against mocked responses. Real-world
detection accuracy, title-block reading, tiling behaviour on large sheets,
and cost per sheet are **unknown**. Say so rather than implying otherwise.
