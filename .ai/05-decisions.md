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

**Bid order: waste → tax → material total → escalation; labor factor → labor
cost → burden → small tools → labor total; prime (incl. O&P-applicable direct
costs and their tax) → contingency → overhead → subtotal → profit → plus
at-cost items → bond → bid.**
Tax applies after waste because you buy the waste. Labor factoring adjusts
hours, not the rate, because that is how estimators reason about conditions.
Direct costs are split by an explicit per-item flag rather than a global
rule, because whether O&P applies to a sub quote is a commercial judgement.
The full chain, with the base each percentage uses, is in `summarize()` and in
the `estimating-math` skill.

**Every percentage names its own base, in the field label.**
`Labor burden (% of labor cost)`, `Escalation (% of material total)`,
`Contingency (% of prime cost)`, `Bond (% of the bid price)`. Which base a
markup uses is the part an estimator cannot recover from the resulting number,
and two houses do it differently — so the app states its choice on screen and
in the export instead of hiding it. Specifically:

- **Burden and small tools are charged on bare labor cost** (hours × rate),
  not on each other and not on burdened labor. Burden exists as its own line
  so it can be shown to a reviewer; before this it had to be baked into `$/hr`
  with nowhere to display it. `laborTotal` is the sum the bid carries.
- **Escalation is charged on the material total**, and is named "material
  escalation" for that reason. Labor escalation is expressible through the
  labor rate and the labor factor, so it is not a second hidden term.
- **Contingency is a cost, so overhead and profit are charged on it.** It sits
  between prime cost and overhead.
- **Sales tax on a direct cost follows that cost into its own bucket**, so a
  taxable quote marked O&P-applies has its tax marked up too, and a taxable
  at-cost item has its tax carried at cost. Tax is opt-in per row (`taxable`),
  because quotes vary in whether tax is already included.

**Bond is solved circularly, and an unsolvable rate is refused rather than
approximated.**
A bond premium is a percentage of the contract value and the bond is part of
that value, so `bid = priceBeforeBond / (1 - p)`. Outside `0 <= p < 1` that
division is meaningless, so `summarize()` adds no bond and pushes a warning
instead of emitting a plausible number.

**`bond_pct` deliberately carries no CHECK constraint.**
The database could reject a rate of 150. It would then reject the *write*
while the screen kept showing 150, and the warning would disappear on reload —
the bad input would become invisible. A persistent red banner in the Summary
tab and at the top of the Excel Summary sheet is the stronger guard, so
validation lives in `summarize()` alone.

**`summarize()` returns `warnings` separately from `extendEstimate`'s
`issues`.**
They answer different questions: `issues` mean takeoff quantity could not be
priced; `warnings` mean a markup input could not be applied as entered. They
have different audiences and different fixes, so merging them would blunt
both.

**Direct costs marked "at cost" are added after profit.**
So they are carried through at face value. The E2E asserts the invariant by
toggling one item and checking the bid moves by exactly
`amount × (1+OH) × (1+profit) − amount`.

**Installed as a PWA, not packaged as a desktop app — and deliberately no
service worker.**
The estimator wants a Windows app. `src/app/manifest.ts` plus the icons in
`public/` make Edge offer "Install this site as an app", which gives a real
window, a Start-menu entry and a taskbar icon for about an hour of work.

Electron and Tauri were both considered and deferred, and Docker rejected
outright (it packages a server, not a desktop app — the user would still open
a browser at localhost). The reason to defer is not effort: every plan set is
downloaded from the Supabase `plans` bucket (`src/lib/pdf.ts`) and auth is
Supabase, so the app is cloud-backed end to end. Wrapping that in Electron
buys a window, not independence — bid day on flaky wifi still fails. The
version worth having (plans on local disk, works offline, syncs on reconnect)
is a storage-and-sync project, not a packaging one. Tauri is a poor fit
specifically: it has no Node, so it needs `output: "export"`, which would
delete both AI API routes.

If Electron does happen later, the one thing that keeps it small is invariant
7 — `ANTHROPIC_API_KEY` is read only in the two route handlers. An Electron
renderer *is* a browser, so the key moves to the main process behind IPC.
Keep the key confined and that stays a small change.

**No service worker** is a correctness decision, not an oversight. Offline
caching would let an installed window run yesterday's estimating code against
today's bid — the exact class of quietly-wrong-number failure this codebase
exists to prevent. Installability does not require one; Chromium's
`Page.getAppManifest` reports zero errors as it stands.

**Local mode (`NEXT_PUBLIC_LOCAL_MODE=1`).**
The dev sandbox blocks egress to `supabase.co` by network policy, so E2E
could not run against the real database. Rather than mock at the component
level (which would test nothing), the swap happens at the Supabase-client
boundary, so E2E exercises the real components, store, and math. Gated on
`NODE_ENV` so it cannot weaken production.

**`SheetCanvas` is keyed by sheet id in `TakeoffView`.**
Per-sheet state used to be reset inside the page-loading effect, which React
Compiler flags and which is easy to get subtly wrong. A remount is the
idiomatic reset and deleted the reset code.

**One FIFO write queue in the store.**
Supabase builders are lazy thenables, so queueing defers the HTTP call. A
fast add→undo could otherwise have the delete land before the insert and
resurrect the row on reload.

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
