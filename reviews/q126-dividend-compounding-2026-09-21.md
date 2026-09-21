# Q-126 — buy-and-hold dividends now compound

**Migration note**, per `CLAUDE.md` FORBIDDEN: *"Silently changing a calculation
without a migration note and a regression test."* Tests:
`__tests__/backtest/dividendCompounding.test.ts`.

## What was wrong

All four reinvestment sites did:

```ts
shares += dividend / close      // buys the distribution on ONE share
```

That reinvests a single share's dividend however many shares are held, so only
the first distribution ever compounded. Correct is `shares *= 1 + dividend/close`.

Three bars at 100 with a dividend of 10 on each of the last two returned **20%**
where reinvesting both yields **21%** (`1.1 × 1.1 − 1`).

**Why it survived:** with a *single* distribution the two formulas agree exactly,
because `shares` is still 1. The bug is invisible until the second dividend —
and it is asserted as a control in the new suite.

## The vendor-semantics precondition, which the audit asked to be rechecked

Reinvesting cash is only correct if the price series is **not** already
total-return adjusted. Verified: `scripts/fetchBacktestData.mjs:164-191` calls
`yf.chart()` and takes **`q.close`, not `q.adjclose`** — split-adjusted, not
dividend-adjusted — and attaches each cash dividend to its ex-date bar as a
separate `dividend` field (20 such bars for AAPL). So this reinvests cash that
is genuinely not in the price. No double count.

## Measured impact — and it moves against the strategy

| | before | after |
|---|---|---|
| `portfolio.bnhAvg` | 1.150281 | **1.161278** |
| `portfolio.alpha` | −1.116943 | **−1.127941** |
| mean `bnhReturn` | 1.133437 | 1.141312 |
| mean `excessReturn` | −1.100100 | −1.107974 |
| `avgReturn`, `winRate`, `profitFactor` | unchanged | unchanged |

**50 of 56 instruments moved.** The strategy's own numbers are untouched — this
is the benchmark side only.

**The correction makes the platform look WORSE.** A correctly compounded
buy-and-hold is a higher bar, so alpha falls by 1.1pp and excess return with it.
That is the direction worth trusting: the previous number flattered the strategy
by under-crediting the comparator it is measured against.

`npm run benchmark` exit 0, edge over base **+1.59pp**, unchanged — the label
pipeline never calls these engines, so no CI-gated number moved.

## A fourth defect-ratifying test, and this one was named for the job it failed

`excessReturnWindow.regression.test.ts` carried a helper called
`holdFromWarmup` under a test named **"agrees with an independent oracle,
dividends included"**. Its oracle reinvested `d / close` — *the same formula as
the implementation it was checking*. It agreed with the bug for as long as the
bug existed.

**An oracle that reproduces the implementation's arithmetic is not an oracle.**
It is the implementation, typed twice.

The golden constants in `aggregatePortfolio.golden.test.ts` were likewise
recomputed from a ledger written independently of `core.ts`, not read back out
of the new implementation:

| | old | new |
|---|---|---|
| `bnhReturn` | 0.456647 | 0.457114 |
| `bnhCurve[0]` | 234.423281 | 234.673547 |
| `bnhCurve[50]` | 287.271853 | 287.699760 |
| `bnhCurve[179]` | 339.263227 | 340.244837 |

Deriving those took two attempts: the first ledger mis-modelled the curve's
indexing (the loop pushes at `i = W` as well as the pre-loop mark, so
`bnhCurve[k≥1]` tracks `rows[W+k−1]`, and `curve[0]` is duplicated at
`curve[1]`). The mismatch at `[50]` while `[0]` matched is what exposed it.

## What this does NOT do

- Reinvestment is at the **ex-date bar's close**, with no tax, no
  fractional-share limit and no execution cost. A convention, not a claim about
  what a real holder received.
- **`Q-125` remains open**: the STRATEGY still never receives dividends on
  shares it holds, while this benchmark does. The accounting stays asymmetric
  and this change widens that asymmetry. The vendor-semantics recheck above is
  the precondition Q-125 was waiting on, and it is now satisfied.
