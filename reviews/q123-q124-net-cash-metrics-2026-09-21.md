# Q-123 / Q-124 — win rate and profit factor become exact net cash

**Migration note.** `CLAUDE.md` FORBIDDEN: *"Silently changing a calculation
without a migration note and a regression test."* This is the note; the
regression tests are `__tests__/backtest/netCashClassification.test.ts` and the
rewritten oracle in `aggregatePortfolio.golden.test.ts`.

## What changed

Both defects had one root: **win/loss and profit factor were computed from
PRICE RETURNS, in two places that did it differently.** They now come from a
single exported function, `netCashPnl()` in `lib/backtest/core.ts`, called by
both `core.ts` and `engine.ts`.

```ts
BUY : shares * (exitPrice * (1 - c) - entryPrice * (1 + c))
SELL: shares * (entryPrice * (1 - c) - exitPrice * (1 + c))
```

### Q-123 — the break-even was the wrong number

A trade counted as a win when `r > 2c`. The exit fee is charged on **exit**
notional, so exact cash profit per entry notional is `r - c*(2 + r)` and
break-even is `2c/(1-c)`. At c = 11 bps those differ by **2.42 bps**, and every
return inside that sliver was booked as a win while losing money.

Reproduced independently: 500 shares bought at 100 and sold at 100.2201 lose
**$0.071055** and were reported as a win.

### Q-124 — the two call sites disagreed

`core.ts` put a gross-positive but net-losing trade into `grossLoss`.
`engine.ts` put it into **neither** sum. The same two trades (+10%, +0.1%)
produced `profitFactor = 100` from `core` and **`Infinity`** from
`aggregatePortfolio` of that one result. Both also summed **percentages**, so a
$100 position and a $100,000 position counted equally.

## Measured impact on the committed universe

| | before | after |
|---|---|---|
| portfolio `profitFactor` | 2.9264 | **2.7827** |
| portfolio `winRate` | 0.6071 | 0.6071 |
| `avgTradeReturn` | 0.0575 | 0.0575 |
| `totalTrades` | 224 | 224 |
| `sharpeRatio` | −5.6806 | −5.6806 |

**The number that matters is not in that table.** Checking each instrument's
reported `profitFactor` against an independent net-cash oracle:

> **before: 42 of 54 instruments disagreed. After: 0.**

`winRate` is unchanged because the misclassified band is 2.42 bps wide and no
trade in the committed universe lands inside it. The fix is a correctness fix,
not a performance change — and saying so is the point: **it would have been
easy to present an unchanged win rate as evidence the bug was not real.**

`avgTradeReturn` is deliberately unchanged: it is the raw price move, by design.

### Unchanged, and verified: the benchmark

`npm run benchmark` exit 0, edge over base **+1.59pp**, identical to before.
The label pipeline never calls these engines (`invariants-baseline.md` §1b), so
the CI floors are untouched. This change moves no gated number.

### Seven instruments still report `profitFactor = Infinity`, and that is correct

CVX, BRK.B, JPM, BAC, AMZN, MCD, AMT. Each has **zero net-losing trades**, so
`grossLoss = 0` by definition. Infinity was a *symptom* of Q-124 in the
aggregate path; it is not a defect when an instrument genuinely never lost.

## What this does NOT do

- Profit factor is still **per-trade cash, not time-weighted**: two trades of
  equal cash profit count equally whether held one day or sixty.
- `netCashPnl` uses the flat per-side cost constant. It does not model spread,
  market impact, or partial fills.
- No historical frequency of the Q-123 misclassification was measured beyond
  "zero occurrences in the current committed universe".

## The third defect-ratifying test of this session

`aggregatePortfolio.golden.test.ts` asserted `profitFactor === 0.05 / 0.02`
under the comment *"grossProfit counts WINNING trades only; grossLoss counts
pnl<0 only"* — a comment that **described the defect** and pinned it in place.
The audit that found it asked for the accounting **oracle** to change, not just
the expected constant, and that is what was done: the expectation is now
recomputed from the fixture's own shares and prices.

The other two this session were `mergeQuotes.test.ts`'s *"keeps yahoo quoteTime
even when bloomberg-sourced"* (Q-129) and Q-130's two guards on one property.
**A green suite is evidence about the tests as much as about the code.**
