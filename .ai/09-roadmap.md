# Roadmap

Full reasoning and ranking:
<https://claude.ai/code/artifact/4e86204c-1fa7-494e-b3f0-5f08efa1ca83>

Grouped like a drawing set, because these are four different jobs with four
different payoffs.

## S — Scope & risk (highest value in the product)

| Ref | Feature | Why |
|---|---|---|
| S-101 | **Spec book reader** — extract scope-bearing requirements from Division 26 | Spec requirements the drawings never show are the classic post-award surprise |
| S-102 | **Scope gap audit** — cross-check takeoff against sheet index, legend and spec | Catches whole missing systems before submission |
| S-103 | **Addendum diff** — what changed between revisions, and which takeoff objects sit in changed regions | Addenda land days before bid day when attention is thinnest |
| S-104 | **RFI drafter** | Questions asked before bid are free |

## T — Takeoff speed

| Ref | Feature | Why |
|---|---|---|
| T-201 | **Legend → layers** — read the symbol legend, create a pre-linked layer per symbol | Removes the setup tax; symbol-to-item mapping becomes a one-time job |
| T-202 | **Count everything in one pass** — every legend symbol across every sheet, review queue grouped by symbol | Turns AI counting from a per-symbol tool into how takeoff starts |
| T-203 | **Circuit derivation** — from a run, derive conductors, terminations, boxes, fittings, supports | This is Accubid's actual moat |
| T-204 | Detail callout links | Removes the hunt through a 40-sheet set |

## B — Bid & output

| Ref | Feature | Why |
|---|---|---|
| B-301 | **Alternates & scenarios** | Nearly every job asks; cheap now because the math is a pure function |
| B-302 | **Breakdown by system** (lighting/power/FA/data/feeders/gear) | Required for bid leveling and scope letters |
| B-303 | **Quote leveling** — extract and compare supplier quotes | The largest numbers on the bid, compared by hand on bid day |
| B-304 | Proposal & scope letter with inclusions/exclusions | An exclusions list built from the actual estimate is defensible |
| B-305 | Change order pricing | Keeps the estimate useful past bid day |

## O — Operations & trust

| Ref | Feature | Why |
|---|---|---|
| O-401 | **Actuals feedback loop** — import job costs, suggest per-item labor corrections | The compounding advantage nobody can buy off a shelf |
| O-402 | Bid versions & audit trail | Defensibility when a bid is questioned later |
| O-403 | Ask the estimate (natural-language queries) | Replaces the pivot-table detour in the last hour |
| O-404 | Multiple estimators | Decides whether this stays personal or becomes the company's |

## If you build three things

1. **S-102 scope gap audit**, fed by S-101. Everything else makes you faster
   at work you know you have; this tells you about work you didn't know was
   in the job. Hold it to the review-queue rule — it proposes findings, the
   estimator accepts them.
2. **T-201 + T-202**, legend to counted set in one pass. The demo that makes
   the old tool unusable, and both halves are close to what already works.
3. **B-301 alternates.** The most common thing a real bid needs that the app
   cannot express today.

## Bid-math gaps a real estimator will hit

Flagged by audit; each is small and worth doing before the big features:

- **Labor burden** (payroll tax, insurance, fringe) as its own line — today it
  must be baked into `$/hr` with nowhere to show a reviewer.
- **Sales tax on quotes** — tax currently applies only to takeoff material; a
  $12,000 gear quote gets no tax line and no "tax included?" flag.
- **Bond as a percentage of bid price** (the standard circular calculation) —
  bonds exist only as a fixed-dollar direct cost.
- **Small tools / consumables** (typically 1–3% of labor), **contingency**,
  **escalation**.
- **Exclusion tracking**, to prevent double-counting scope a quote covers.
