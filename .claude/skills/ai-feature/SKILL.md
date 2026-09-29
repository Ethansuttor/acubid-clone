---
name: ai-feature
description: Change Voltline local symbol detection, optional AI crop verification, sheet analysis, or explicitly assigned AI review features. Preserve pending quantities, bounded transport, private-key isolation, and honest evaluation.
---

# Detection and AI review

Read [track V](../../../.ai/17-autocount-accuracy-plan.md) and
[invariants](../../../.ai/04-invariants.md). Coordinate shared pipeline and
transport edits with D3 under the [parallel plan](../../../.ai/18-parallel-execution-plan.md).

The current default locates symbols with local worker matching. Provider
verification is optional and bounded; the old whole-tile LLM path is legacy.
Inspect SymbolSearch.tsx, pipeline.ts, local.ts/ncc.ts, and the review wrapper
before changing code. Do not assume orchestration still lives in AutoCount.tsx.

## Review and errors

All automated candidates remain pending until human confirmation. Only
confirmed takeoffs affect quantity. Sheet metadata/calibration is proposed,
explicitly applied, and undoable. New scope/quote features inherit this
review boundary.

Local similarity scores are not probabilities. Preserve candidates when
provider responses are absent, malformed, negative, or failed; do not silently
delete local results based on AI judgment. Local-only mode makes zero requests.
Cancellation adds no unfinished partial result.

Retain current verification limits: 48 crops/run, 12/request, 256x256 maximum
crop size and 2 MB request. Validate responses against requested IDs and bound
input before expensive work. Keep coordinate transforms and matching pure
where possible and unit-test seams/edges/rotations.

## Provider boundary

Use the existing SymbolDetector, SymbolVerifier, and SheetAnalyzer contracts.
Provider SDK imports live in privileged provider modules, including verify.ts;
none belong in a client bundle. Browser keys remain server-side; desktop keys
remain in a privileged process with no renderer key-read command.

Both web API routes reject production requests today. Keep the development
bypass gated. A desktop transport is separate from hosted authentication.
Verify actual model availability for authorized live work; do not invent
model names or initiate paid sweeps from historical prompts.

## Evidence

Synthetic correctness, mocked API behavior, live provider results, and
real-plan acceptance are different evidence. Reproduce failures before tuning.
Retain the thin/sparse/faint/seam regressions and measure count-plus-review
time, not only matcher throughput. Use project-level holdouts and independent
labels for real accuracy claims.

Test pending/accept/reject/undo/save/reload with the actual worker path and
mocked provider behavior where needed. Report real data or credentials that
are unavailable without blocking independent local work.
