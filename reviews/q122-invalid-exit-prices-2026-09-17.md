# Q-122 — A required exit with no valid price invalidates the run, never a fill

**Worked 2026-09-17 · recovered, verified and published 2026-09-20 · decision: fail closed.**

This file existed only as a citation until 2026-09-20. `.quantlab/TRIAL_REGISTRY.jsonl`
entry `T-0011` named it in its `source` array while it was never written — a
record pointing at a document that does not exist. Written now from the work's
own evidence rather than back-dated silently, because the trial registry is the
SSOT for the research trial count and a dangling source is exactly the defect
this project's record-keeping rules exist to prevent.

## The defect

`closePosition` booked a fill at whatever `fillPrice` it was handed. On the time
exit, the engine guarded the corrupt case by **holding one more bar**:

```ts
// A corrupt next-open (0/NaN) cannot be traded: hold one more bar
// (mirrors the entry-side guard) instead of poisoning the curve.
if (Number.isFinite(nextOpen) && nextOpen > 0) { closePosition(state, nextOpen); … }
```

Holding is not a neutral fallback. It **substitutes a different holding policy**
for missing execution evidence: the position silently survives past the horizon
the strategy is defined on, the equity curve keeps going, and nothing anywhere
says the exit price was never there. That is I2's "fail closed, never fail
silent" read backwards — the run continues and looks healthy.

## The decision

Validate before mutating any accounting, and throw:

```ts
function requirePrice(price: number, context: string): void {
  if (!isFinitePositivePrice(price)) throw new RangeError(`Invalid backtest ${context} price: …`)
}
```

Rejected alternative: defer the exit and carry on. That is the incumbent
behaviour and it is the bug — it invents a holding policy from absent data.
A backtest that cannot price a required exit has not produced a worse
result; it has failed to produce a result, and must say so.

Also folded in: `finalPrice` is hoisted so the short-history stub and the
terminal valuation share one validated value, and the entry-side guard now uses
the same `isFinitePositivePrice` predicate rather than its own inline copy.

## Evidence

- **Red before green:** 38 failed / 10 passed on the incumbent, then 48 new pass;
  64 focused including 16 existing.
- **Behaviour-neutral on real data, established twice, independently.** The
  original work replayed complete serialized `BacktestResult` hashes over the
  same 56 committed histories: identical. Re-verified 2026-09-20 by running the
  canonical benchmark on the **pre-change engine** against identical data and
  diffing every scalar field: **0 of 35 differed**. The guard fires only on
  corrupt prices, and the committed universe contains none.
- **Gates:** typecheck clean; 2237 tests pass / 17 skipped; `npm run benchmark`
  exit 0.

## What this does NOT do — named, because a green run is not a proof

- It validates the **price domain**, not the **arithmetic**. Finite positive
  prices can still overflow share sizing and liquidation: `Number.MIN_VALUE` as
  an entry price yields `Infinity` shares, and `Number.MAX_VALUE` as a terminal
  close yields non-finite proceeds and `NaN` equity via `Infinity - Infinity`.
  Reproduced 2/2 on both the base and the patched engine. That is **`Q-130`**,
  deliberately left open rather than folded in.
- It validates the prices required for exits and terminal valuation, not every
  intermediate price on the path.
- No historical incidence was measured — there is no evidence this ever fired on
  real data, and the change is justified by the contract it enforces, not by a
  production incident it prevented.

## A correction to this package's own record

The `SESSION_STATE` entry written on 2026-09-17 said the work was "stacked on
`codex/q108-bridge-gate-audit`; draft PR205 remains OPEN and unmerged. No
production deployment is claimed." That was true when written. PR #205 merged
2026-09-20, this work was rebased onto `main` and published standalone, so the
stacking dependency is gone. The record is corrected in place rather than left
to read as current.
