---
name: ai-feature
description: Add or change an AI-powered feature in Voltline — symbol auto-count, sheet/title-block analysis, or a new one such as spec reading, scope gap audit, addendum diff, or quote leveling. Covers the SymbolDetector/SheetAnalyzer module boundary, the mandatory human review queue, prompt and parsing discipline, and the server-only API-key rule.
---

# Adding an AI feature

Every AI feature here touches a number the estimator signs their name to.
The discipline below is what makes the existing ones trustworthy; a new one
inherits all of it.

## 1. Nothing reaches the bid unreviewed

This is non-negotiable.

- **Auto-count** writes detections with `status: "pending"`, `source: "ai"`.
  Only `status === "confirmed"` counts — `countableTakeoffs` is an allowlist.
- **Sheet analysis** returns *proposals*; applying one is an explicit click
  and is undoable.

A new feature must land its output in a reviewable state, not in the
estimate. For a scope audit that means proposed findings the estimator
accepts; for quote leveling, extracted lines they confirm before pricing.

Make review **fast**, or it won't be used: keyboard-driven, bulk accept with
spot rejection. Auto-count uses `←`/`→`, `Y`, `N`, `Shift+A`, `Shift+R`.

## 2. Keep the model behind an interface

Existing boundaries, both in `src/lib/`:

```ts
interface SymbolDetector {           // autocount/types.ts
  readonly model: string;
  detectInTile(templatePng, tilePng, hint): Promise<Detection[]>;
}

interface SheetAnalyzer {            // sheetai/types.ts
  readonly model: string;
  analyzeSheet(pngDataUrl): Promise<SheetInfo>;
}
```

Follow the same shape:

- `types.ts` — the interface and its data types
- pure helpers (`tiling.ts`, `dedupe.ts`, `scale.ts`) — **no model, no I/O,
  fully unit-tested**
- `claude.ts` — the only file importing `@anthropic-ai/sdk`; prompt and model
  choice isolated here. Default `claude-sonnet-4-6`, `ANTHROPIC_MODEL`
  overrides.

The route types its instance as the interface, so swapping providers is one
constructor line with zero UI impact.

## 3. Put the hard part in a pure, tested function

The risky logic is never the API call — it's what surrounds it:

- tiling with overlap so a symbol on a seam is whole in some tile
- cross-tile deduplication (greedy NMS by IoU and centre distance)
- **parsing model output**, which must tolerate prose, code fences, and
  malformed entries, and drop what it cannot read

`parseDrawingScale` is the cautionary tale: it read a sheet size as an inches
term and returned a scale 3× too long, which would have mis-measured every
run on the sheet. It now requires explicit markers and returns `null` on
ambiguity. See `.ai/06-bug-history.md`.

**Reject rather than guess.** Returning nothing is cheap; returning a
plausible wrong number is what loses a bid.

## 4. Server-only key

`ANTHROPIC_API_KEY` is read **only** in `src/app/api/*/route.ts`. The SDK is
imported only by `lib/*/claude.ts`, imported only by routes. No client
component may import them.

Route checklist (copy the existing two):
auth check → API-key check with a clear 503 → body-size cap → validate and
bound the input count → bounded-concurrency fan-out (4) → isolate per-item
failures so one bad tile doesn't fail the batch.

The local-mode auth bypass must stay gated on `NODE_ENV !== "production"`.

## 5. Tell the user what the model actually said

The sheet-analysis dialog shows the raw scale text beside the derived
calibration, and warns that the derivation assumes a true-size plot. Surface
the evidence, not just the conclusion — the estimator can only exercise
judgement over something they can see.

## 6. Test it without an API key

There is no key in the dev environment. Unit-test the pure parts exhaustively;
in E2E, mock the route with `page.route` and assert the review semantics —
that pending output counts for nothing, that accepting flows into the
estimate, that rejecting doesn't, and that it's all undoable. See
`e2e/phase4-autocount.spec.ts` and `e2e/phase7-sheetai.spec.ts`.

Then say plainly that live accuracy is unverified until run against a real
plan set with a real key.
