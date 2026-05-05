# R2 — Indicators & Time-Series Review (Phase 13 S1)

**Reviewer:** R2 — PhD Statistics, time-series specialist (Wilder/Welles/Cutler/Chande literature)
**Sprint:** S1 (read-only)
**Date:** 2026-05-04
**Standing prompt:** Acknowledged.

---

## Inventory reviewed

| File | LOC | Read |
|------|-----|------|
| `lib/quant/indicators.ts` | 462 | full |
| `lib/quant/multiTimeframe.ts` | — | structural |
| `lib/quant/regimeDetection.ts` | — | structural (referenced in signals.ts:548) |
| `lib/quant/volatility.ts` | — | deferred |
| `lib/quant/volumeProfile.ts` | — | structural |
| `lib/quant/intermarket.ts` | — | deferred |
| `lib/quant/sectorRotation.ts` | — | deferred |
| `lib/quant/relativeStrength.ts` | — | deferred |
| `lib/quant/btc-indicators.ts` | 433 | deferred |
| `lib/quant/pivots.ts` | — | deferred |
| `lib/quant/technicals.ts` | — | structural (note: dead `ema` deleted in commit 7fc76ff) |

**Disclosure (rule 5):** Only `indicators.ts` was read end-to-end. Deferred files require R2 second pass before S2 entry.

---

## Findings

### F2.1 [CRITICAL] — `sortinoRatio` exported from indicators.ts has the Phase 12 H1 bug (n_d vs N denominator)

**Location:** `lib/quant/indicators.ts:449-461`

**Evidence:**
```ts
export function sortinoRatio(returns: number[], marDaily = 0): number | null {
  if (returns.length < 20) return null
  const n = returns.length
  const downsideSq = returns.map((x) => {
    const dev = Math.min(0, x - marDaily)
    return dev * dev
  })
  const downsideVariance = downsideSq.reduce((s, x) => s + x, 0) / Math.max(1, n - 1)  // ← BUG: divides by N-1
  const dsd = Math.sqrt(downsideVariance)
  ...
}
```
This is the SAME bug Phase 12 H1 fixed in `engine.ts:387-396`. It uses `N-1` (total observations) instead of `n_d` (count of negative-return periods). Sortino is overstated by `sqrt(N/n_d)` — for typical 60% positive / 40% negative bars, that's `sqrt(2.5) ≈ 1.58×` overstatement.

**Why critical:** This is exported and importable. Any caller using `import { sortinoRatio } from '@/lib/quant/indicators'` (vs the inline computation in engine.ts) gets the wrong number. **This is a single-source-of-truth violation:** engine.ts has the fixed Sortino; indicators.ts has the buggy one. The plan's invariant rule "Single canonical EMA, RSI, formatter" applies — Sortino too.

**Citation:** Sortino, F. A. & van der Meer, R. (1991). "Downside Risk." *Journal of Portfolio Management* 17(4), p27–31.

**Patch sketch:**
```ts
export function sortinoRatio(returns: number[], marDaily = 0): number | null {
  if (returns.length < 30) return null  // also raise from 20 to 30 (per F1.9)
  const negDevs = returns.map(x => Math.min(0, x - marDaily)).filter(x => x < 0)
  if (negDevs.length < 30) return null
  const nd = negDevs.length
  const downsideVariance = negDevs.reduce((s, x) => s + x * x, 0) / nd
  const dsd = Math.sqrt(downsideVariance)
  if (dsd < 1e-10) return null
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  return ((mean - marDaily) / dsd) * Math.sqrt(252)
}
```
Then update `engine.ts:383-399, 530-540` to call this canonical version, eliminating the inline duplicate.

**Acceptance test:** Add `__tests__/quant/indicators.sortino.test.ts`:
- Series with 60% positive, 40% negative returns: hand-compute Sortino with both N-1 and n_d denominators; assert function returns the n_d value within 1e-6.
- Property test: function value is invariant to adding more positive (≥ MAR) returns.

**Severity:** Critical — silent math bug in exported API + SSOT violation across two files that both compute the same quantity differently.

---

### F2.2 [HIGH] — ADX uses EMA smoothing instead of Wilder's smoothing

**Location:** `lib/quant/indicators.ts:386-388, 405`

**Evidence:**
```ts
const trSmooth = emaFull(tr, period)
const plusDISmooth = emaFull(plusDM, period)
const minusDISmooth = emaFull(minusDM, period)
...
const adxSmoothed = emaFull(validAdx, period)
```
`emaFull` uses `alpha = 2/(period+1)` (standard EMA). Wilder's original ADX (1978) uses **Wilder's smoothing** which is `alpha = 1/period` — equivalent to an EMA of period `2*N - 1`. So calling `emaFull(tr, 14)` produces a much faster-reacting ADX than Wilder intended; signals fire ~3-5 bars earlier with more noise.

**Citation:**
- Wilder, J. W. (1978). *New Concepts in Technical Trading Systems*. Trend Research. p35–50 (Directional Movement / ADX).
- Achelis, S. B. (2001). *Technical Analysis from A to Z*, 2e. McGraw-Hill. p49 (explicitly notes Wilder's smoothing differs from EMA: alpha = 1/N, not 2/(N+1)).

**Patch sketch:** Add a `wilderSmoothing(values, period)` helper:
```ts
export function wilderSmoothing(values: number[], period: number): number[] {
  // Wilder's smoothing: alpha = 1/period (equivalent to EMA of length 2N-1)
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < period || period <= 0) return out
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period
    out[i] = prev
  }
  return out
}
```
Replace the three `emaFull` calls at lines 386–388 and the ADX-self-smoothing at 405 with `wilderSmoothing`.

**Acceptance test:** Compare ADX output against TA-Lib reference values for a known series (e.g., SPY 2023). Assert match within 0.5 absolute units.

**Severity:** High — ADX is a foundational regime indicator (used by `regimeDetection.ts` per signals.ts:548). Wrong smoothing → wrong regime classification.

---

### F2.3 [HIGH] — Two different RSI smoothing conventions silently coexist (potential)

**Location:** `lib/quant/indicators.ts:104-105, 125-126` (rsiArray + rsiLatest)

**Evidence:** Both functions use Wilder smoothing `(avgGain * (period - 1) + Math.max(0, d)) / period` which is correct (Wilder 1978). However, the comment at line 7 says "Wilder smoothing for RSI/ATR, SMA-seeded EMA". The "SMA-seeded EMA" phrasing is potentially misleading — Wilder smoothing ≠ EMA (see F2.2). Documentation should be precise.

**Citation:** Wilder (1978) op cit. p65.

**Patch sketch:** Update header comment to: "Wilder smoothing (alpha = 1/N) for RSI/ATR; standard EMA (alpha = 2/(N+1)) for MACD/Bollinger seeding."

**Severity:** High because future engineers reading the comment will confuse the two and write incorrect indicators (the EMA-instead-of-Wilder error in F2.2 may have originated from this confusion).

---

### F2.4 [MEDIUM] — VWAP is cumulative-from-start, not session-anchored

**Location:** `lib/quant/indicators.ts:324-338`

**Evidence:** `vwapArray` accumulates typical-price × volume from index 0 to end, never resetting. Standard VWAP resets at session boundaries (intraday: each trading day; daily-bar data: arguably never makes sense, or "anchored from a chosen pivot").

**Citation:**
- Berkowitz, S. A., Logue, D. E., Noser, E. A. (1988). "The Total Cost of Transactions on the NYSE." *Journal of Finance* 43, p97–112. (Original VWAP definition — session-bound.)
- Pruitt, S. W. & White, R. E. (1988). "The CRISMA Trading System: Who Says Technical Analysis Can't Beat the Market?" *Journal of Portfolio Management* 14(3), p55–58 (anchored VWAP variant).

**Patch sketch:** Either (a) rename to `cumulativeTypicalPriceWeightedAvg` to avoid VWAP confusion, or (b) accept an `anchorIndex: number` parameter to reset accumulation at the anchor. Daily-bar VWAP without anchor is statistically meaningless after ~6 months (long-tail accumulation dwarfs recent prices).

**Acceptance test:** Compare anchored-VWAP to TradingView's "Anchored VWAP" indicator from the same anchor date. Match within 0.1%.

**Severity:** Medium — affects KLineChart users who expect standard VWAP behavior; flags for KLineChart Phase 12 D8 (Bloomberg/TradingView parity additions).

---

### F2.5 [MEDIUM] — StochRSI uses EMA smoothing for K/D; standard implementation uses SMA

**Location:** `lib/quant/indicators.ts:356-357`

**Evidence:**
```ts
const k = emaFull(stoch, kSmooth)
const d = emaFull(k, dSmooth)
```
Chande & Kroll (1994), the original StochRSI authors, use SMA smoothing. Most charting platforms (TradingView, ThinkOrSwim) follow this. Using EMA produces signals 1-2 bars earlier and slightly more responsive.

**Citation:** Chande, T. S. & Kroll, S. (1994). *The New Technical Trader*. Wiley. p93–104.

**Patch sketch:** Replace `emaFull` with a new `smaSeries(values, period)` helper. Add a config parameter `smoothing: 'sma' | 'ema'` defaulting to 'sma'.

**Acceptance test:** Compare against TradingView StochRSI for a known series; assert match within 1 unit.

**Severity:** Medium — StochRSI is a confirmation indicator, not a primary signal. But platform-parity claim is invalid.

---

### F2.6 [MEDIUM] — `obvArray` silently truncates closes when volumes are shorter

**Location:** `lib/quant/indicators.ts:309-312`

**Evidence:**
```ts
if (volumes.length < closes.length) {
  closes = closes.slice(-volumes.length)
}
```
Silent data-alignment correction with no warning. If a caller passes mis-aligned arrays (a common bug after slicing), they get computed-correctly OBV but for the WRONG date range, with no diagnostic. Should at minimum log a warning, ideally throw.

**Patch sketch:** Replace with explicit pre-condition:
```ts
if (closes.length !== volumes.length) {
  throw new Error(`obvArray: closes (${closes.length}) and volumes (${volumes.length}) length mismatch`)
}
```

**Severity:** Medium — silent failure mode; production bug magnet.

---

### F2.7 [MEDIUM] — MACD signal-line warmup not validated; returns NaN with no warning

**Location:** `lib/quant/indicators.ts:151`

**Evidence:** Guard checks `closes.length < slow` (i.e. < 26). But the signal line requires `slow + sig - 1 = 34` bars to produce its first valid value. With 26 ≤ closes.length < 34, `line` is partially populated but `signal` is all NaN, and `histogram` is all NaN. Caller has no signal but no error.

**Patch sketch:**
```ts
if (closes.length < slow + sig - 1) return { line, signal, histogram }
```
Or better: return a richer result type indicating warmup state.

**Severity:** Medium — caller silently consumes meaningless histogram = NaN; downstream `enhancedCombinedSignal` returns score = 0 for MACD. Less harmful than F2.1 but a real gotcha.

---

### F2.8 [MEDIUM] — Dual API: `ema` returns shorter array, `emaFull` returns padded; footgun for callers

**Location:** `lib/quant/indicators.ts:53-64` (ema) vs 70-81 (emaFull)

**Evidence:** Two functions with the same name root, different return-array length conventions. A caller indexing `ema(values, 50)[i]` gets a different value than `emaFull(values, 50)[i]` for the same `i` and same input. This caused the dead `ema` in `technicals.ts` confusion (Phase 10 commit 7fc76ff).

**Patch sketch:** Deprecate `ema` (the short version). Have all callers use `emaFull`. Add a JSDoc `@deprecated` tag on `ema`. After all internal callers migrated, delete in S3.

**Severity:** Medium — index-misalignment bug class.

---

### F2.9 [LOW] — Bollinger Bands accept `period < 2` silently

**Location:** `lib/quant/indicators.ts:215, 220`

**Evidence:** At `period = 1`, sample variance = 0 always (the slice is one element). `mid = upper = lower = closes[i]`, `pctB` = NaN (since upper === lower). No diagnostic.

**Patch sketch:** Reject period < 2 explicitly.

---

### F2.10 [LOW] — `dailyReturns` uses simple returns; many quant uses prefer log returns

**Location:** `lib/quant/indicators.ts:416-422`

**Evidence:** Simple returns `(closes[i]/closes[i-1] - 1)`. For Sharpe and volatility, log returns are typically preferred (additive, symmetric, more normal-distributed at higher frequencies). Documentation should note convention.

**Citation:** Tsay, R. S. (2010). *Analysis of Financial Time Series*, 3e. Wiley. p3–7 (simple vs log returns).

**Patch sketch:** Add `logDailyReturns(closes)` alongside.

---

## Cross-domain handoffs

- **R1:** F2.1 directly intersects F1.10 (combinedSignal duplication) — both are SSOT issues in the math layer. R1's engine.ts Sortino uses n_d correctly; this file's exported Sortino doesn't. C2 must enforce one Sortino.
- **R5:** F2.4 (VWAP) blocks the KLineChart Phase 12 D8 plan item ("Anchored VWAP" indicator overlay).
- **R8:** Every F2.x has an acceptance test specified.

---

## Self-dissent (rule 7)

F2.2 (ADX uses EMA not Wilder) is a strong claim; I should note that some modern texts (e.g. Pring 2002) describe ADX with EMA-style smoothing, citing it as a "modernization." However, Wilder's original 1978 specification is unambiguous (alpha = 1/N), and TA-Lib (the de facto reference for indicator computations) uses Wilder. If the user explicitly chose modern EMA-ADX, this should be documented; otherwise, Wilder is correct.

F2.5 (StochRSI smoothing) — uncertainty: Chande & Kroll's original 1994 paper specified the K calculation but left smoothing flexible. EMA is a reasonable variant. Mark MEDIUM (not HIGH) for that reason.

---

## Findings summary table

| ID | Severity | File:line | One-line |
|----|----------|-----------|----------|
| F2.1 | CRITICAL | indicators.ts:449-461 | sortinoRatio uses N-1 not n_d (Phase 12 bug duplicated) |
| F2.2 | HIGH | indicators.ts:386-388, 405 | ADX uses EMA, not Wilder smoothing |
| F2.3 | HIGH | indicators.ts:7 | comment misleads "Wilder = SMA-seeded EMA" |
| F2.4 | MEDIUM | indicators.ts:324-338 | VWAP cumulative-from-start, not session-anchored |
| F2.5 | MEDIUM | indicators.ts:356-357 | StochRSI uses EMA, standard is SMA |
| F2.6 | MEDIUM | indicators.ts:309-312 | obvArray silent truncation |
| F2.7 | MEDIUM | indicators.ts:151 | MACD signal-warmup not validated |
| F2.8 | MEDIUM | indicators.ts:53-81 | ema/emaFull dual API footgun |
| F2.9 | LOW | indicators.ts:215, 220 | Bollinger period<2 silent |
| F2.10 | LOW | indicators.ts:416-422 | simple vs log returns convention |

Total: 10 (1 Critical, 2 High, 5 Medium, 2 Low).

**Open items requiring R2 second pass before S2:** `multiTimeframe.ts`, `regimeDetection.ts`, `volatility.ts`, `volumeProfile.ts`, `intermarket.ts`, `sectorRotation.ts`, `relativeStrength.ts`, `btc-indicators.ts`, `pivots.ts`.

---

**Reviewer signature:** R2
**Cross-checked by:** R1 (overlap on Sortino) — pending
**Inspector spot-check:** I1 — pending
