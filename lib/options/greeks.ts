/**
 * Black-Scholes-Merton option pricing, implied volatility, and Greeks.
 *
 * All functions are pure math — no external dependencies.
 *
 * Conventions:
 *   S     = spot price
 *   K     = strike price
 *   T     = time to expiry in years (> 0)
 *   r     = continuous risk-free rate (e.g. 0.0525 for 5.25%)
 *   q     = continuous dividend yield (e.g. 0.015 for 1.5% — defaults to 0)
 *   sigma = annualised implied volatility (e.g. 0.25 for 25%)
 *   type  = 'call' | 'put'
 *
 * Theta is returned in $/day (annual theta divided by 365).
 *
 * Dividend extension (Merton 1973):
 *   Without q the model treats the underlying as paying NO dividends. This
 *   over-prices puts and under-prices calls for any dividend-paying name
 *   (most non-tech stocks, all index ETFs). The optional q parameter
 *   defaults to 0 for back-compat; supply it whenever the underlying is
 *   known to yield (e.g. SPY ≈ 1.4%, JNJ ≈ 3%, utility ETFs ≈ 4%).
 *
 * Citation: Merton, R. C. (1973). "Theory of Rational Option Pricing,"
 *           Bell Journal of Economics and Management Science, 4(1), 141-183 —
 *           extended Black-Scholes (1973) to continuously-paying dividends.
 */

export type OptionType = 'call' | 'put'

export interface Greeks {
  delta: number
  gamma: number
  /** $/day */
  theta: number
  /** per 1-vol-point move (i.e. vega / 100) */
  vega: number
  rho: number
}

// ─── Normal Distribution ─────────────────────────────────────────────────────

/**
 * Standard normal CDF via Abramowitz & Stegun 26.2.17 polynomial approximation.
 * Maximum absolute error < 7.5e-8.
 */
export function normalCdf(x: number): number {
  // For extreme values clamp to avoid underflow
  if (x < -8) return 0
  if (x > 8) return 1

  // A&S 26.2.17 coefficients
  const p  =  0.2316419
  const a1 =  0.319381530
  const a2 = -0.356563782
  const a3 =  1.781477937
  const a4 = -1.821255978
  const a5 =  1.330274429
  const INV_SQRT2PI = 0.3989422804014327  // 1 / sqrt(2*PI)

  const absX = Math.abs(x)
  const t = 1 / (1 + p * absX)
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))))
  const tail = INV_SQRT2PI * Math.exp(-0.5 * absX * absX) * poly

  return x >= 0 ? 1 - tail : tail
}

/** Standard normal PDF. */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

// ─── d1 / d2 helpers ─────────────────────────────────────────────────────────

/**
 * Merton-extended d1/d2: replaces drift `r` with `(r - q)`.
 * When q = 0 this reduces to the Black-Scholes (1973) form exactly.
 */
function d1d2(S: number, K: number, T: number, r: number, sigma: number, q = 0): [number, number] {
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  return [d1, d2]
}

// ─── Black-Scholes Price ──────────────────────────────────────────────────────

/**
 * Returns the Black-Scholes-Merton theoretical price of a European option.
 * Returns 0 if T ≤ 0 or sigma ≤ 0.
 *
 * `q` defaults to 0 (Black-Scholes-1973 form). Supply q for divvy-paying
 * underlyings: call price drops by S(1 - e^(-qT)); put price rises by
 * the same amount (put-call parity).
 */
export function blackScholesPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
  q = 0,
): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const [d1, d2] = d1d2(S, K, T, r, sigma, q)
  const discount = Math.exp(-r * T)
  const divDiscount = Math.exp(-q * T)
  if (type === 'call') {
    return S * divDiscount * normalCdf(d1) - K * discount * normalCdf(d2)
  } else {
    return K * discount * normalCdf(-d2) - S * divDiscount * normalCdf(-d1)
  }
}

// ─── Greeks ──────────────────────────────────────────────────────────────────

/**
 * Computes all five standard Black-Scholes-Merton Greeks.
 * Returns zeros when T ≤ 0 or sigma ≤ 0.
 *
 * `q` (continuous dividend yield) defaults to 0 for back-compat. Greeks
 * shift meaningfully under non-zero q:
 *   • Call delta: e^(-qT) × N(d1)  (≤ N(d1), so lower than no-dividend)
 *   • Put delta:  e^(-qT) × (N(d1) - 1)
 *   • Theta gains a + q · S · e^(-qT) · N(d1) term (call) — dividends
 *     accrue to the call seller, not the holder, so calls decay faster.
 */
export function greeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
  q = 0,
): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0 }
  }

  const sqrtT = Math.sqrt(T)
  const [d1, d2] = d1d2(S, K, T, r, sigma, q)
  const pdf1 = normalPdf(d1)
  const discount = Math.exp(-r * T)
  const divDiscount = Math.exp(-q * T)

  // Delta — Merton form: divDiscount × {N(d1) for call, N(d1)−1 for put}
  const delta = type === 'call'
    ? divDiscount * normalCdf(d1)
    : divDiscount * (normalCdf(d1) - 1)

  // Gamma — Merton form: divDiscount × N'(d1) / (S σ √T)
  const gamma = (divDiscount * pdf1) / (S * sigma * sqrtT)

  // Theta (annual, then divide by 365 for daily). Merton form adds a
  // q-dependent term that captures dividend accrual.
  const commonTheta = -(S * divDiscount * pdf1 * sigma) / (2 * sqrtT)
  const thetaAnnual = type === 'call'
    ? commonTheta - r * K * discount * normalCdf(d2)  + q * S * divDiscount * normalCdf(d1)
    : commonTheta + r * K * discount * normalCdf(-d2) - q * S * divDiscount * normalCdf(-d1)
  const theta = thetaAnnual / 365

  // Vega: dollar change per 1 percentage point move in vol (i.e. divide by 100)
  const vegaAnnual = S * divDiscount * pdf1 * sqrtT
  const vega = vegaAnnual / 100

  // Rho: dollar change per 1 percentage point move in r (Merton: r-discount only)
  const rhoAnnual = type === 'call'
    ? K * T * discount * normalCdf(d2)
    : -K * T * discount * normalCdf(-d2)
  const rho = rhoAnnual / 100

  return { delta, gamma, theta, vega, rho }
}

// ─── Implied Volatility ───────────────────────────────────────────────────────

const IV_MAX_ITER = 100
const IV_TOLERANCE = 1e-6
const IV_SIGMA_MIN = 0.005    // 0.5% — below this Black-Scholes is numerically unstable
const IV_SIGMA_MAX = 5.0      // 500% — well above any rational market regime

/**
 * Brenner-Subrahmanyam (1988) closed-form approximation for the seed:
 *   σ ≈ √(2π/T) × (C/S)
 * Highly accurate near the money (where most contracts trade). For deep
 * OTM contracts the BS formula underestimates IV (the C/S ratio shrinks
 * faster than σ does), which can land Newton in a near-flat-vega
 * region. We floor the seed at 0.10 — deep-OTM Newton can climb from
 * 10% upward, where it can't easily climb from 1%.
 *
 * Citation: Brenner, M. & Subrahmanyam, M. G. (1988). "A Simple Formula
 *           to Compute the Implied Standard Deviation," *Financial
 *           Analysts Journal*, 44(5), 80-83.
 */
function brennerSubrahmanyamSeed(price: number, S: number, T: number): number {
  const raw = Math.sqrt(2 * Math.PI / T) * (price / S)
  // 0.10 floor avoids the deep-OTM "vega cliff" where Newton stalls.
  // 5.0 ceiling matches IV_SIGMA_MAX.
  const seed = Math.max(0.10, raw)
  return Math.max(IV_SIGMA_MIN, Math.min(IV_SIGMA_MAX, seed))
}

/**
 * Implied volatility solver with Merton dividend support.
 *
 * Hybrid strategy: Newton-Raphson with bisection fallback. This handles
 * the deep-OTM failure mode where the price function is nearly flat
 * (vega → 0) at the BS-seeded sigma, which made pure Newton oscillate
 * between the clamped bounds without ever converging.
 *
 * Algorithm:
 *   1. Bracket the solution between IV_SIGMA_MIN and IV_SIGMA_MAX by
 *      checking BS prices at the bounds. If the target market price is
 *      outside [price(min), price(max)] the contract has no IV
 *      consistent with the model — return null.
 *   2. Seed sigma via Brenner-Subrahmanyam (1988), floored at 0.10 to
 *      avoid the deep-OTM vega cliff.
 *   3. Each iteration:
 *      • Compute BS price + vega at current sigma.
 *      • Take a Newton step. If the step would land OUTSIDE the
 *        current bracket, fall back to bisection (halve the bracket).
 *      • Update the bracket so the solution stays surrounded.
 *      • Stop when |diff| < IV_TOLERANCE.
 *   4. Returns null if no convergence in IV_MAX_ITER (always finite
 *      and non-zero in practice once we have a valid bracket).
 *
 * Returns null if the market price is below intrinsic value, T ≤ 0,
 * the bracket can't be established, or convergence fails.
 */
export function impliedVolatility(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: OptionType,
  q = 0,
): number | null {
  if (T <= 0 || marketPrice <= 0 || S <= 0 || K <= 0) return null

  // Intrinsic value floor — Merton form discounts S by div yield.
  const intrinsic = type === 'call'
    ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T))
    : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T))
  if (marketPrice < intrinsic - 1e-8) return null

  // Establish a bracket [lo, hi] such that BS(lo) ≤ marketPrice ≤ BS(hi).
  // BS price is monotonic increasing in sigma, so bracket is unique.
  let lo = IV_SIGMA_MIN
  let hi = IV_SIGMA_MAX
  const priceLo = blackScholesPrice(S, K, T, r, lo, type, q)
  const priceHi = blackScholesPrice(S, K, T, r, hi, type, q)
  if (marketPrice < priceLo - 1e-8 || marketPrice > priceHi + 1e-8) return null

  let sigma = brennerSubrahmanyamSeed(marketPrice, S, T)
  sigma = Math.max(lo, Math.min(hi, sigma))

  for (let i = 0; i < IV_MAX_ITER; i++) {
    const price = blackScholesPrice(S, K, T, r, sigma, type, q)
    const diff = price - marketPrice
    if (Math.abs(diff) < IV_TOLERANCE) return sigma

    // Tighten the bracket: BS price monotonic in sigma, so if price is
    // too low, lift `lo`; if too high, drop `hi`.
    if (diff < 0) lo = sigma
    else hi = sigma

    // Try a Newton step.
    const sqrtT = Math.sqrt(T)
    const [d1] = d1d2(S, K, T, r, sigma, q)
    const vegaFull = S * Math.exp(-q * T) * normalPdf(d1) * sqrtT

    let nextSigma: number
    if (vegaFull < 1e-12) {
      // Vega vanishing — Newton step is undefined. Bisect.
      nextSigma = (lo + hi) / 2
    } else {
      const step = diff / vegaFull
      const candidate = sigma - step
      // If Newton lands OUTSIDE the bracket, fall back to bisection.
      if (candidate <= lo || candidate >= hi) {
        nextSigma = (lo + hi) / 2
      } else {
        nextSigma = candidate
      }
    }

    sigma = nextSigma
  }

  return null  // did not converge
}
