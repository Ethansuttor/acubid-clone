# Electrical estimating, for an assistant who isn't an estimator

Do not guess this vocabulary. A plausible-sounding wrong assumption here
becomes a wrong number on a bid.

## The workflow this app models

1. A general contractor issues a **bid set**: a multi-sheet PDF of drawings
   plus a written **specification** (Division 26 is the electrical division).
2. The estimator does **takeoff** — measuring and counting everything the
   electrical scope requires, off the drawings.
3. Each counted thing is priced from an **item database** and extended into
   **material cost** and **labor hours**.
4. Labor hours become money at a **labor rate**. Overhead and profit are
   applied. Non-takeoff costs (equipment quotes, permits) are added.
5. The result is the **bid price** submitted to the GC.

## Terms

**Takeoff** — measuring/counting scope off drawings. Three shapes, which is
why the app has exactly three tools:
- **Count** — discrete devices (receptacles, fixtures, switches). Unit `EA`.
- **Linear** — runs of conduit, wire, cable tray. Unit `FT`.
- **Area** — floor areas, often for allowances. Unit `SF`.

**Scale / calibration** — drawings are printed to a scale such as
`1/4" = 1'-0"`, meaning a quarter inch of paper is one real foot. To measure
anything, the app must know how many real feet one PDF unit represents. The
user establishes this by clicking two points and typing the real distance
between them. `src/lib/sheetai/scale.ts` can also derive it from the printed
scale text — see the warnings there.

**Item** — one purchasable/installable thing, with a material cost per unit
and a **labor unit**.

**Labor unit** — the hours to install one unit of an item. This is the heart
of estimating. Published databases (NECA, Accubid) sell these; this app
deliberately makes the user own theirs, because a database tuned to the
contractor's own crews is more accurate than a purchased one.

**Assembly** — a named bundle that expands into component items. Taking off
one "20A duplex receptacle" pulls in the device, plate, box, mud ring,
fasteners, and allowances for conduit and wire. Assemblies are what make
takeoff fast and consistent; the estimator counts one symbol, not six parts.

**Extension** — multiplying quantity by unit cost and unit labor to get
extended cost and extended hours. The arithmetic core.

**Rise/drop** — a conduit run measured on a plan is only the horizontal
distance. The real run also goes up the wall and down again. Estimators add a
fixed allowance per run. Modelled as `rise_drop_ft` on a linear layer, added
**once per takeoff object**, not per foot.

**Typical** — a floor plan that repeats. Taking off one and multiplying is
standard practice. Modelled as `typical_multiplier` on a layer.

**Waste / loss factor** — a percentage added to material because wire gets
cut, fittings get dropped, and stock comes in fixed lengths.

**Labor factoring** — a percentage adjustment to labor hours for job
conditions: work above 10 feet, occupied buildings, night shifts, congested
ceilings. Can be negative for favourable conditions. Adjusts **hours**, not
the rate.

**Prime cost** — material + labor before overhead and profit.

**Overhead (O/H)** — the contractor's cost of being in business, as a
percentage. **Profit** — margin on top. Together, **O&P**.

**Direct job costs** — real costs that don't come from takeoff: switchgear
and lighting-package **quotes** from suppliers, **subcontractors** (fire
alarm, controls), **equipment** rental (lifts), **permits**, **bonds**.
Whether O&P applies to each is a commercial judgement, which is why it is a
per-item flag in this app rather than a global rule.

**Addendum** — a mid-bid revision issued by the GC. Sheets get reissued days
before bid day. Missing an addendum change is a classic way to lose money.

**RFI** — Request For Information. A formal question to the GC about an
ambiguity. Asked before bid it is free; asked after award it is a fight.

**Homerun** — the conduit/wire run from a device back to the panel.

**Bid leveling** — the GC comparing bids. Needs a breakdown by system, which
is why per-system reporting is on the roadmap.

## Units the app understands

`EA` (each), `FT` (linear feet), `SF` (square feet). `src/lib/estimate.ts`
normalises common spellings (`EACH`, `LF`, `SQFT`) and warns when a layer's
tool disagrees with its item's unit — a count layer priced per foot is
arithmetically valid and commercially wrong.

## Things that are NOT modelled yet

Be honest about these rather than inventing behaviour:
labor burden (payroll tax, insurance, fringe) as its own line; sales tax on
quotes; bond as a percentage of the bid; small tools/consumables; escalation;
contingency; crew mix and hours-to-duration; per-system recap; exclusion
tracking. See [`09-roadmap.md`](09-roadmap.md).
