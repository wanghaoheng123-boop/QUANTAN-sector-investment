# R1 + R3 — Second Pass Delta (S1 day 1)

**Reviewers:** R1 (quant finance) + R3 (options & volatility)
**Sprint:** S1 day 1 (mandated by C1 day-0 decision D5 before S2 entry)
**Date:** 2026-05-05
**Files added to scope:**
- `lib/backtest/portfolioBacktest.ts` (493 LOC) — full read
- `lib/options/chain.ts` (156 LOC) — full read

---

## Summary of new/upgraded findings

| ID | Severity | Status | One-line |
|----|----------|--------|----------|
| F1.7 | **UPGRADED** CRITICAL | from HIGH | correlation-Kelly is documented + configured but **never implemented** |
| F1.16 | **NEW** CRITICAL | new | Sortino has THREE divergent implementations across the codebase |
| F1.18 | **NEW** HIGH | new | Kelly applied to total equity, not cash bankroll (oversize on winning days) |
| F3.9 | **NEW** HIGH | new | chain.ts hardcodes `RISK_FREE_RATE = 0.0525` for all Greeks |
| F1.19 | **NEW** MEDIUM | new | `currentEquity` mark-to-market falls back to entry price, not last close |
| F1.20 | **NEW** MEDIUM | new | VaR computed from `dailyReturns ≥ 30` — too few for stable 99th-pct tail |
| F1.21 | **NEW** MEDIUM | new | dead "exit branch" code at portfolioBacktest.ts:247-253 (confused state machine) |
| F3.3 | SUSTAINED HIGH | downgrade considered, kept HIGH | chain.ts confirms per-contract IV → averaging gammas IS incorrect under skew |
| F1.2 | **SCOPE CLARIFIED** CRITICAL | unchanged | bug is in `engine.ts:545`; portfolioBacktest.ts:406-411 already implements the correct curve-DD. |
| F1.3 | partial sustain | pending | requires exitRules.ts read (deferred to next pass) |
| F1.6 | SUSTAINED HIGH | unchanged | portfolioBacktest.ts:403 uses 252 too |
| Phase 12-A | resolved | n/a | sectorGateByTicker correctly wired at portfolioBacktest.ts:144-162 |

---

## F1.7 [UPGRADED CRITICAL] — Correlation-adjusted Kelly is documented but NOT implemented

**Location:** `lib/backtest/portfolioBacktest.ts`

**Evidence (file-internal contradiction):**

1. **Header comment claims it (line 5, 10):**
   ```ts
   * Uses correlation-adjusted Kelly sizing and sector rotation for rebalancing.
   * Key institutional features:
   *   - ...
   *   - Correlation-adjusted Kelly (reduces size for correlated adds)
   ```

2. **Config exposes it (line 31, 47):**
   ```ts
   correlationGate: number     // max correlation increase before reducing Kelly
   ...
   correlationGate: 0.20,
   ```

3. **State infrastructure declared (line 136):**
   ```ts
   const tickerDailyReturns: Record<string, number[]> = {}
   for (const ticker of tickers) tickerDailyReturns[ticker] = []
   ```

4. **But neither `cfg.correlationGate` nor `tickerDailyReturns` is ever read or written in the function body** (verified by reading the entire 493-line file). The Kelly sizing at line 302-305 uses only `sig.KellyFraction` and `cfg.maxSinglePositionPct` — no correlation term.

**Severity rationale (UPGRADE from HIGH → CRITICAL):**
- The original R1 finding said "no correlation-adjusted Kelly; portfolio concentrates in correlated names."
- The reality is **worse**: the platform documents and configures the feature, exposing it to users who reasonably expect it works. Institutional clients reading the README/docstring would believe their concentration is managed when it is not.
- This is **falsely advertised functionality**, which is a fiduciary-grade red flag for an institutional research platform.

**Citation:**
- Thorp (2006) "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market." *Handbook of Asset and Liability Management* 1, p385–428 — correlation-adjusted Kelly formulation.
- Maillard, Roncalli, Teiletche (2010) — equal-risk-contribution as a practical alternative.

**Patch sketch (S2 priority 1):**
```ts
// Inside the new-BUY scanner at line 302, before allocation:
import { correlationFromReturns } from '@/lib/quant/correlation'  // new helper

// 1) Update tickerDailyReturns from the daily-equity update loop:
//    (currently dead state at line 136)
const todayReturn = idx > 0
  ? (rows[idx].close - rows[idx - 1].close) / rows[idx - 1].close
  : 0
tickerDailyReturns[ticker].push(todayReturn)

// 2) Before sizing the new BUY:
const recentReturns = tickerDailyReturns[ticker].slice(-63)  // 3-month window
let kellyAdj = sig.KellyFraction
for (const [openTicker] of openPositions) {
  const otherReturns = tickerDailyReturns[openTicker].slice(-63)
  if (otherReturns.length >= 20 && recentReturns.length >= 20) {
    const rho = correlationFromReturns(recentReturns, otherReturns)
    if (rho > cfg.correlationGate) {
      kellyAdj *= (1 - rho)  // shrink toward zero as correlation rises
    }
  }
}
const maxAllocation = Math.min(
  currentEquity * kellyAdj,
  currentEquity * cfg.maxSinglePositionPct,
)
```

**Acceptance test (must land before fix per rule 5):**
`__tests__/backtest/portfolioBacktest.correlation.test.ts`:
- Synthesize 5 instruments with rho=0.99 vs SPY. Assert that, with `correlationGate: 0.5`, the 5th instrument's allocated shares are < 30% of what a non-adjusted Kelly would give.
- Synthesize 5 uncorrelated instruments (rho ≈ 0). Assert that all five receive full Kelly allocation up to `maxSinglePositionPct`.
- Edge case: rho = NaN → no Kelly adjustment (fail safe to default).

---

## F1.16 [NEW CRITICAL] — Sortino has THREE divergent implementations across the codebase

**Locations:**
1. `lib/quant/indicators.ts:449-461` — uses MAR=0, N-1 denominator (R2 F2.1 finding)
2. `lib/backtest/engine.ts:387-396, 530-540` — uses MAR=rfD, n_d denominator (Phase 12 H1 fix)
3. `lib/backtest/portfolioBacktest.ts:427-431` — **THIRD VARIANT** uses MAR=0 with n_d denominator AND no minimum-sample threshold:
   ```ts
   const neg = dailyReturns.filter(x => x < 0)
   if (neg.length > 0) {
     const dSd = Math.sqrt(neg.reduce((s, x) => s + x * x, 0) / neg.length)
     if (dSd > 0) { const rfD = 0.04 / 252; sortino = ((mean - rfD) / dSd) * Math.sqrt(252) }
   }
   ```

**Inconsistency table:**

| Implementation | MAR | Denominator | Min sample (n_d) | Numerator |
|----------------|-----|-------------|-----------------|-----------|
| `indicators.ts` | 0 | N − 1 | n ≥ 20 | mean (no excess) |
| `engine.ts` (Phase 12-fixed) | rfD | n_d | n_d ≥ 3 | mean − rfD |
| `portfolioBacktest.ts` | 0 (filter)* | n_d | n_d > 0 | mean − rfD ⚠️ inconsistent |

\* `portfolioBacktest.ts` uses `dailyReturns.filter(x < 0)` — implicit MAR=0 — but then computes excess `mean - rfD` in the numerator. The MAR for the denominator and the numerator MUST match per Sortino & van der Meer (1991). They don't.

**Why critical:** Three places in the codebase compute the same metric three different ways. The dashboard's "Sortino" displayed for a portfolio backtest comes from path #3; the per-instrument Sortino comes from path #2; the indicator-library exported one is path #1. **Three paths, three numbers, all called "Sortino."**

**Citation:** Sortino & van der Meer (1991) op cit. — defines a single MAR, used consistently in numerator AND denominator.

**Patch sketch:** Single canonical `sortinoRatio(returns, marAnnual = 0.04, minSample = 30)` in `lib/quant/indicators.ts` (per F2.1 fix). All three sites import it.

**Acceptance test:** Run the same 1000-bar series through all three and assert byte-equal Sortino. Currently they differ; after canonicalization they must match.

---

## F1.18 [NEW HIGH] — Kelly fraction applied to total equity, not cash bankroll

**Location:** `lib/backtest/portfolioBacktest.ts:301-305`

**Evidence:**
```ts
const maxAllocation = Math.min(
  currentEquity * sig.KellyFraction,
  currentEquity * cfg.maxSinglePositionPct,
)
```
where `currentEquity = capital + positions_marked_to_market` (line 290–296).

**Problem:** Standard Kelly applies to **bankroll** = currently available cash. Using total equity allows allocating against unrealized gains in other positions. Concrete failure mode:
- Day 0: 10 positions worth $100k each, all up 50% → equity = $1.5M
- New BUY signal: Kelly = 0.20 → maxAllocation = $300k
- But `capital` (cash) might be only $50k → `Math.floor(maxAllocation / price)` rounds down, but the buy fires and `capital -= (shares*price + txCost)` goes NEGATIVE without check.

**Proof of negative-capital risk:**
- Line 313: `capital -= (shares * price + txCost)` has no check that `capital >= shares * price`.
- Line 309: `if (shares <= 0) continue` — only catches the price > maxAllocation case, not the capital-shortfall case.

**Citation:** Thorp, E. O. (2006) op cit. — Kelly is on bankroll, not paper-marked equity.

**Patch sketch:**
```ts
const maxAllocation = Math.min(
  capital * sig.KellyFraction,                    // ← use cash, not equity
  currentEquity * cfg.maxSinglePositionPct,        // concentration cap on total equity is OK
)
if (maxAllocation < price || maxAllocation > capital) continue  // ← guard
```

**Acceptance test:** Synthesize a 5-position portfolio where unrealized gains push equity to 3× cash. Trigger a 6th BUY. Assert allocation ≤ cash × KellyFraction (not equity × KellyFraction).

---

## F3.9 [NEW HIGH] — chain.ts hardcodes RFR = 5.25% for all options Greeks

**Location:** `lib/options/chain.ts:66`

**Evidence:**
```ts
/**
 * Continuously compounded risk-free rate for all greeks calculations.
 *
 * Currently hardcoded to 5.25% (Fed Funds upper bound as of mid-2024).
 * For production use, this should be dynamically sourced from:
 *   - US Treasury yield curve (e.g. 3-month T-bill for near-dated options)
 *   - Fed Funds futures or SOFR for accurate short-rate interpolation
 *   - Yahoo Finance ^IRX (13-week T-bill) for a live market proxy
 */
const RISK_FREE_RATE = 0.0525
```
Author explicitly acknowledges this is a placeholder. As of 2026-05-05 the actual 3-month T-bill is ~3.8%; computed Greeks (especially rho and forward delta of LEAPs) are off by 145 bps.

**Same bug class as F1.4** (engine.ts hardcoded 0.04). Two different hardcoded values for the same quantity in the same codebase — additional SSOT violation.

**Citation:**
- Hull (2017) p385–388 — RFR for options pricing must be the prevailing rate matching option's tenor.
- Merton (1973) — RFR is a model input, not a constant.

**Patch sketch:**
1. Create `lib/data/fred.ts` (per AGENTS.md Phase 5 hint) with `getRiskFreeRate(tenorDays: number): Promise<number>` pulling DGS3MO/DGS1/DGS2 from FRED.
2. Cache values daily; fall back to last known value on FRED failure.
3. Update `enrichContract(spot, today, type)` signature to accept `rfRate: number` from a per-chain pre-computed value.
4. Use the same SSOT helper from engine.ts (replaces `0.04 / 252` constants).

**Acceptance test:** Mock FRED to return 0.038. Assert chain Greeks computed using 0.038 differ from those computed at 0.0525 by ≥1% on relevant ATM call.

---

## F1.19 [NEW MEDIUM] — Mark-to-market falls back to entry price for missing data

**Location:** `lib/backtest/portfolioBacktest.ts:294, 339, 367, 349`

**Evidence:** Multiple places use the pattern:
```ts
return s + p.currentShares * (prow?.close ?? p.entryPrice)
```
If a position's data row at `currentTime` is missing (data gap, halts, vendor outage), valuation falls back to `entryPrice`. This silently understates losses (when price has fallen since entry) or overstates gains.

**Patch sketch:** Forward-fill the last known close:
```ts
const prow = pidx != null ? instrumentData[p.ticker][pidx] : null
const lastKnownClose = pos.lastKnownClose ?? p.entryPrice  // tracked field
const markPrice = prow?.close ?? lastKnownClose
// Update on every observed bar:
if (prow?.close) pos.lastKnownClose = prow.close
```

**Severity:** Medium — affects equity curve fidelity during data outages, masks true drawdowns.

---

## F1.20 [NEW MEDIUM] — VaR threshold ≥ 30 daily returns is too low for stable tail estimate

**Location:** `lib/backtest/portfolioBacktest.ts:459-464`

**Evidence:**
```ts
const var95_1d = dailyReturns.length >= 30
  ? -[...dailyReturns].sort((a, b) => a - b)[Math.floor(0.05 * dailyReturns.length)]
  : null
const var99_1d = dailyReturns.length >= 30
  ? -[...dailyReturns].sort((a, b) => a - b)[Math.floor(0.01 * dailyReturns.length)]
  : null
```
For 99% VaR with N=30, the index is `Math.floor(0.01 * 30) = 0` — the worst single observation. Sample size for stable tail-percentile estimation should be ≥ 250 (≈ 1 trading year) per Jorion (2006). At N=30, 99% VaR is basically a single-point estimate with noise ±50%.

**Citation:** Jorion, P. (2006). *Value at Risk: The New Benchmark for Managing Financial Risk*, 3e. McGraw-Hill. p119–122 (sample-size requirements for historical VaR).

**Patch sketch:**
```ts
const minNFor95 = 100
const minNFor99 = 252
const var95_1d = dailyReturns.length >= minNFor95
  ? -percentile(dailyReturns, 0.05) : null
const var99_1d = dailyReturns.length >= minNFor99
  ? -percentile(dailyReturns, 0.01) : null
```

---

## F1.21 [NEW MEDIUM] — Dead/confused state-machine code at portfolioBacktest.ts:247-253

**Location:** `lib/backtest/portfolioBacktest.ts:247-253`

**Evidence:**
```ts
} else {
  openPositions.delete(ticker)
  capital -= pos.currentShares * exitPrice  // remove remaining (partial already removed above)
  capital += pos.currentShares * exitPrice  // re-add full proceeds
  // Actually just: net out the remainder
  if (exitCheck.isPartial === false) {
    // Already handled above via exitShares = pos.currentShares
  }
}
```
Lines 248-249 are a self-canceling `-X +X` pair. The `// Actually just: net out the remainder` comment and the empty `if` block at 251-253 indicate the author was working through a bug and left the dead code in place. Not a correctness bug today (capital accounting checks out), but a maintenance booby trap.

**Patch sketch:**
```ts
} else {
  openPositions.delete(ticker)
  // capital was already credited for full exit at line 226 (exitShares = currentShares when !isPartial)
}
```

---

## F3.3 [SUSTAINED at HIGH] — chain.ts confirms per-contract IV; averaging in gex.ts is incorrect

**Location:** `lib/options/chain.ts:99-104` (resolves R3 self-dissent)

**Evidence:** R3's first-pass dissent: "If `chain.ts` enforces a single IV per strike (e.g., averages call+put IVs to produce one gamma), then the averaging at gex.ts:68 is a no-op."

The chain.ts read confirms: each contract is enriched **with its own** `contract.impliedVolatility`:
```ts
function enrichContract(contract, spot, today, type) {
  ...
  const sigma = contract.impliedVolatility   // ← per-contract IV
  const g: Greeks = sigma > 0 && T > 0
    ? greeks(spot, contract.strike, T, RISK_FREE_RATE, sigma, type)
    : { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }
  return { ...contract, ...g }
}
```
Per-contract IV → per-contract gamma → call_gamma ≠ put_gamma at the same strike under skew. **F3.3 confirmed at HIGH severity.** The gex.ts averaging IS materially wrong on skewed names.

---

## F1.2 [SCOPE CLARIFICATION] — bug is in engine.ts only; portfolioBacktest already does it right

**Evidence (resolves an open R1 question):**
- `portfolioBacktest.ts:406-411` already computes maxDD from the actual `equityHistory` curve (correct).
- `engine.ts:545` `Math.max(...results.map(r => r.maxDrawdown))` is the wrong one (R1 F1.2).

**Implication:** F1.2's S2 fix scope is narrower than initially stated — only `engine.ts:aggregatePortfolio` needs to change. `portfolioBacktest.runPortfolioBacktest` is already correct. This SIMPLIFIES S2's risk surface. Acceptance test should still verify `aggregatePortfolio` post-fix matches `runPortfolioBacktest`'s implementation.

---

## F1.3 [FULLY SUSTAINED CRITICAL — extends across all 5 exit conditions in exitRules.ts]

S1 day-1 read of `lib/backtest/exitRules.ts` (200 LOC) confirms the bug is more pervasive than R1's first pass identified. Every exit condition in `checkExitConditions` (lines 96-144) uses `currentPrice` (= bar close from portfolioBacktest.ts:177→213, and from engine.ts:147 `signalPrice`). No intraday high/low check anywhere:

| Exit branch | File:line | Compares against |
|-------------|-----------|------------------|
| Stop loss | exitRules.ts:107 | `currentPrice <= stopLossPrice` |
| Panic-vol exit | exitRules.ts:113 | `currentATRPct > entryATRPct × N` (uses close-only ATR) |
| Signal-based | exitRules.ts:119 | `signalAction === 'SELL'` (no price check) |
| Profit target | exitRules.ts:124-126 | `unrealizedPct >= profitTakePct` from `currentPrice` |
| Trailing stop | exitRules.ts:130-134 | `currentPrice < highestPrice × (1 - trailPct)` |

**Implication:** F1.3's S2 fix surface expands from 3 lines in engine.ts to all 5 branches in exitRules.ts. Patch must thread `bars[i]` (with high/low) into `checkExitConditions` and update each branch:

```ts
// New signature:
checkExitConditions(position, currentIdx, bar: OhlcBar, currentDate, currentATRPct, signalAction, config)

// Stop loss: fires on intraday low piercing stop:
if (bar.low <= position.stopLossPrice) {
  // Fill at min(stopLoss, open) for gap-down case:
  const fillPx = Math.min(position.stopLossPrice, bar.open)
  return { shouldExit: true, reason: 'stop_loss', exitPrice: fillPx, ... }
}
// Profit target: fires on intraday high reaching target:
if (!partialExitDone && (bar.high - entryPrice) / entryPrice >= profitTakePct) {
  return { shouldExit: true, reason: 'profit_target',
           exitPrice: entryPrice * (1 + profitTakePct), isPartial: true, partialFraction: 0.50 }
}
```

---

## F1.22 [NEW MEDIUM] — `atrAdaptiveStop` uses bars including today's still-forming bar (look-ahead micro-bias)

**Location:** `lib/backtest/exitRules.ts:80-82`

**Evidence:**
```ts
export function atrAdaptiveStop(entryPrice, bars, multiplier = 1.5, ...) {
  const atrVals = atrArray(bars, 14)
  const lastATR = atrVals[atrVals.length - 1]
  ...
}
```
Called from `portfolioBacktest.ts:308` with `bars = lookback.map(...)` where `lookback = rows.slice(0, idx + 1)` — includes the entry bar's full TR. Same class as F1 H3 in engine.ts (Phase 12 fixed in engine.ts but not here). For a fresh entry, ATR includes today's TR which isn't yet "closed" in live trading.

**Patch sketch:** Use `atrVals[atrVals.length - 2]` (prior bar's ATR), matching engine.ts Phase 12 H3 fix.

**Severity:** Medium — small magnitude (one bar's TR vs 14-bar smoothed series ≈ 7% influence) but same correctness class as the engine.ts fix.

---

## F1.23 [NEW LOW] — Magic-number defaults in DEFAULT_EXIT_CONFIG without citation

**Location:** `lib/backtest/exitRules.ts:33-40`

**Evidence:** `profitTakePct: 0.08`, `trailingStopPct: 0.05`, `panicExitAtrMultiple: 3.0`, `maxHoldDays: 20`, `atrStopMultiplier: 1.5` — five magic numbers, no source citation, no walk-forward justification documented.

**Patch sketch:** Add JSDoc with rationale OR cite the grid-search calibration that produced these. If derived empirically, add `__tests__/backtest/exitConfig.optimization.test.ts` documenting the search grid and chosen values.

**Severity:** Low — documentation hygiene.

---

## Profit-take exit fires at close, leaving gains on the table

**Sub-finding within F1.3:** profit-take at `currentPrice` (close) instead of intraday high means a stock that hits +8.5% intraday and closes at +6% is missed entirely. Real-world execution: a profit-take limit order placed at `entry*(1+0.08)` fills the moment intraday high crosses it, locking in 8% even if close is lower. The backtest CONSERVATIVELY understates profit-take performance — but the symmetry is broken when stop-loss also uses close (and OVERSTATES WR per F1.3 main). The bias has direction.

---

## Phase 12-A — Resolved (no finding needed)

`lib/backtest/portfolioBacktest.ts:144-162` correctly builds `sectorGateByTicker` from `SECTOR_PROFILES` and passes per-ticker gates to `enhancedCombinedSignal` at lines 204-207, 281-284. The Phase 12-A Sprint 2 deliverable is done.

---

## Updated cross-domain handoffs

- **R8:** F1.16 (three Sortinos) — add three-way equivalence test; required pre-S2 fix.
- **R8:** F1.7 upgraded to CRITICAL — pre-S2 acceptance test for correlation-Kelly is now blocking.
- **C2:** I1 must re-spot-check the upgraded F1.7 finding (independent verification of "feature documented but not implemented").
- **R3:** F3.9 (chain.ts RFR) requires data-layer support (FRED hookup). Coordinate with R4 for `lib/data/fred.ts` scaffold.

---

## Findings ledger delta

Add to `reviews/findings-ledger.csv`:

```
F1.16,R1,CRITICAL,quant-finance,(three files),various,three divergent Sortino implementations,Sortino & van der Meer (1991),AT-F1.16-sortino-canonical-three-way,E1,S2,open
F1.18,R1,HIGH,quant-finance,lib/backtest/portfolioBacktest.ts,301-305,Kelly applied to total equity not cash,Thorp (2006),AT-F1.18-kelly-bankroll,E1,S2,open
F1.19,R1,MEDIUM,quant-finance,lib/backtest/portfolioBacktest.ts,294/339/367,mark-to-market falls back to entry price,N/A (data integrity),AT-F1.19-forward-fill,E1,S3,open
F1.20,R1,MEDIUM,quant-finance,lib/backtest/portfolioBacktest.ts,459-464,VaR sample size threshold too low,Jorion (2006) p119-122,AT-F1.20-var-sample,E1,S3,open
F1.21,R1,MEDIUM,quant-finance,lib/backtest/portfolioBacktest.ts,247-253,dead/confused state-machine code,N/A (maintenance),AT-F1.21-cleanup,E1,S3,open
F3.9,R3,HIGH,options,lib/options/chain.ts,66,RISK_FREE_RATE hardcoded 5.25% for Greeks,"Hull (2017); Merton (1973)",AT-F3.9-fred-rfr,E3+E1,S2,open
```

And UPGRADE F1.7's severity from HIGH → CRITICAL with status note.

**New ledger total:** 81 + 6 = 87 findings (8 Critical now, including F1.7 upgrade).

---

## Self-dissent (rule 7)

F1.7 upgrade is firm — I read every line of the 493-line file and confirmed `correlationGate` and `tickerDailyReturns` are never read or written outside their declarations. Confidence ≥ 95%.

F1.16 (three Sortinos) — confirmed by reading both implementations directly. The numerical claim that they produce different values is provable; have not yet computed the gap on real data, but R1's earlier hand-derivation of 1.58× for one of the divergences gives a lower bound.

F1.18 (Kelly on equity vs cash) — I claim risk of negative `capital`. Have not constructed a real-data scenario; the proof relies on the absence of the `capital >= cost` guard. Possible the data path never reaches negative because Kelly fractions are always small (≤ 0.25 from `halfKelly`). Acceptance test verifies; severity HIGH provisionally.

I have NOT read `exitRules.ts`, `kelly.ts`, `researchScore.ts`, `dcf.ts` — F1.3 partially sustained pending; other findings deferred to pass #3.

---

**Reviewer signatures:** R1 (delta) + R3 (delta)
**Cross-checked by:** I1 must re-verify F1.7, F1.16 — pending
**Status:** S2 entry now requires acceptance tests for F1.7 (correlation-Kelly), F1.16 (canonical Sortino), F1.18 (Kelly bankroll), F3.9 (FRED RFR).
