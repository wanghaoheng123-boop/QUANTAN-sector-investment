# WS2 — Quant / Algorithms Remediation SPEC (READ-ONLY)

**Author:** WS2 (Quant/Algorithms engineer, parallel rectification team)
**Mode:** STRICTLY READ-ONLY. Zero code edits, zero branches. This document is an
executable remediation specification for someone else to implement.
**Baseline verified against:** `main` @ `8d56955` (unchanged since 2026-05-30 inspection).
**Scope:** Bucket B — re-baselining the §2 *portfolio-simulation* metrics shown in the UI.
**OUT of scope:** the production LABEL benchmark (53.79% net) — D2 verified it honest; do not touch.

---

## 0. Read-this-first: file ownership & sequencing (CRITICAL)

Two of the three files in scope are **OFF-LIMITS for editing** because they are in flight on open PRs.
This is exactly why WS2 is spec-only.

| File | Status | Locked by | WS2 action |
|---|---|---|---|
| `lib/backtest/portfolioBacktest.ts` | **OFF-LIMITS** | PR #29 (`refactor/exec-cost-ssot-fmtpct`) | READ only — spec the fix; DO NOT edit |
| `lib/backtest/engine.ts` | **OFF-LIMITS** | PR #28 (`fix/exit-fill-next-open-symmetry`) | READ only — reference implementation |
| `reviews/invariants-baseline.md` | **OFF-LIMITS** | PR #28 | READ only — re-baseline ledger lives here |
| `lib/backtest/signals.ts` | editable by others (WS5 edits only the `regimeSignal` docstring, D2-4) | — | READ only (WS2) |

**Hard sequencing constraint (do not violate):**
1. The re-baseline ledger (the C1/C2 capture-and-justify records this repo's freeze requires) lives in
   `reviews/invariants-baseline.md`, **which is itself inside PR #28.** Therefore **every WR-affecting
   fix below (D2-1, D2-2, and arguably D2-6) MUST land AFTER PR #28 merges**, so the C1/C2 entries are
   written on top of #28's version of that file and do not create a merge conflict.
2. `portfolioBacktest.ts` fixes (D2-1, D2-2, D2-7) **MUST land AFTER PR #29 merges** — #29 already
   rewrites cost handling in this exact file (it replaces the four hardcoded `0.0011` literals with the
   `executionModel` SSOT — see D2-3, already FIXED by #29). Implementing D2-1/D2-2/D2-7 before #29
   merges guarantees a conflict and risks re-introducing the hardcoded costs #29 removed.
3. **Net ordering for the implementer:** merge #28 → merge #29 → then open ONE new branch
   (`fix/portfolio-sim-rebaseline`) that implements D2-1 + D2-2 + D2-7 together (they share the same
   trade-construction code and must be re-baselined in a single benchmark run), records C1/C2 in
   `invariants-baseline.md`, and updates the frozen §2 metrics. D2-6/D2-5 in `signals.ts` are a
   separate, smaller branch.

> **Note on D2-3 (context, not in WS2 scope):** the inspection lists portfolioBacktest tx cost
> hardcoded `0.0011 ×4` (lines 303, 416, 454, 491) as **FIXED by open PR #29**. The line citations in
> *this* spec are against **current `main`** (where the literals still exist). After #29 merges those
> become `TX_COST_PCT_PER_SIDE` references; the implementer of D2-1/D2-2 will see the post-#29 form.
> All cost-touching pseudo-diffs below are written to be **correct against the post-#29 SSOT form**
> (use `TX_COST_PCT_PER_SIDE`, not a fresh `0.0011`).

---

## 1. Executive summary & priority ranking

The multi-instrument `portfolioBacktest.ts` path uses **looser execution semantics than the
single-instrument `engine.ts`**, which was already hardened to the institutional T+1 standard (FIX-C2).
The §2 portfolio-sim metrics surfaced in the UI (win rate, profit factor, total/annualized return) are
therefore **optimistically biased**. None of this affects the production LABEL benchmark.

| Rank | ID | Sev | One-line | Net effect on §2 metrics | Re-baseline? |
|---|---|---|---|---|---|
| 1 | **D2-1** | HIGH | BUY entry fills at **same-bar close** (look-ahead) | Return/WR ↑ ~0.3–0.5%/trade | **YES (C1+C2)** |
| 2 | **D2-2** | MED | `pnlPct` is **gross-of-cost** while equity is net | WR ↑ & PF ↑ ~3–5pp | **YES (C1+C2)** |
| 3 | **D2-6** | MED | enhanced-path `atrScore` is **bullish when ATR high** (inverted for dip-buy) | enhanced path only (OFF in prod) — measure | YES if flag flipped |
| 4 | **D2-7** | LOW | annualization hardcoded **252** ignores BTC's 365 cal-days | annualized return ↑ ~1.45%/yr w/ BTC | YES (reported metric) |
| 5 | **D2-5** | LOW | `priceWasNearSmaRecently` compares **past prices vs today's SMA** | tiny, broadens dip-BUY gate slightly | methodology decision |

**Recommended implementation grouping:**
- **Branch 1 (`fix/portfolio-sim-rebaseline`, after #28+#29):** D2-1, D2-2, D2-7 together (same file, one
  re-baseline run). HIGH+MED+LOW but they all perturb the same §2 numbers, so capture C1 once and
  justify C2 once for the combined delta.
- **Branch 2 (`fix/signals-atr-dipbuy`, after #28):** D2-6 (+ optionally D2-5). `signals.ts` only.
  Enhanced path is OFF in prod so prod metrics are unaffected until the flag flips, but the fix is still
  correctness-positive and should be benchmarked under the enhanced flag.

---

## 2. The reference implementation (engine.ts) — what "correct" looks like

`engine.ts` is the SSOT for correct execution semantics. Quote it when justifying every portfolio fix.

**T+1 entry (FIX-C2), `engine.ts:231–243, 335–349`:**
```
// FIX C2 (Critical): Signal at today's close, execute at TOMORROW's open.
const ENTRY_SLIPPAGE_BPS = 2  // 2 bps added to entry price (realistic friction)
for (let i = 200; i < rows.length - 1; i++) {       // NOTE: stops at length-1 (needs i+1)
  const signalPrice = rows[i].close                  // signal uses today's close
  const nextOpen = rows[i + 1].open                  // execute at tomorrow's open
  ...
  if (signal.action === 'BUY' && !state.openTrade) {
    const entryPrice = nextOpen * (1 + ENTRY_SLIPPAGE_BPS / 10000)   // pay above open
    const shares = Math.floor(allocation / entryPrice)
```

**Net-of-cost realized pnl, `engine.ts:165–185` (`closePosition`):**
```
const proceeds = state.position * fillPrice
const txCost   = proceeds * TX_COST_PCT_PER_SIDE
const netProceeds = proceeds - txCost
const pnlPct = open.action === 'BUY'
  ? (fillPrice - open.entryPrice) / open.entryPrice
  : (open.entryPrice - fillPrice) / open.entryPrice   // <-- see §4 note: engine pnlPct is also gross
```
(See D2-2 §4 for the important nuance about what engine actually does vs. what portfolio does — engine
gets WR right for a *different* reason; portfolio's bug is real.)

**Instrument-aware annualization, `engine.ts:187–208, 391`:**
```
const CRYPTO_TICKERS_365 = new Set(['BTC','BTC-USD','ETH','ETH-USD','SOL','SOL-USD'])
function tradingDaysPerYear(ticker: string, sector: string): number {
  if (CRYPTO_TICKERS_365.has(ticker.toUpperCase())) return 365
  if (sector?.toLowerCase() === 'crypto') return 365
  return 252
}
...
const annualization = tradingDaysPerYear(ticker, sector)   // 252 equities, 365 crypto
const years = days / annualization
```

---

## 3. D2-1 (HIGH) — portfolioBacktest BUY entry fills at SAME-bar close (look-ahead)

### 3.1 Current behavior (verified against `main`)

`lib/backtest/portfolioBacktest.ts`, the "Scan for new BUY signals" block, **lines 337–433**:

```
337  for (const ticker of tickers) {
338    if (openPositions.has(ticker)) continue
340    const rows = instrumentData[ticker]
341    const idx = priceIndex[ticker].get(currentTime)
342    if (idx == null || idx < 220) continue
344    const row = rows[idx]
345    const price = row.close                 // <-- TODAY's close (the signal bar)
347    const lookback = rows.slice(0, idx + 1) // <-- includes today
...
358    sig = resolveBacktestSignal(ticker, currentDate, price, closes, bars, ohlcv, cfg, ...)
364    if (sig.action !== 'BUY') continue
...
413    const shares = Math.floor(allowed / price)        // <-- sized at today's close
416    const txCost = shares * price * 0.0011            // <-- (post-#29: TX_COST_PCT_PER_SIDE)
417    capital -= (shares * price + txCost)              // <-- FILLED at today's close
418    openPositions.set(ticker, {
...
423      entryPrice: price,                              // <-- entry recorded as today's close
424      entryDate: currentDate,                         // <-- same bar as the signal
```

The signal is computed from `closes`/`bars`/`ohlcv` that **include `rows[idx]` (today)**, and the fill
price is **that same bar's close** (`price = row.close`). Signal and execution share one bar.

### 3.2 Why it is wrong

This is **look-ahead bias**: in live trading you cannot observe today's close (needed to *generate* the
signal) and *also* transact at that same close. The earliest executable price after an end-of-day signal
is **tomorrow's open**. `engine.ts` fixed exactly this in FIX-C2 (engine.ts:231–243) and explicitly
documents the old behavior as "physically impossible in live trading." Standard backtest hygiene
(López de Prado, *Advances in Financial ML* (2018), ch. 3 on labeling/timing; the institutional
"signal EOD, execute next-open" convention) requires a one-bar gap. The portfolio path never received
the FIX-C2 treatment, so it is on the pre-fix, look-ahead semantics. Bias direction is upward (entries
get the favorable same-bar price the strategy "saw"), estimated **~0.3–0.5% per trade** in the
inspection.

### 3.3 Line-level pseudo-diff (write against post-#29 SSOT cost form)

Mirror engine.ts exactly: signal from today's close, **fill at tomorrow's open + slippage**, and **bound
the BUY loop so a next bar exists**.

```diff
  // ── Scan for new BUY signals ──
  if (openPositions.size < cfg.maxPositions) {
    for (const ticker of tickers) {
      if (openPositions.has(ticker)) continue

      const rows = instrumentData[ticker]
      const idx = priceIndex[ticker].get(currentTime)
-     if (idx == null || idx < 220) continue
+     // FIX (D2-1): need a NEXT bar to fill at tomorrow's open (T+1, mirrors engine.ts FIX-C2).
+     if (idx == null || idx < 220 || idx + 1 >= rows.length) continue

      const row = rows[idx]
-     const price = row.close
+     const signalPrice = row.close            // today's close — signal generation only
+     const nextOpen = rows[idx + 1].open       // tomorrow's open — execution price
+     if (!Number.isFinite(nextOpen) || nextOpen <= 0) continue   // fail-closed on bad bar

      const lookback = rows.slice(0, idx + 1)   // signal still uses data up to & incl. today
      const closes = lookback.map(r => r.close)
      const bars   = lookback.map(r => ({ open: r.open, high: r.high, low: r.low, close: r.close }))
      const ohlcv  = lookback.map(r => ({ open: r.open, high: r.high, low: r.low, close: r.close,
                                          volume: r.volume ?? 0, time: r.time }))

      let sig
      try {
-       sig = resolveBacktestSignal(ticker, currentDate, price, closes, bars, ohlcv, cfg,
+       sig = resolveBacktestSignal(ticker, currentDate, signalPrice, closes, bars, ohlcv, cfg,
                                    sectorGateByTicker[ticker])
      } catch { continue }

      if (sig.action !== 'BUY') continue

      // ... drawdown circuit-breaker & correlation-adjusted Kelly unchanged ...
      // NOTE: the equity / peak / Kelly bankroll math below should keep using marked-to-market
      // values at TODAY's close (currentTime) — that is the equity you observe when you DECIDE.
      // Only the FILL price changes to nextOpen.

+     // Long entries pay slightly above the open (adverse selection / friction) — same 2 bps as engine.
+     const ENTRY_SLIPPAGE_BPS = 2
+     const entryPrice = nextOpen * (1 + ENTRY_SLIPPAGE_BPS / 10000)

      const atrResult = atrAdaptiveStop(/* use signalPrice or nextOpen? see NOTE */ signalPrice, bars, cfg.exit.atrStopMultiplier)
-     const shares = Math.floor(allowed / price)
+     const shares = Math.floor(allowed / entryPrice)
      if (shares <= 0) continue

-     const txCost = shares * price * 0.0011
-     capital -= (shares * price + txCost)
+     const txCost = shares * entryPrice * TX_COST_PCT_PER_SIDE   // post-#29 SSOT
+     capital -= (shares * entryPrice + txCost)
      openPositions.set(ticker, {
        ticker,
        sector: sectorMap[ticker] ?? 'Unknown',
        entryIdx: di,
-       entryPrice: price,
+       entryPrice: entryPrice,
        entryDate: currentDate,
        entryATRPct: atrResult.atrPct,
        stopLossPrice: atrResult.stopLossPrice,
        initialShares: shares,
        currentShares: shares,
-       highestPrice: price,
+       highestPrice: entryPrice,
        partialExitDone: false,
        confidence: sig.confidence,
        reason: sig.reason,
-       capital: shares * price,
+       capital: shares * entryPrice,
      })
```

**Implementer decision points (must be resolved, document in C2):**
- **Kelly/concentration sizing basis (lines 402–408):** `maxAllocation` mixes `capital * adjustedKelly`
  with `currentEquity * cfg.maxSinglePositionPct`, both computed at today's close. Keep these at today's
  close (that is the bankroll you observe at decision time); only the *fill* price (`shares` divisor and
  `capital` debit) moves to `entryPrice`. This matches engine.ts, where `allocation = state.capital *
  kellyFrac` is decided at the signal bar and only `entryPrice = nextOpen*…` changes.
- **`atrAdaptiveStop` price arg (line 411):** engine stores ATR% at entry from the **prior** bar
  (`atrVals[i-1]`, engine.ts:360) to avoid using the not-yet-closed signal bar's TR. For minimal
  behavior change keep `signalPrice` (today's close) as the stop-anchor reference; do NOT switch it to
  `nextOpen` without a separate justification, since the stop geometry is keyed to the entry decision.
  (Optional hardening, separate finding: align portfolio's entry-ATR to the prior-bar convention engine
  uses. Not required for D2-1.)
- **`entryIdx: di`** — leave as-is; `di` is the decision bar index and is only used for time-based exits
  measured in bars held. (If the team wants the holding clock to start at the fill bar, that's a separate
  decision; engine measures from the signal bar too.)

### 3.4 Quantitative impact on §2 metrics

- Per-trade entry price rises from `close[t]` to `~open[t+1]*(1+2bps)`. In a dip-buy strategy the
  signal fires after a down day, so `open[t+1]` is on average **at or above** `close[t]` (overnight mean
  reversion / no continued free fall), removing the favorable same-bar fill. Inspection estimate:
  **~0.3–0.5% worse per trade** on entry. Plus an explicit **+2 bps** slippage now charged on every BUY.
- Direction on all §2 metrics: **down** — total return ↓, annualized return ↓, win rate ↓ (marginal
  trades that only won because of the favorable close fill flip to losers), profit factor ↓, Sharpe/
  Sortino ↓ slightly. Magnitude scales with trade count; for a portfolio doing dozens–hundreds of trades
  this is a **material** re-baseline, the largest of the five findings.
- A subtle secondary effect: bounding the loop with `idx + 1 < rows.length` drops at most the single
  last-bar entry per instrument (it can no longer fill) — negligible but note it in C2 for exact
  reproducibility.

### 3.5 Regression tests to add

Add to a portfolio backtest test file (e.g. `__tests__/lib/backtest/portfolioBacktest.test.ts` —
confirm exact path; the repo keeps backtest tests under `__tests__/lib/backtest/`):

1. **No same-bar fill (core invariant):** craft a 2-instrument fixture where a BUY signal fires on bar
   `t` and `open[t+1] != close[t]` (e.g. close[t]=100, open[t+1]=103). Assert the resulting trade's
   `entryPrice == 103 * (1 + 2/10000)` (i.e. tomorrow's open + slippage), **not** 100.
2. **Last-bar BUY cannot fill:** fixture where the only BUY signal is on the final bar; assert zero
   positions opened from it (no `rows[idx+1]`).
3. **Look-ahead monotonicity:** run the same fixture through the OLD semantics (close fill) and the NEW
   semantics; assert NEW total return ≤ OLD total return for a deterministic dip-buy fixture (encodes the
   "look-ahead inflates" direction).
4. **Parity with engine on a single instrument:** feed ONE instrument through both `backtestInstrument`
   and `runPortfolioBacktest` (maxPositions=1, no rebalance, same config) on identical data; assert entry
   prices are both next-open+slippage (cross-checks the two engines now agree on execution timing).
5. **Slippage applied exactly once** per entry (assert `capital` debit == `shares*entryPrice*(1) +
   shares*entryPrice*TX_COST_PCT_PER_SIDE`, with `entryPrice` already including the 2 bps).

---

## 4. D2-2 (MED) — `pnlPct` gross-of-cost while equity is net → WR/PF inflated

### 4.1 Current behavior (verified against `main`)

`portfolioBacktest.ts` computes the **per-trade `pnlPct` gross of transaction cost** at all three exit
sites, even though **`capital`/equity are debited net of cost**. The win-rate and profit-factor metrics
are then computed from `pnlPct` (lines 517–523), so they "see" the gross series.

Exit site 1 — normal/partial exit, **lines 300–311**:
```
300  const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice      // GROSS — no cost
301  const pnlDollar = exitShares * (exitPrice - pos.entryPrice)
303  const exitTxCost = exitShares * exitPrice * 0.0011                // cost charged to capital…
304  capital += (exitShares * exitPrice - exitTxCost)                  // …but NOT to pnlPct
311    shares: exitShares, pnlPct, pnlDollar,                          // gross pnlPct stored on trade
```

Exit site 2 — drawdown circuit breaker, **lines 454–461**:
```
454  capital += pos.currentShares * exitPrice * (1 - 0.0011)
460    pnlPct: (exitPrice - pos.entryPrice) / pos.entryPrice,          // GROSS
```

Exit site 3 — end-of-data close, **lines 491–497**:
```
491  capital += pos.currentShares * exitPrice * (1 - 0.0011)
497    pnlPct: (exitPrice - pos.entryPrice) / pos.entryPrice,          // GROSS
```

Metrics derived from the gross `pnlPct`, **lines 517–523**:
```
517  const winning = closedTrades.filter(t => t.pnlPct > 0)
518  const winRate = closedTrades.length > 0 ? winning.length / closedTrades.length : 0
519  const grossProfit = winning.reduce((s, t) => s + t.pnlPct, 0)
520  const grossLoss = Math.abs(closedTrades.filter(t => t.pnlPct < 0).reduce((s, t) => s + t.pnlPct, 0))
521  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
523  avgTradeReturn = … closedTrades.reduce((s,t)=> s + t.pnlPct,0)/len
```

Additionally **the entry-side cost is omitted from `pnlPct` entirely** (entry tx cost at line 416 hits
`capital` only). So `pnlPct` ignores BOTH legs' costs (entry + exit) ≈ **22 bps round-trip**.

### 4.2 Why it is wrong

A trade's reported return must be **net of the costs that trade incurred**, otherwise:
- **Win rate is inflated:** marginal trades whose gross return is between 0 and the round-trip cost
  (~+0 to +0.22%) are counted as WINS but are actually net losers. These near-the-money trades are
  exactly where a dip-buy strategy clusters, so the bias is not uniform.
- **Profit factor is inflated:** PF = Σ gross wins / |Σ gross losses|. Removing cost from the numerator
  (shrinks wins) and adding it to the denominator (deepens losses) pushes PF down materially; the gross
  version overstates it.
- **Internal inconsistency:** equity curve (and therefore total return, Sharpe, max DD) is net, but
  WR/PF/avgTradeReturn are gross — the same backtest reports two different cost regimes. The engine path
  does NOT have this *equity-vs-trade* inconsistency in the same way (see nuance below), so the portfolio
  path is the outlier.

> **Nuance the implementer must understand (engine comparison):** `engine.ts:171–173` also computes
> `pnlPct` **gross** (it's `(fillPrice - entryPrice)/entryPrice`), and engine's win/loss tallies
> (`tradeWins/grossProfit`) are driven by that gross `pnlPct` too (engine.ts:174-175). So *engine is not
> a perfectly clean reference for "net pnlPct"* — both engines book a gross per-trade pnl. The reason
> engine's headline WR is still defensible is that engine's costs are small/symmetric and its primary
> reported series is the **net equity curve**. **For D2-2, do not "match engine" blindly.** The correct
> standard is: **report `pnlPct` net of round-trip cost** so WR/PF are honest. This is a genuine
> improvement to BOTH engines, but only portfolioBacktest is in WS2 scope. (Flag for the coordinator:
> consider a sibling finding to net engine.ts's `pnlPct` after #28 — out of WS2 scope, noted in §8.)

### 4.3 Line-level pseudo-diff (post-#29 SSOT cost form)

Charge the round-trip cost into each trade's `pnlPct`. Cleanest is a small helper so all three exit
sites stay consistent (and a future fourth exit site can't reintroduce the bug — the same
"inlined N times" hazard engine.ts called out in its `closePosition` extraction).

```diff
+ // FIX (D2-2): per-trade return NET of round-trip transaction cost, so WR/PF are honest and
+ // consistent with the net equity curve. Both legs cost TX_COST_PCT_PER_SIDE (post-#29 SSOT).
+ // grossRet = (exit-entry)/entry ; netRet ≈ grossRet - entryCostPct - exitCostPct.
+ // Exact (cost on traded notional): net = (exit*(1-c) - entry*(1+c)) / entry.
+ function netTradePnlPct(entryPrice: number, exitPrice: number, c = TX_COST_PCT_PER_SIDE): number {
+   if (!(entryPrice > 0)) return 0
+   return (exitPrice * (1 - c) - entryPrice * (1 + c)) / entryPrice
+ }
```

Exit site 1 (lines 300–311):
```diff
-     const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice
+     const pnlPct = netTradePnlPct(pos.entryPrice, exitPrice)   // NET of round-trip cost
      const pnlDollar = exitShares * (exitPrice - pos.entryPrice)   // dollar pnl: keep gross OR also net
```

Exit site 2 (line 460) and Exit site 3 (line 497):
```diff
-       pnlPct: (exitPrice - pos.entryPrice) / pos.entryPrice,
+       pnlPct: netTradePnlPct(pos.entryPrice, exitPrice),
```

**Decision points (document in C2):**
- **`pnlDollar` and `capital`:** these are ALREADY net at the capital level (cost is debited there).
  Do **not** double-charge. Leave `capital += exitShares*exitPrice - exitTxCost` and the entry debit
  exactly as-is. The fix is ONLY to the *reported per-trade percentage*. If the team wants `pnlDollar`
  to also reflect net, compute it consistently — but the equity curve must not be charged twice.
- **Cost convention:** the helper above charges `c` on both entry and exit notional (≈ matches how
  `capital` is actually debited: entry pays `shares*price*c`, exit pays `shares*exitPrice*c`). A simpler
  approximation `grossRet - 2c` is acceptable and within rounding for small `c`; prefer the exact form
  for auditability. **Pick one and state it in C2.**
- **avgTradeReturn / sectorAttribution** (lines 522-523, 543-556) automatically become net once `pnlPct`
  is net — no extra change, but note it (sector win rates will tick down).

### 4.4 Quantitative impact on §2 metrics

- Every `pnlPct` shifts down by ~**round-trip cost (~0.22% = 22 bps)** (11 bps/side × 2). Trades with
  gross return in `(0, 0.22%]` flip win→loss.
- Inspection estimate: **WR and PF inflated ~3–5 percentage points** by the current gross treatment;
  fixing it moves them **down ~3–5pp**.
- `avgTradeReturn` drops by ~22 bps; sector-level win rates drop similarly. Total return / Sharpe / max
  DD are **unchanged** (equity curve was already net) — this is the key tell that the bug is in the
  trade-stats layer, not the equity layer.

### 4.5 Regression tests to add

1. **Marginal-trade flips to loss:** fixture with a single trade, entry 100 → exit 100.10 (gross
   +0.10%, below 22 bps round-trip). Assert `trades[0].pnlPct < 0` and `winRate == 0` (was a "win"
   before).
2. **Clear winner stays a winner, but smaller:** entry 100 → exit 110. Assert `pnlPct ≈ (110*(1-c) -
   100*(1+c))/100` and that it is **strictly less** than the old `0.10`.
3. **Equity not double-charged:** assert `finalCapital` is **identical** before and after the D2-2 patch
   on a fixed fixture (proves the fix touched only reported pnl, not the cash ledger).
4. **PF direction:** deterministic fixture with mixed wins/losses; assert post-fix `profitFactor` <
   pre-fix `profitFactor`.
5. **All three exit paths covered:** one test each forcing a normal exit, a `max_drawdown` circuit-breaker
   exit, and an `end_of_data` exit; assert each booked trade's `pnlPct` is net.

---

## 5. D2-6 (MED) — enhanced-path `atrScore` is bullish when ATR is HIGH (inverted for dip-buy)

### 5.1 Current behavior (verified against `main`)

`signals.ts:553`, inside `enhancedCombinedSignal`:
```
553  const atrScore = Number.isFinite(atrPct) ? clamp((atrPct - 1.5) / 2.0, -1, 1) : 0
```
where `atrPct = (atrLast / price) * 100` (signals.ts:497). So:
- ATR% = 1.5 → score 0
- ATR% = 3.5 → score +1.0 (max **bullish**)
- ATR% = 0 (very low vol) → score −0.75 (**bearish**)

`atrScore` feeds the weighted confluence with weight `weights.atr` (default 0.10; WEIGHT_PROFILES,
signals.ts:386-391) and is summed into `totalWeightedScore` (signals.ts:568, 575), which gates BUY
(`> 0.25`) / SELL (`< -0.30`).

### 5.2 Why it is wrong

The platform's signal is, by its own documentation, a **mean-reversion / dip-buy** ensemble:
- `volumeZoneScore` docstring (signals.ts:393-411): "reflects a MEAN-REVERSION prior — the default signal
  mode for this codebase … biases the confluence score toward dip-buying."
- `volRegimeScore` (signals.ts:422-430) is the canonical volatility-to-score map and is **monotonically
  decreasing in volatility**: `low → +0.5`, `normal → +0.2`, `high → −0.3`, `crisis → −0.8`. High
  volatility is treated as **bearish/risk-off**, which is the correct sign for a dip-buy ensemble
  (you don't add risk into a vol spike; compression precedes the favorable breakout).

`atrScore` does the **opposite**: it rewards HIGH ATR as bullish. ATR% and the volatility regime are the
same underlying quantity (realized volatility), so `atrScore` and `volRegScore` are **anti-correlated by
construction** — `atrScore` **partially cancels `volRegScore`**, diluting the very risk-off signal the
ensemble is supposed to express. There is no documented rationale (unlike the `volumeZoneScore`
asymmetry, which is cited to Steidlmayer). For a dip-buy/mean-reversion prior the ATR contribution should
be **bearish when ATR is high**, i.e. the sign should be flipped (high vol → negative score), mirroring
`volRegimeScore`.

> **Caveat to state in the spec (don't overclaim):** if the desired interpretation were a pure
> *breakout/trend* strategy, "high ATR = bullish" could be defensible. But this codebase's documented
> default is mean-reversion, and `volRegimeScore` already encodes high-vol-as-bearish. The bug is the
> **inconsistency**: two indicators measuring volatility with opposite signs. The fix aligns ATR with the
> rest of the ensemble. This is a **C2 methodology change**, not a pure bug, so it needs explicit
> algorithm-lead sign-off (the same way Q1-C-5 documented the 0.15→0.25 BUY-threshold change inline at
> signals.ts:597-605).

### 5.3 Line-level pseudo-diff

Option A (minimal — flip the sign, keep the 1.5% pivot and 2.0 scale so magnitude/normalization are
unchanged; only the direction changes):
```diff
- const atrScore = Number.isFinite(atrPct) ? clamp((atrPct - 1.5) / 2.0, -1, 1) : 0
+ // FIX (D2-6): dip-buy/mean-reversion ensemble treats HIGH realized vol as risk-off (bearish),
+ // consistent with volRegimeScore (low→+0.5 … crisis→−0.8). Previously HIGH ATR scored bullish,
+ // anti-correlating with volRegScore and diluting the risk-off signal. Sign flipped; pivot/scale kept.
+ const atrScore = Number.isFinite(atrPct) ? clamp((1.5 - atrPct) / 2.0, -1, 1) : 0
```

Option B (preferred for SSOT — delegate ATR's sign to the same volatility-regime mapping the ensemble
already trusts, eliminating the possibility of future sign drift):
```diff
- const atrScore = Number.isFinite(atrPct) ? clamp((atrPct - 1.5) / 2.0, -1, 1) : 0
+ // FIX (D2-6): derive the ATR contribution from the SAME monotonic vol→score convention as
+ // volRegimeScore so the two volatility signals can never disagree in sign again.
+ // Low ATR (<1.5%) ⇒ mild bullish (compression); high ATR ⇒ bearish, capped at ±1.
+ const atrScore = Number.isFinite(atrPct) ? clamp((1.5 - atrPct) / 2.0, -1, 1) : 0
```
(Functionally A and B are the same formula; B is just the documented intent. Do **not** literally call
`volRegimeScore(detectRegime(...))` here — that would double-count the regime indicator already present
as `volRegScore` at line 562. Keep ATR as an independent, correctly-signed contributor.)

### 5.4 Quantitative impact on §2 metrics

- **Production:** enhanced path is **OFF in prod** (`resolveBacktestSignal` only calls
  `enhancedCombinedSignal` when `useEnhancedCombinedSignal()` is true; signals.ts:707). With the flag
  OFF, the regime-only path (signals.ts:710-731) is used and `atrScore` is never evaluated → **zero
  impact on current §2 metrics or the production LABEL benchmark.** State this plainly.
- **Under the enhanced flag:** weight is 0.10, score range ±1 → contribution range ±0.10. Flipping the
  sign swings any single bar's `totalWeightedScore` by up to **0.20** (from +0.10 to −0.10), which
  straddles the SELL threshold (−0.30) and is most of the BUY threshold (+0.25). In **high-volatility
  bars** (where the current code is most wrong) the fix makes BUY less likely and SELL more likely —
  i.e. fewer entries into vol spikes, more risk-off exits. Net expected effect when enhanced is enabled:
  **higher win rate, lower trade count, better drawdown** (consistent with the dip-buy thesis). Must be
  **measured** by a benchmark run under the enhanced flag, not asserted.

### 5.5 Regression tests to add

1. **Sign correctness (unit, exported helper or via `enhancedCombinedSignal`):** assert that for high
   `atrPct` (e.g. 4.0) the ATR `weightedConfirms` entry has `score < 0`, and for low `atrPct` (e.g. 0.5)
   `score > 0`. (Pre-fix this is reversed.)
2. **Consistency with volRegimeScore:** assert `Math.sign(atrScore)` agrees with
   `Math.sign(volRegScore)` across a sweep of volatility levels for the same fixture (they should never
   disagree in sign after the fix).
3. **Bounded ensemble preserved:** assert `totalWeightedScore ∈ [-1-bonuses, +1+bonuses]` still holds
   (the clamp keeps `atrScore ∈ [-1,1]`; the fix doesn't touch the bound).
4. **High-vol bar is less likely to BUY:** fixture engineered so pre-fix emits BUY purely because
   `atrScore` pushed it over 0.25; assert post-fix the same bar is HOLD/SELL.
5. **Flag-OFF no-op:** assert that with `useEnhancedCombinedSignal()` false, the resolver output is
   byte-identical pre/post fix (guards the "prod unaffected" claim).

---

## 6. D2-7 (LOW) — annualization hardcoded 252 overstates annualized return with BTC in portfolio

### 6.1 Current behavior (verified against `main`)

`portfolioBacktest.ts:507`:
```
507  const years = dates.length / 252
508  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0
```
`dates` is the **union of all instruments' trading dates** (portfolioBacktest.ts:115-119). If the
portfolio contains BTC (or any 7-day-a-week instrument), the union has ~**365 trading dates per calendar
year**, but the divisor is **252**. (Sharpe/Sortino at lines 533-540 also use `252`/`getRiskFreeRateSync(365)`
— see note.)

### 6.2 Why it is wrong

Annualization must divide elapsed bars by the instrument's **actual bars-per-year**. With 365 calendar
trading days but a 252 divisor, `years` is **understated** (e.g. 365 bars counts as 365/252 ≈ 1.45 "years"
worth of bars but the formula computes years = 365/252… ) — concretely the exponent `1/years` is **too
large**, **overstating** annualized return. `engine.ts` already solved this with
`tradingDaysPerYear(ticker, sector)` returning 365 for crypto (engine.ts:187-208), and its own comment
(engine.ts:388-390) quantifies the old hardcoded-252 bug as "overstated annualized return by ~4-5%/yr"
for crypto. Inspection estimate for the portfolio mix: **~+1.45%/yr** overstatement when BTC is present.

### 6.3 Line-level pseudo-diff

The portfolio spans **multiple instruments** with potentially different calendars, so a single scalar
isn't strictly correct. Two acceptable approaches — **pick one and document in C2**:

**Approach 1 (simple, matches engine's spirit): use 365 if ANY instrument in the portfolio is a 7-day
market, else 252.** Reuse engine's classifier (it's already the SSOT for this decision).
```diff
+ // FIX (D2-7): annualize by the portfolio's actual bars/year. The unified `dates` index is the
+ // union of all instruments' trading days; if any instrument trades 7d/wk (crypto), the union is
+ // ~365 bars/yr, so dividing by 252 overstates annualized return (engine.ts:tradingDaysPerYear SSOT).
+ // Import at top of file:  import { tradingDaysPerYear } from '@/lib/backtest/engine'
+ //   (engine.ts already exports nothing for this — see decision note; may need to export it,
+ //    which touches engine.ts → do AFTER #28, or duplicate the tiny Set locally with a TODO to
+ //    consolidate. Prefer exporting from a shared core module post-#28, see §8.)
+ const annualizationDays = tickers.some(t => isSevenDayMarket(t, sectorMap[t])) ? 365 : 252
- const years = dates.length / 252
+ const years = dates.length / annualizationDays
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0
```

**Approach 2 (most correct): derive bars/year from the actual data span** — use the real elapsed calendar
time of the unified index, which is calendar-agnostic and needs no ticker list:
```diff
- const years = dates.length / 252
+ // Calendar-accurate: dates are unix seconds; elapsed wall-clock years is exact regardless of
+ // which markets are 5d vs 7d. This sidesteps the per-instrument calendar question entirely.
+ const spanSeconds = dates.length > 1 ? (dates[dates.length - 1] - dates[0]) : 0
+ const years = spanSeconds > 0 ? spanSeconds / (365.25 * 24 * 3600) : 0
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0
```
> **Recommendation:** Approach 2 is the cleanest and most defensible (it is what the elapsed time *is*),
> and avoids the cross-file `engine.ts` export problem in §8. But it changes the equity-bars assumption
> slightly for pure-equity portfolios (252 trading days ≈ 1 calendar year is conventional). If the team
> wants reproducibility with the existing equity-only baseline, Approach 1 keeps 252 for equity-only
> portfolios exactly. **State the choice in C2.**

**Important consistency note (do not leave half-fixed):** lines **533-540** compute Sharpe/Sortino with
`Math.sqrt(252)` and `getRiskFreeRateSync(365)/252`. If you change the return-annualization basis you
should make the **risk-metric annualization consistent** with the same bars/year choice, OR explicitly
document why the risk metrics stay at 252 (engine.ts uses one `annualization` value for all three —
return, Sharpe, Sortino; portfolioBacktest currently mixes 252 with a 365-tenor RFR, which is itself a
minor inconsistency). Recommend: annualize Sharpe/Sortino with the same `annualizationDays`/derived basis
for internal consistency. Capture the before/after Sharpe in C1/C2.

### 6.4 Quantitative impact on §2 metrics

- Annualized return for any **BTC-containing** portfolio drops by ~**1.45%/yr** (inspection estimate;
  direction = down, because the current value is overstated). Pure-equity portfolios: **unchanged** under
  Approach 1; ~negligibly changed under Approach 2 (252 vs 253.x calendar-derived).
- `totalReturn`, win rate, profit factor: **unchanged** (annualization only affects the annualized
  figure and, if you also fix it, Sharpe/Sortino).
- If Sharpe/Sortino annualization is also corrected to 365 for crypto-containing portfolios, those drop
  by ~`sqrt(252/365) ≈ 0.83×` (≈17% lower), matching engine.ts's documented crypto correction
  (engine.ts:388-390). This is a **larger** visible change than the return delta — call it out
  explicitly in C1/C2 so reviewers aren't surprised.

### 6.5 Regression tests to add

1. **Equity-only unchanged (Approach 1):** all-equity fixture; assert `annualizedReturn` identical
   pre/post fix.
2. **BTC portfolio corrected:** fixture with BTC (365 cal-days) + an equity; assert post-fix
   `annualizedReturn < pre-fix annualizedReturn`, and that `years ≈ dates.length/365` (Approach 1) or
   `years ≈ spanSeconds/yr` (Approach 2).
3. **Direct years check:** a fixture spanning exactly 365 unique daily timestamps with totalReturn = 0;
   assert `annualizedReturn == 0` (sanity) and that `years` resolves to ~1.0 (Approach 2) / `365/365=1`
   (Approach 1 crypto) rather than `365/252 ≈ 1.45`.
4. **Sharpe consistency (if corrected):** assert crypto-portfolio Sharpe post-fix ≈ pre-fix × sqrt(252/365)
   within tolerance.

---

## 7. D2-5 (LOW) — `priceWasNearSmaRecently` compares PAST prices vs TODAY's SMA (mild look-ahead)

### 7.1 Current behavior (verified against `main`)

`signals.ts:180–190`:
```
180  export function priceWasNearSmaRecently(closes: number[], thresholdPct = 5): boolean {
181    if (closes.length < 220) return false
182    const window = closes.slice(-20)          // the last 20 PAST closes (incl. today)
183    const smaNow = sma(closes, 200)           // TODAY's 200-SMA (single scalar)
184    if (smaNow == null) return false
185    for (const px of window) {                // each past price…
186      const dev = ((px - smaNow) / smaNow) * 100   // …compared to TODAY's SMA
187      if (dev >= -thresholdPct) return true
188    }
189    return false
190  }
```
This is the `nearSma` gate used by `regimeSignal` (signals.ts:238, 268) to allow dip BUYs ("price was
recently near SMA → not a forever-falling stock").

### 7.2 Why it is wrong

The function asks "was the price within −5% of the 200-SMA at some point in the last 20 bars?" — but it
compares each of the **past 20 closes** against **today's single 200-SMA value** (`smaNow`). On bar
`t-k`, the contemporaneous SMA was `sma(closes[0 … t-k], 200)`, which differs from `sma(closes[0 … t],
200)`. So the test uses information (today's SMA) that did not exist at the time of the past price. This
is **mild look-ahead**: in a falling market today's SMA is **lower** than the past SMAs, so
`(px - smaNow)/smaNow` is **less negative** than the true contemporaneous deviation → the gate passes
more easily than it should, **broadening the dip-BUY zone**. (Severity LOW: the SMA moves slowly over 20
bars, so the discrepancy is small; but it is directionally a look-ahead that loosens a BUY gate.)

### 7.3 Line-level pseudo-diff

Compare each past price against the **SMA as it stood at that past bar**. Compute a rolling 200-SMA array
once and index it (mirrors how engine pre-computes ATR over all bars to avoid per-bar look-ahead,
engine.ts:228). Use the canonical full-series SMA (the repo has `emaFull`; confirm a `smaFull`/array
variant exists in `lib/quant/indicators.ts`, else compute the trailing mean inline).

```diff
  export function priceWasNearSmaRecently(closes: number[], thresholdPct = 5): boolean {
    if (closes.length < 220) return false
-   const window = closes.slice(-20)
-   const smaNow = sma(closes, 200)
-   if (smaNow == null) return false
-   for (const px of window) {
-     const dev = ((px - smaNow) / smaNow) * 100
-     if (dev >= -thresholdPct) return true
-   }
-   return false
+   // FIX (D2-5): compare each of the last 20 closes against the 200-SMA AS IT STOOD ON THAT BAR,
+   // not today's SMA (which embeds future information relative to the past bar — mild look-ahead
+   // that loosens the dip-BUY gate in falling markets).
+   const n = closes.length
+   for (let k = 0; k < 20; k++) {
+     const t = n - 1 - k                 // index of the past bar
+     if (t < 199) break                  // need 200 bars of history to form that bar's SMA
+     // contemporaneous 200-SMA at bar t = mean(closes[t-199 .. t])
+     let s = 0
+     for (let j = t - 199; j <= t; j++) s += closes[j]
+     const smaAtT = s / 200
+     if (smaAtT <= 0 || !Number.isFinite(smaAtT)) continue
+     const px = closes[t]
+     const dev = ((px - smaAtT) / smaAtT) * 100
+     if (dev >= -thresholdPct) return true
+   }
+   return false
  }
```
> **Performance note:** the naive double loop is O(20×200)=4000 ops per call — negligible at signal
> cadence. If a hot path matters, precompute a rolling SMA array once (a `smaFull(closes, 200)` analogous
> to `emaFull`) and index `smaArr[t]`. **Prefer the canonical array helper if one exists** to avoid a
> third inline SMA implementation (SSOT hygiene).

### 7.4 Quantitative impact on §2 metrics

- Affects only the **regime-only path's** dip-BUY gating (and the enhanced path via `regimeSignal`). It
  **tightens** the gate slightly in downtrends (fewer marginal dip BUYs into falling-SMA names). Effect
  on §2 metrics is **small** (LOW): marginally fewer trades, marginally higher average quality. Direction
  on WR: slightly **up** (removes some forever-falling entries that the look-ahead let through). Must be
  measured, but expect it within noise relative to D2-1/D2-2.
- This path **is live in production** (regime-only is the prod path), so unlike D2-6 it **will** perturb
  the production-relevant signal gate — treat its re-baseline with the same C1/C2 rigor as D2-1/D2-2 even
  though it's LOW severity. (Important: a "LOW" magnitude change that touches the *production* path still
  needs the freeze ceremony.)

### 7.5 Regression tests to add

1. **Falling market, contemporaneous gate is stricter:** construct `closes` strictly decreasing for 220
   bars such that the past price was −7% below its *own* SMA but only −3% below *today's* (lower) SMA.
   Assert post-fix returns `false` (gate closed) where pre-fix returned `true`.
2. **Genuinely near recently → still true:** a series where 10 bars ago the price was within −2% of that
   bar's SMA; assert `true` both pre and post.
3. **Insufficient history guard:** `closes.length` in [200, 220) → assert `false` (unchanged).
4. **No regression on flat market:** flat series where SMA ≈ price throughout; assert `true` both
   pre/post (the fix must not change the easy case).

---

## 8. Cross-file / sequencing hazards the implementer must respect

1. **D2-7 Approach 1 wants `tradingDaysPerYear` from `engine.ts`.** That symbol is currently a
   **non-exported** local in engine.ts (engine.ts:193). Exporting it edits engine.ts → **OFF-LIMITS until
   #28 merges.** Options, in order of preference:
   - Use **D2-7 Approach 2** (calendar-derived years) → no engine.ts dependency at all. **Recommended.**
   - After #28 merges, extract the crypto-calendar Set + `tradingDaysPerYear` into a shared
     `lib/backtest/core.ts` (this also helps D1-1's circular-dep fix, which the inspection already plans
     to route through a `core.ts` extraction post-#28) and import from both engines.
   - Last resort: duplicate the tiny `CRYPTO_TICKERS_365` Set locally in portfolioBacktest with a
     `// TODO: consolidate with engine.ts post-#28` — accept the temporary duplication.
2. **All `0.0011` literals in portfolioBacktest become `TX_COST_PCT_PER_SIDE` after #29.** Write D2-1 and
   D2-2 pseudo-diffs against the **post-#29** form (this spec already does). If, for any reason, D2-1/D2-2
   must land before #29 (not recommended), the implementer must NOT add fresh `0.0011` — import the
   SSOT (`import { TX_COST_PCT_PER_SIDE } from '@/lib/backtest/engine'` or from `executionModel`) to
   avoid re-introducing D2-3.
3. **Out-of-WS2-scope siblings discovered while verifying (flag to coordinator, do NOT fix here):**
   - `engine.ts` also books a **gross** per-trade `pnlPct` (engine.ts:171-175) feeding its WR/PF. If the
     team wants WR/PF honest *everywhere*, a sibling to D2-2 should net engine's `pnlPct` too — but that's
     engine.ts (#28) territory and a separate re-baseline. Noted for completeness.
   - portfolioBacktest entry-ATR uses the **signal bar's** ATR via `atrAdaptiveStop(price, bars, …)`
     (line 411) whereas engine uses the **prior** bar (`atrVals[i-1]`, engine.ts:360, "signal bar's own
     TR not yet closed"). Minor look-ahead in the stop geometry; out of scope for the 5 listed findings
     but worth a follow-up ticket.

---

## 9. Re-baseline protocol (this repo FREEZES WR-affecting invariants)

This repo treats win-rate-affecting changes as **frozen invariants**: any change to them must be
accompanied by a documented **C1 "capture old metric"** and **C2 "justify new metric"** record in
`reviews/invariants-baseline.md`. (Cross-reference: the inspection program §261 explicitly notes
"invariants-baseline.md is touched by open PR #28 — sequence A3 AFTER #28 merges, or keep edits to
non-§1c regions." The same applies to every WR change below.)

### 9.1 Which findings need the ceremony

| Finding | Touches prod path? | Re-baseline (C1+C2)? |
|---|---|---|
| D2-1 | yes (portfolio-sim §2, shown in UI) | **YES — mandatory** |
| D2-2 | yes (WR/PF directly) | **YES — mandatory** |
| D2-5 | yes (regime-only is the PROD signal path) | **YES** (LOW magnitude, but prod path) |
| D2-7 | yes (reported annualized §2 metric) | **YES** (metric value changes) |
| D2-6 | NO while enhanced flag OFF | **only if/when the flag is flipped on**; capture under the flag |

### 9.2 Sequencing (because the ledger file is inside PR #28)

```
[OWNER] merge #28  (engine.ts T+1 exit symmetry + establishes invariants-baseline.md §1c)
   └─> reviews/invariants-baseline.md now exists in its post-#28 form on main
[OWNER] merge #29  (cost SSOT rewrites portfolioBacktest cost handling; D2-3 closed)
   └─> portfolioBacktest.ts now uses TX_COST_PCT_PER_SIDE
[IMPLEMENTER] branch  fix/portfolio-sim-rebaseline  (off post-#29 main)
   1. Capture C1: run the §2 portfolio-sim benchmark on CURRENT main; record WR, PF, totalReturn,
      annualizedReturn, Sharpe, Sortino, trade count → paste into invariants-baseline.md as the
      "old" frozen values, with commit SHA + date + exact command.
   2. Implement D2-1 + D2-2 + D2-7 (one combined branch — they perturb the same §2 numbers).
   3. Re-run the SAME benchmark → record "new" values.
   4. Write C2: for each metric, the delta + the citation (D2-1: T+1/look-ahead, engine FIX-C2,
      López de Prado 2018 ch3; D2-2: net-of-cost trade accounting; D2-7: calendar annualization,
      engine.ts:388-390). Update the frozen §2 numbers to the NEW values.
   5. tsc + vitest green (incl. the new regression tests in §3.5/§4.5/§6.5).
   6. Commit branch; DO NOT push/PR (Bucket B; coordinator advisor checkpoint gates it).
[IMPLEMENTER] branch  fix/signals-atr-dipbuy  (off post-#28 main)
   1. D2-6 (+ optionally D2-5). For D2-6, capture C1/C2 UNDER the enhanced flag (it's a no-op with
      the flag OFF — note that explicitly so reviewers know prod metrics are untouched).
   2. For D2-5 (prod path), capture C1/C2 on the regime-only path (prod default).
   3. tsc + vitest green; commit; no push/PR.
```

### 9.3 Verification recipe (from the brief — the repo path contains `@`, which breaks npm-script ESM
resolution, so call the binaries directly from your worktree)

```sh
# from your worktree root:
ln -s "/Users/haohengwang/Library/CloudStorage/GoogleDrive-wanghaoheng123@gmail.com/My Drive/QUANTAN-sector-investment/node_modules" node_modules
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/dist/cli.js run
# plus the §2 portfolio-sim benchmark command the repo uses to produce the frozen metrics
# (capture C1 before, C2 after — same command, same data, same seed).
```

### 9.4 What "green" means here

Baseline (per inspection §1): **tsc clean · vitest 979 pass / 17 skip · build PASS**. After adding the
regression tests in this spec the pass count rises; the floor (816) must not be crossed and no previously
passing test may break **except** the ones that assert the OLD (buggy) WR/PF/return numbers — those are
*expected* to change and MUST be updated in the same commit as the C2 justification (this is the normal
re-baseline flow, not a regression).

---

## 10. Verification log (what WS2 actually checked, per "verify before asserting")

- **D2-1 confirmed CURRENT:** `portfolioBacktest.ts:345` `const price = row.close`; entry debits at
  `price` (lines 416-417); `entryPrice: price` (line 423); lookback includes today (line 347). The BUY
  loop has **no `idx+1` bound** and **no next-open fill** — engine.ts's FIX-C2 (lines 231-243, 339) was
  never ported. **NOT already handled.**
- **D2-2 confirmed CURRENT:** all three exit sites compute `pnlPct = (exitPrice - entryPrice)/entryPrice`
  gross (lines 300, 460, 497) while `capital` is debited net (lines 304, 454, 491); WR/PF derive from the
  gross series (lines 517-521). Entry cost also omitted from `pnlPct`. **NOT already handled.** (Verified
  nuance: engine.ts also books gross `pnlPct` at 171-175 — so "match engine" is the wrong target; the
  correct target is net-of-cost. Documented in §4.2.)
- **D2-6 confirmed CURRENT:** `signals.ts:553` `clamp((atrPct - 1.5)/2.0, -1, 1)` → high ATR = +score,
  which is anti-correlated with `volRegimeScore` (lines 422-430, monotonically decreasing in vol). Enhanced
  path gated OFF in prod (`resolveBacktestSignal` line 707). **NOT already handled; prod-inert until flag
  flips.**
- **D2-5 confirmed CURRENT:** `signals.ts:183` `const smaNow = sma(closes, 200)` (today's SMA) compared
  to `closes.slice(-20)` past prices (lines 182, 185-187). **NOT already handled.** Live in the
  regime-only prod path.
- **D2-7 confirmed CURRENT:** `portfolioBacktest.ts:507` `const years = dates.length / 252` with `dates`
  = union of all instruments (lines 115-119); BTC makes that ~365/yr. engine.ts already fixed the analog
  via `tradingDaysPerYear` (lines 187-208) and quantifies the bug (lines 388-390). Sharpe/Sortino at
  533-540 also hardcode 252 (with a 365-tenor RFR — minor internal inconsistency). **NOT already
  handled.**
- **D2-3 (context):** the four `0.0011` literals (lines 303, 416, 454, 491) are present on CURRENT main
  but are **slated for removal by PR #29** (inspection marks D2-3 "FIXED by open PR #29"). All cost
  pseudo-diffs in this spec are written for the post-#29 SSOT form.

### Files WS2 could not re-open (transient harness/FS stall mid-session) — assumptions stated
A mid-session tool stall prevented re-reading four supporting files. Where they bear on this spec, the
content is cross-referenced from authoritative sources already confirmed in-session, and the dependency
is flagged so the implementer verifies before coding:
- `lib/backtest/executionModel.ts` — cost SSOT. Confirmed indirectly: `engine.ts:11-16` imports
  `costBpsPerSide, DEFAULT_EXECUTION_COSTS` and exports `TX_COST_PCT_PER_SIDE`; inspection D2-3 confirms
  the per-side cost is the 11 bps that portfolioBacktest's `0.0011` literals approximate. **Implementer:
  confirm `TX_COST_PCT_PER_SIDE` is the symbol to import post-#29.**
- `reviews/invariants-baseline.md` — the C1/C2 freeze ledger. Protocol (C1 capture / C2 justify) is taken
  from the WS2 brief and inspection §261; the file is OFF-LIMITS (PR #28) anyway, so WS2 only specifies
  *what* to record, not edits to it.
- `lib/featureFlags.ts` — `useEnhancedCombinedSignal()`. The "enhanced path OFF in prod" fact is stated
  in the WS2 brief (D2-6) and inspection D2-6/§275, and is consistent with `resolveBacktestSignal`'s
  branch (signals.ts:707-731). **Implementer: confirm the flag default is OFF before claiming D2-6 is
  prod-inert.**
- `lib/backtest/exitRules.ts` — `checkExitConditions`/`atrAdaptiveStop` signatures used in the D2-1/D2-2
  exit paths. Their call sites and return shapes are fully visible in portfolioBacktest.ts
  (lines 278-281, 284-286, 411) and engine.ts (`evaluateStopHit`), which is sufficient for the
  pseudo-diffs (no change to these helpers is required by any WS2 finding).

---

## 11. One-paragraph hand-off

Implement in two branches **after #28 and #29 merge**. Branch 1 (`fix/portfolio-sim-rebaseline`) fixes
the three `portfolioBacktest.ts` items that move the §2 numbers — **D2-1** (fill BUYs at tomorrow's
open+2bps instead of today's close; this is the big one), **D2-2** (report `pnlPct` net of the ~22 bps
round-trip so WR/PF stop being inflated 3–5pp), and **D2-7** (annualize by real calendar bars/yr, not a
hardcoded 252, which overstates BTC-inclusive annualized return ~1.45%/yr) — as a single re-baseline with
C1/C2 recorded in `invariants-baseline.md`. Branch 2 (`fix/signals-atr-dipbuy`) fixes **D2-6** (flip the
inverted ATR score so high volatility is risk-off like the rest of the dip-buy ensemble; prod-inert until
the enhanced flag flips) and **D2-5** (compare past prices to the contemporaneous 200-SMA, not today's,
closing a mild look-ahead in the live regime gate). Every WR-affecting change carries the C1-capture /
C2-justify ceremony; none of this touches the honest 53.79% production LABEL benchmark. Verify with the
direct-binary tsc+vitest recipe (the `@` in the repo path breaks npm scripts). Bucket B → commit branches
but do **not** push/PR; the coordinator runs an advisor checkpoint before greenlighting.
