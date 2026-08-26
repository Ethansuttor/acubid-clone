---
name: voltline-verify
description: Verify a change to Voltline actually works before reporting it as done — run the unit tests, typecheck, lint, Playwright E2E, and production build, and drive the real UI when a change has a visible surface. Use before committing, before claiming something works, and when writing a new E2E test.
---

# Verifying Voltline

Run all five. Report what actually happened, including failures and their
output. Never describe unverified work as done.

```sh
npm test                # 149 unit tests, 8 files  (~1s)
npx tsc --noEmit        # typecheck
npm run lint            # eslint flat config
npx playwright test     # 7 E2E specs             (~30s)
npx next build          # production build
```

If `vitest: not found`, `node_modules` was pruned between sessions — run
`npm install`.

## What each one catches

- **Unit tests** — the arithmetic. Anchored to a hand-calculated fixture
  (`tests/fixtures/fixture-project.ts`); see `.ai/07-verification.md` for its
  expected figures.
- **Typecheck** — the honest one when you change a shared type. Changing
  `extendEstimate`'s return type is how every stale call site got found.
- **Lint** — the flat config surfaces React Compiler errors (`next lint` was
  removed in Next 16 and the old script silently did nothing).
- **E2E** — proves the math is actually wired to the UI. Unit tests alone
  have passed while a feature was unreachable.
- **Build** — catches server/client boundary mistakes that dev mode tolerates.

## E2E notes

The config starts its own dev server on port 3100 in local mode
(`NEXT_PUBLIC_LOCAL_MODE=1`) and uses the pre-installed Chromium at
`/opt/pw-browsers/chromium`. Never run `playwright install`. Egress to
`supabase.co` is blocked in this sandbox, which is why local mode exists.

`e2e/helpers.ts` provides `signIn`, `clickPdf` (viewer coords → screen),
`waitSaved`. `window.__ws` is the Zustand store; `window.__voltview` is the
canvas transform.

When writing a spec:

- **Use `data-testid`, not positional selectors.** Two specs broke when panels
  gained inputs and `nth(2)` shifted.
- Mock `/api/autocount` and `/api/sheetinfo` with `page.route` — there is no
  `ANTHROPIC_API_KEY` in the dev environment.
- Auto-count and sheet analysis need a **count** layer active; click a layer
  row to activate it.
- Numeric cells render formatted (`1,250.00`) — match the formatted string.
- Put the hand math in a comment at the top of the spec, as the existing
  specs do.

## Driving the UI directly

When a change has a visible surface that no spec covers, write a throwaway
spec in `e2e/zz-tmp-*.spec.ts`, run it, and **delete it afterwards** — one
was accidentally committed once. Do not leave probe files behind.

## Before you report

Say plainly what passed, what failed, and what you did not check. Both AI
features have only ever run against mocked responses, so their real-world
accuracy is unknown — do not imply otherwise.
