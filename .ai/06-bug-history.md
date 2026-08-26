# Bugs found and fixed

Regression memory. Each of these shipped, was caught by an independent audit
or a test, and is now covered. **Read this before touching a parser or the
estimate math** — the traps are already mapped.

Ranked by what they would have cost on a live bid.

---

## 1. Drawing-scale parser accepted title-block noise (money: very high)

`1/8" = 1' 24X36` parsed the sheet size as the inches term and returned
**24 ft per inch instead of 8** — three times long on every linear and area
quantity on that sheet. Also: `1-1/2" = 1'-0"` matched only the `1/2` (3×
long); `2-1/2"` was 5× long; `1/4" = 1'-99"` accepted 99 inches; `REV 3 = 1'`
parsed as a scale; two printed scales silently took whichever came first.

**Fix:** paper side must carry an inch marker or be a fraction; a trailing
inches term must carry its own marker; inches ≥ 12 rejected; `null` when a
string yields two different scales; mixed numbers (`1-1/2`) parse as whole +
fraction. Covered by 32 tests in `tests/scale.test.ts`.

## 2. Uncalibrated takeoff vanished from Summary and Excel (money: very high)

Objects on a sheet with no scale contributed 0 and raised nothing, so an
entire feeder scope could be absent from the delivered bid with no warning.
The Estimate tab had a separate warning; the Summary tab and the export had
nothing.

**Fix:** `uncalibrated` is now a first-class issue with `severity: "missing"`,
raised in `extendEstimate` from `LayerQuantity.unmeasured`, and rendered in
all three surfaces.

## 3. Assemblies silently under-extended (money: high, recurring)

Three separate paths produced no money for a layer that carried real
quantity: a link to a deleted item, an assembly with no components, and — the
worst — an assembly whose component item was deleted, which still emitted
lines but **short**. The bid looked plausible and was wrong.

**Fix:** `extendEstimate` returns issues for all of them. Because the FK
cascade means a deleted item takes its component rows with it (so the
dangling state is undetectable afterwards), item deletion now warns up front
via `itemUsage()`.

## 4. Assembly CSV import destroyed good component lists (money: high)

An import naming one unknown item code produced a short component list, and
the importer called `setAssemblyItems` (delete-all-then-insert) with it —
replacing a correct assembly with a partial one. A component-less row emptied
an assembly outright.

**Fix:** `mergeAssemblies` reports `touched` and `incomplete`; the importer
persists only fully-described assemblies. The E2E asserts both the refusal
and the recovery after fixing the file.

## 5. Unterminated quote swallowed the rest of a CSV (money: medium-high)

`A,"unclosed,EA,1,1\nB,Good,EA,2,2` parsed as one giant cell: row B silently
disappeared and row A imported at $0, with zero errors reported.

**Fix:** `parseCsv` returns `{rows, unterminatedQuote}` and both importers
report it. Short rows are rejected too, instead of importing at $0.

## 6. Money inputs truncated or zeroed (money: high per occurrence)

`AmountCell` used `parseFloat` after stripping only `$` and `,`, so typing
`12 000` for a switchgear quote committed **$12**, and unreadable text
committed `0`. A gear quote is often the largest line on a bid.

**Fix:** one shared `parseNumericInput` used by every numeric field. Returns
`null` for unreadable input; callers keep the previous value. A comma that is
not a thousands separator (`3,5`) is unreadable rather than becoming `35`.

## 7. Percent typed as a fraction (money: ~10% of the bid)

`0.12` meaning 12% was accepted silently and bid ~10% low.

**Fix:** percent fields show an inline hint when the value is between 0 and 1.

## 8. `$NaN` in the UI, a number in Excel (money: confusing rather than costly)

A project row predating the bid-math columns yielded `undefined/100 = NaN`;
the UI rendered `$NaN` while the export used `?? 0` and showed a plausible
figure — the two disagreed.

**Fix:** `summarize()` coerces every non-finite input to 0 for stable rendering,
and bid preflight independently inspects raw commercial/layer/catalog inputs so
that sanitization cannot make an invalid bid look ready to issue.

## 9. Viewer bugs (money: none, usability)

Wheel zoom never attached when a project mounted with no sheets (dead until
reload). Panning moved at half mouse speed from a stale-closure branch that
overwrote the correct client-delta pan.

## 10. Excel Summary styling off by one row

Setting `sum.columns` with empty headers made ExcelJS emit a blank header
row, shifting every styled row down — the gold BID PRICE style landed on the
Profit row. Values were always correct.

## 11. Corrupt local tables loaded as plausible empty data (money: critical)

`localdb.loadTable()` caught JSON parse failures and returned `[]`. A damaged
items, layer, or takeoff table could therefore look like a valid low/empty
estimate instead of a load failure.

**Fix:** table parsing now throws on invalid JSON or non-array JSON. The query
adapter returns the error and the workspace's atomic loader fails closed.

## 12. Project deletion left bid data and plan bytes behind (privacy/storage)

The local cascade omitted `direct_costs`, `bid_snapshots`, and uploaded PDF
bytes, so deleting a project did not delete the whole local project.

**Fix:** project/document cascades remove those rows and the corresponding
local plan blob. Unit coverage asserts every project-owned table is empty.

## 13. Failed plan metadata could leave an orphaned upload (storage)

Plan bytes were uploaded before document and sheet rows were inserted. If a
later insert failed, the PDF or partial document remained in localStorage.

**Fix:** local storage implements `remove()`. A failed document insert removes
the upload; a failed sheet insert deletes the document, which cascades any
partial sheet rows and the PDF bytes.

---

## Security fixes

- The temporary local bearer token in both API routes is accepted only when
  `NODE_ENV !== "production"`; production fails closed until real server
  authentication exists.
- Both routes cap request bodies (48 MB) instead of accepting unbounded
  base64 image payloads.
- Next 15 → 16 cleared three high-severity CVEs.

## Known and accepted

- Two moderate advisories from `exceljs → uuid`; not reachable in our usage.
- A half-size plot (a drawing printed at 50%) is undetectable from the scale
  text alone. The sheet-analysis dialog says to spot-check a known dimension.
- `/UserUnit ≠ 1` PDFs would break the 72-units-per-inch assumption. Rare at
  architectural sheet sizes.
- Self-intersecting area polygons give the shoelace net area. Standard.
