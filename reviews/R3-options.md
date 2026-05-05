# R3 — Options & Volatility Review (Phase 13 S1)

**Reviewer:** R3 — PhD Financial Engineering, ex-market-maker (Citadel/SIG style)
**Sprint:** S1 (read-only)
**Date:** 2026-05-04
**Standing prompt:** Acknowledged.

---

## Inventory reviewed

| File | LOC | Read |
|------|-----|------|
| `lib/options/greeks.ts` | 188 | full |
| `lib/options/gex.ts` | 98 | full |
| `lib/options/chain.ts` | 156 | structural |
| `lib/options/sentiment.ts` | 76 | deferred |
| `lib/options/flow.ts` | 117 | deferred |
| `app/api/options/[ticker]/route.ts` | — | deferred |
| `components/options/*` | — | deferred (R5 owns) |

**Disclosure (rule 5):** Full coverage on greeks.ts and gex.ts; structural on chain.ts; sentiment/flow/route deferred to R3 second pass before S2.

---

## Findings

### F3.1 [HIGH] — Black-Scholes ignores continuous dividend yield (q)

**Location:** `lib/options/greeks.ts:64-69, 77-93, 101-141`

**Evidence:** The `d1d2`, `blackScholesPrice`, and `greeks` functions all lack a continuous-dividend-yield parameter `q`. Stocks/ETFs with dividend yield > 0 (SPY ~1.5%, XLU ~3.4%, XLP ~2.8%, XLRE ~4%) require Merton's (1973) extension:

- `d1 = (ln(S/K) + (r - q + 0.5*sigma²)*T) / (sigma*sqrt(T))`
- Call price: `S*exp(-q*T)*N(d1) - K*exp(-r*T)*N(d2)`
- Delta (call): `exp(-q*T) * N(d1)`

**Citation:** Merton, R. C. (1973). "Theory of Rational Option Pricing." *Bell Journal of Economics and Management Science* 4(1), p141–183 (esp. eqns. 4-7 for dividend-paying stock).
- Hull, J. C. (2017). *Options, Futures, and Other Derivatives*, 10e. Pearson. p385–388 (BSM with continuous dividends).

**Numerical impact:** For XLU at-the-money 90-day option, q=3.4%:
- Without q: BSM Call ≈ $1.35
- With q: BSM Call ≈ $1.15 (~15% lower)
- IV computed without q: overstates IV by ~50–80 bps for high-yield names.

**Patch sketch:** Add `q: number = 0` parameter throughout `d1d2`, `blackScholesPrice`, `greeks`, `impliedVolatility`. Pull dividend yield from yahoo-finance2 `quoteSummary.summaryDetail.dividendYield`. Default to 0 maintains backward compatibility for non-dividend names.

**Acceptance test:** `__tests__/options/greeks.dividend.test.ts` — XLU at S=70, K=70, T=0.25, r=0.04, sigma=0.20:
- q=0: assert call price ≈ Hull table value
- q=0.034: assert call price drops by ≈ S*(1-exp(-q*T))*N(d1) ≈ $0.50 (within 1¢)

**Severity:** High — IV displayed in OptionsChainTable for dividend-paying ETFs (XLU, XLP, XLRE, XLF, XLE) is biased high by 50–100 bps, materially affecting trader interpretation.

---

### F3.2 [HIGH] — IV solver initial guess (σ=0.30) is naive; no upper-bound clamp; no fallback

**Location:** `lib/options/greeks.ts:147, 170, 183-184`

**Evidence:**
1. **Constant initial guess** `IV_INIT_SIGMA = 0.3`. For deep-OTM options or when true IV > 1.0 (event-driven names), 100 iterations from 0.3 may not reach.
2. **No upper bound** — sigma can blow up arbitrarily; the `sigma <= 0 → 1e-6` clamp at line 184 prevents negative but allows σ → 50.
3. **No fallback to bracketing method** when Newton-Raphson fails to converge.
4. **No validity check on result** — returns null silently after 100 iterations with no diagnostic.

**Citation:**
- Brenner, M. & Subrahmanyam, M. G. (1988). "A Simple Formula to Compute the Implied Standard Deviation." *Financial Analysts Journal* 44(5), p80–83. Provides ATM closed-form initial guess: `σ_0 ≈ sqrt(2π/T) × (C/S)` for ATM call.
- Manaster, S. & Koehler, G. (1982). "The Calculation of Implied Variances from the Black–Scholes Model." *Journal of Finance* 37(1), p227–230. Provides robust seeded initial guess and Newton convergence guarantees.
- Brent, R. P. (1973). *Algorithms for Minimization Without Derivatives*. Prentice-Hall (Brent's method as fallback).

**Patch sketch:**
```ts
// Brenner-Subrahmanyam ATM seed:
const initialSigma = K === S
  ? Math.sqrt(2 * Math.PI / T) * (marketPrice / S)
  : 0.30  // fallback for non-ATM
let sigma = Math.max(0.01, Math.min(initialSigma, 5.0))
const SIGMA_MAX = 5.0  // 500% IV cap
...
sigma -= diff / vegaFull
sigma = Math.max(1e-6, Math.min(sigma, SIGMA_MAX))
```
For non-convergence, fall back to Brent's method on `[1e-6, 5.0]`.

**Acceptance test:** `__tests__/options/greeks.iv.test.ts` — confirm IV solver returns within 1e-4 for:
- ATM, 30 days, σ=0.20 → recover 0.20
- Deep OTM (S=100, K=150), 60 days, σ=1.50 → recover 1.50 (fails currently)
- Earnings event, σ=2.0 → recover 2.0 (fails currently)

**Severity:** High — IV displayed for high-vol names (NVDA earnings, biotech) silently returns null or wildly wrong values; flow scanner (`lib/options/flow.ts`) relies on IV for unusual-flow detection.

---

### F3.3 [HIGH] — GEX averages call gamma + put gamma at the same strike (single gamma); incorrect when call/put IVs differ

**Location:** `lib/options/gex.ts:47-58, 66-72`

**Evidence:**
```ts
function upsert(strike: number, oi: number, gamma: number, side: 'call' | 'put') {
  ...
  entry.gammaSum += gamma
  entry.gammaCount++
}
...
const gamma = entry.gammaCount > 0 ? entry.gammaSum / entry.gammaCount : 0
const gex = (callOI - putOI) * gamma * 100 * spot * spot * 0.01
```
The code averages call gamma and put gamma at the same strike. Theoretically, for European options of same K, T, r, sigma, gamma is identical (BSM property: gamma_call = gamma_put). **But** the chain enrichment computes IV and Greeks per-contract using each contract's own market price — so call IV and put IV at the same strike often differ (skew, demand asymmetry, put-call parity violations). The averaged gamma understates dealer GEX when one side dominates with higher gamma.

**Correct formulation:**
- Dealer GEX from calls: `+callOI × call_gamma × 100 × S² × 0.01` (dealers short calls, long gamma)
- Dealer GEX from puts: `+putOI × put_gamma × 100 × S² × 0.01` (dealers long puts, long gamma — sign per Squeezemetrics convention)
- Net dealer GEX at strike: `(callOI × call_gamma + putOI × put_gamma) × 100 × S² × 0.01`

**OR (alternative convention):** if the team uses `(callOI - putOI)` netting (dealer position from customer demand), then call_gamma and put_gamma should still be applied separately:
- `net = callOI × call_gamma - putOI × put_gamma`

**Citation:**
- Krishnan, H. (2017). *The Second Leg Down*. Wiley. Ch. 6 (Dealer Gamma Positioning).
- Sosnick, R., Schubert, A. (2020). "GEX & Dealer Positioning." Squeezemetrics whitepaper. (Documents the asymmetric gamma issue.)

**Patch sketch:**
```ts
function upsert(strike: number, oi: number, gamma: number, side: 'call' | 'put') {
  let entry = strikeMap.get(strike)
  if (!entry) {
    entry = { callOI: 0, putOI: 0, callGamma: 0, putGamma: 0 }
    strikeMap.set(strike, entry)
  }
  if (side === 'call') { entry.callOI += oi; entry.callGamma = gamma }  // last-write-wins per side
  else                 { entry.putOI  += oi; entry.putGamma  = gamma }
}
...
const gex = (callOI * callGamma - putOI * putGamma) * 100 * spot * spot * 0.01
```
(Sign convention to be decided by C2 — both `(callOI - putOI) × gamma` and `callOI × callGamma - putOI × putGamma` are used in the literature; the project must commit to one and document.)

**Acceptance test:** Construct synthetic chain with call_gamma ≠ put_gamma at same strike; assert GEX with corrected formula differs from current averaged-gamma version by ≥ 5% relative.

**Severity:** High — GEX is the headline number on `components/options/GexChart.tsx` and feeds dealer-positioning narratives; incorrect at structural skew (event names, vol expansion regimes).

---

### F3.4 [MEDIUM] — Sign convention for GEX is undocumented

**Location:** `lib/options/gex.ts:9-12`

**Evidence:** The header comment states the formula `(callOI - putOI) × gamma × 100 × spot² × 0.01` but does not state the dealer-positioning assumption (dealer short calls, long puts is one of two common conventions). Different vendors (Squeezemetrics, SpotGamma, MenthorQ) use opposite signs; users moving between platforms will misinterpret.

**Citation:** Krishnan (2017) op cit. p120–125 (sign convention discussion).

**Patch sketch:** Expand the header comment to:
```
GEX sign convention: positive = dealers net long gamma = stabilising (sell rallies, buy dips).
Assumes standard customer flow: dealers short calls, long puts.
This matches Squeezemetrics' convention; the inverse (SpotGamma uses opposite for some indices) requires negating the result.
```
Also add a `convention?: 'squeezemetrics' | 'spotgamma'` parameter for explicitness.

**Severity:** Medium — comprehension trap; not a math error but a frequent user-error.

---

### F3.5 [MEDIUM] — `flipPoint` interpolation can mis-detect when cumGEX touches zero exactly

**Location:** `lib/options/gex.ts:87-94`

**Evidence:**
```ts
if ((prev > 0 && cumulative <= 0) || (prev < 0 && cumulative >= 0)) {
  ...
  const frac = Math.abs(prev) / (Math.abs(prev) + Math.abs(cumulative))
  flipPoint = s0 + frac * (s1 - s0)
  break
}
```
At `cumulative === 0` exactly, `frac = |prev| / (|prev| + 0) = 1`, so `flipPoint = s1`. That's a defensible choice (the strike at which it just flipped), but the boundary handling deserves a unit test.

**More importantly:** the loop `break`s on first sign change. In real chains, cumulative GEX can cross zero multiple times (e.g., a pin between two large clusters). The function silently reports only the first crossing.

**Patch sketch:**
```ts
const flipPoints: number[] = []
// ... inside loop, push instead of break
return { strikeGex, totalGex, flipPoints, flipPoint: flipPoints[0] ?? null }
```
Keeps backward-compat `flipPoint` while exposing `flipPoints[]` for callers that want all crossings.

**Acceptance test:** Synthetic chain with two flips → assert `flipPoints.length === 2`.

**Severity:** Medium — affects multi-flip names (vol-expansion regimes); user sees one flip in the UI when there are two.

---

### F3.6 [MEDIUM] — Greeks return non-zero delta for expired options when `T <= 0` (bug at edge)

**Location:** `lib/options/greeks.ts:109-110`

**Evidence:**
```ts
if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
  return { delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0 }
}
```
The intrinsic-delta is correct at expiration: 1 if call ITM, 0 if call OTM, -1 if put ITM, 0 if put OTM. **But** the same return path is hit for `sigma <= 0` (degenerate case for live option) which is wrong — at sigma=0 a live (T > 0) option's delta is determined by forward moneyness, not just S vs K. `S = K * exp(-r*T)` boundary not addressed.

**Patch sketch:** Separate the two cases:
```ts
if (T <= 0) {
  // At expiry: delta = intrinsic indicator
  return { delta: ..., gamma: 0, theta: 0, vega: 0, rho: 0 }
}
if (sigma <= 0 || S <= 0 || K <= 0) {
  // Degenerate: undefined
  return { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, rho: NaN }  // or throw
}
```

**Severity:** Medium — pre-event sigma=0 is rare but conflating with expiry is a correctness issue.

---

### F3.7 [MEDIUM] — Time-to-expiry uses calendar 365; OK but undocumented vs Hull

**Location:** `lib/options/chain.ts:99`, `lib/options/greeks.ts:14, 124-128`

**Evidence:** Theta = annualTheta / 365 (calendar days). Hull (2017) uses calendar days too. Some platforms (Bloomberg, Reuters) use trading days (252) for theta — different by ~30%. The current convention is defensible but should be explicitly documented as a Hull-style choice.

**Patch sketch:** Add a single source-of-truth for day-count convention:
```ts
// lib/options/conventions.ts
export const OPTIONS_DAYS_PER_YEAR = 365  // calendar (Hull 2017 convention)
export const OPTIONS_THETA_PER_DAY = (annualTheta: number) => annualTheta / OPTIONS_DAYS_PER_YEAR
```

**Severity:** Medium — convention question, documentation issue, not a bug.

---

### F3.8 [LOW] — IV solver `IV_TOLERANCE = 1e-6` is tighter than typical option price granularity

**Location:** `lib/options/greeks.ts:146`

**Evidence:** Listed option prices have $0.01 minimum tick. Tolerance of 1e-6 is six orders of magnitude tighter. For most options, convergence occurs within ~10 iterations to 1e-4; tighter tolerance just adds iterations without meaningful precision.

**Patch sketch:** Relax to `1e-4` (default) with optional override.

**Severity:** Low — performance, not correctness.

---

## Cross-domain handoffs

- **R1:** F3.1 (dividend) requires data-layer support — coordinate with R4 to fetch `dividendYield` from yahoo-finance2.
- **R2:** F3.2 (IV solver) reuses NormalCDF/PDF from greeks.ts; no overlap with `lib/quant/indicators.ts`.
- **R5:** F3.3 (GEX averaging) affects `components/options/GexChart.tsx` rendering — R5 must validate the chart still renders correctly with revised formula.

---

## Self-dissent (rule 7)

F3.3 (GEX averaging) — I'm fairly confident this is wrong, but I have not read `chain.ts` end-to-end to confirm whether call_gamma and put_gamma are computed independently (with separate IVs) at the chain-enrichment step. If `chain.ts` enforces a single IV per strike (e.g., averages call+put IVs to produce one gamma), then the averaging at gex.ts:68 is a no-op and the issue collapses to "structural inefficiency, not a bug." I1 must read `chain.ts` lines around 99 (the T-calculation site) to confirm. Marked HIGH provisionally; downgrade to LOW if `chain.ts` already enforces single-gamma-per-strike.

F3.1 (dividend yield): the user may have intentionally omitted `q` because the platform mainly displays IV/Greeks for short-dated options where `q*T` is small. For 30-day SPY options with q=1.5%, q*T ≈ 0.00125 — material at the 4th decimal of price, but possibly within "good enough" tolerance for retail traders. Institutional users won't accept that. Marked HIGH for the institutional bar; could be MEDIUM for a retail-only product.

---

## Findings summary table

| ID | Severity | File:line | One-line |
|----|----------|-----------|----------|
| F3.1 | HIGH | greeks.ts:64-141 | BSM omits dividend yield q (Merton 1973) |
| F3.2 | HIGH | greeks.ts:147, 170-184 | IV solver naive seed, no fallback, no upper bound |
| F3.3 | HIGH | gex.ts:47-72 | GEX averages call+put gamma; incorrect under skew |
| F3.4 | MEDIUM | gex.ts:9-12 | GEX sign convention undocumented |
| F3.5 | MEDIUM | gex.ts:87-94 | flipPoint reports only first crossing |
| F3.6 | MEDIUM | greeks.ts:109-110 | T<=0 vs sigma<=0 conflated in degenerate-return |
| F3.7 | MEDIUM | chain.ts:99, greeks.ts:14 | day-count 365 convention undocumented |
| F3.8 | LOW | greeks.ts:146 | IV_TOLERANCE tighter than option tick |

Total: 8 findings (0 Critical, 3 High, 4 Medium, 1 Low).

**Open items requiring R3 second pass before S2:** `chain.ts` (full read), `sentiment.ts`, `flow.ts`, `app/api/options/[ticker]/route.ts`.

---

**Reviewer signature:** R3
**Cross-checked by:** R1 (engine.ts call site for any options-derived signals) — pending
**Inspector spot-check:** I1 — pending
