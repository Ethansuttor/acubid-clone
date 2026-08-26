# `.ai/` — context pack for an AI working on Voltline

This directory exists so a fresh assistant session can be productive in
minutes without re-reading the whole codebase or re-deriving decisions that
were already made and paid for.

**Read in this order. Stop when you have enough for the task in front of you.**

| File | Read it when |
|---|---|
| [`00-START-HERE.md`](00-START-HERE.md) | Always. Five minutes, whole picture. |
| [`01-product.md`](01-product.md) | You need to know what this is and who it's for. |
| [`02-domain.md`](02-domain.md) | **Before touching estimating logic.** Electrical-estimating vocabulary. |
| [`03-architecture.md`](03-architecture.md) | You're about to change code. Module map and data flow. |
| [`04-invariants.md`](04-invariants.md) | **Before any change to money, quantity, or AI output.** Non-negotiables. |
| [`05-decisions.md`](05-decisions.md) | You're wondering "why is it done this odd way?" |
| [`06-bug-history.md`](06-bug-history.md) | **Before changing parsers or estimate math.** Bugs already found and fixed. |
| [`07-verification.md`](07-verification.md) | You're about to claim something works. |
| [`08-environment.md`](08-environment.md) | Something won't run, connect, or authenticate. |
| [`09-roadmap.md`](09-roadmap.md) | You're deciding what to build next. |

## The one-paragraph version

Voltline is a working electrical-estimating and on-screen-takeoff web app —
a replacement for Trimble Accubid (estimating) and LiveCount (takeoff) for a
single practising estimator, plus AI features neither has. It is used on live
bids, so **the arithmetic is the product**. A wrong number that looks
plausible is the worst possible failure, worse than a crash. Everything in
[`04-invariants.md`](04-invariants.md) exists to prevent that.

## How to keep this pack useful

When you finish a meaningful piece of work, update the file it affects —
a new decision goes in `05`, a bug you fixed goes in `06`, a new module goes
in `03`. Treat these as source files, not documentation debt. If something
here contradicts the code, **the code is right and this file is a bug**:
fix it in the same commit.
