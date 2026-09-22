# Q-125 — the strategy now collects dividends on shares it holds

**Migration note**, per `CLAUDE.md` FORBIDDEN: *"Silently changing a calculation
without a migration note and a regression test."* Tests:
`__tests__/backtest/strategyDividendCash.test.ts`.

**This change moves the platform's headline number in its own favour.** That is
stated first deliberately — see §"the direction" below.

## What was wrong

Every dividend read in `core.ts` fed the buy-and-hold comparator. The
strategy's own cash ledger never received one. A 500-share position spanning a
$2 dividend had **exactly the same return as a dividend-free control** — $1000
of entitlement simply absent — while the benchmark it is measured against *did*
collect. `Q-126` widened that asymmetry by making the benchmark's side compound
correctly.

## Entitlement ordering — the actual design question

Fills execute at `rows[i+1].open`. The credit is applied **before** that fill,
to the holding that owned the shares through bar `i`'s close — i.e. before the
ex-date opened. That single placement yields all four required behaviours:

| case | entitled? | why |
|---|---|---|
| held across the ex-date | yes, once | position exists at credit time |
| **sold** at the ex-date open | **yes** | owned it before the open |
| **bought** at the ex-date open | **no** | the fill has not happened yet |
| flat | no | nothing to credit |

Paid as **cash, not reinvested**: the strategy holds a fixed share count until
its exit. `pnlPct` is deliberately untouched — it remains the raw price move
(`Q-123`/`Q-124`), so dividends reach `totalReturn` through capital rather than
through the per-trade log.

**Not a double count:** prices are yahoo `close` — split-adjusted, *not*
dividend-adjusted (`fetchBacktestData.mjs` takes `q.close`, not `q.adjclose`,
and attaches each cash dividend to its ex-date bar separately). Verified under
`Q-126`; it is the precondition this ticket was waiting on.

## Measured impact

| | before | after |
|---|---|---|
| portfolio `avgReturn` | 0.033337 | **0.036752** |
| portfolio `alpha` | −1.127941 | **−1.124526** |
| mean `excessReturn` | −1.107974 | −1.104559 |
| `bnhAvg` / mean `bnhReturn` | unchanged | unchanged |
| `winRate` / `avgTradeReturn` | unchanged | unchanged |
| `profitFactor` | 2.782738 | 2.784426 |

**49 of 56 instruments moved.** The benchmark side is untouched — this is the
strategy side only, which is the asymmetry being closed.

`profitFactor` moves slightly as a **second-order effect**: dividend cash raises
available capital, so later half-Kelly entries size differently, producing
different trades. That is real, not noise.

`npm run benchmark` exit 0, edge over base **+1.59pp**, unchanged — the label
pipeline never calls these engines.

## Verified against an independent ledger on real data

For each instrument, dividends falling strictly inside each trade's holding
window were summed from the committed bars and compared to the observed
`totalReturn` delta:

- **26 instruments — exact agreement.**
- **23 instruments — differ only because share counts changed**, which is the
  capital-resizing effect above.
- **0 unexplained.**

Reaching zero took three passes, and the failures were all in the *checker*:
matching a trade's entry bar by price is ambiguous when several bars share an
open, which over-counted on 5 instruments; keying on the trade's `date` fixed
four, and the last (PG) needed the exit bar disambiguated toward the 60-bar
time exit because its exit price also matched two bars. **The verification
script was wrong three times before the implementation was suspected once.**

## The direction, stated plainly

This makes the platform look **better**: strategy return +0.34pp, alpha less
negative by 0.0034. Every other correction in this session moved the other way,
and a flattering result deserves more scepticism, not less. It is applied
because the accounting was asymmetric *against* the strategy — the comparator
received dividends the strategy also earned but never booked — and correcting
an asymmetry necessarily helps whichever side was short-changed. The verdict is
unchanged: alpha remains ≈ −1.12.

## What this does NOT do

- Dividends are **cash, never reinvested**, and carry no tax or withholding.
- `pnlPct` excludes the dividend its own holding earned, so per-trade returns
  and `totalReturn` account for dividends differently. Asserted in the suite.
- Entitlement is modelled on the **ex-date bar only**; no record date, no pay
  date, no settlement lag.
- No claim about historical frequency beyond what the committed universe shows.

## A fifth test comment that documented the defect

The golden at `aggregatePortfolio.golden.test.ts` asserted the strategy return
under the comment *"dividends touch only the B&H side — the strategy trade is
unchanged"*. That was true, and it was the bug. Its replacement value was
derived independently: the single trade holds **70 shares** across **one** $2.00
ex-date, so $140 on $100,000 = **+0.0014 exactly**, giving 0.052381 → 0.053781.
