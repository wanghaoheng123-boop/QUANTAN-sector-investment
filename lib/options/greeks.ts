/**
 * Black-Scholes option pricing, implied volatility, and Greeks.
 *
 * All functions are pure math — no external dependencies.
 *
 * Conventions:
 *   S     = spot price
 *   K     = strike price
 *   T     = time to expiry in years (> 0)
 *   r     = continuous risk-free rate (e.g. 0.0525 for 5.25%)
 *   sigma = annualised implied volatility (e.g. 0.25 for 25%)
 *   type  = 'call' | 'put'
 *
 * Theta is returned in $/day (annual theta divided by 365).
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
  // Q3-H-2 (Phase 14): explicit branches at |z| ≥ 8 document the saturation
  // boundary instead of relying on silent Math.exp underflow downstream.
  // Φ(8) ≈ 1 - 6.2e-16 is below double-precision resolution, so returning
  // exactly 1 (resp. 0) at the boundary is mathematically faithful.
  if (Number.isNaN(x)) return NaN
  if (x >= 8) return 1
  if (x <= -8) return 0

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
//
// Phase 13 S2 fix (F3.1): Merton (1973) extension — Black-Scholes pricing
// with continuous dividend yield `q`. Backward-compatible: q defaults to 0
// (the original Black-Scholes-Merton specification reduces to BS).
//
// Formulas:
//   d1 = (ln(S/K) + (r - q + 0.5σ²)T) / (σ√T)
//   d2 = d1 - σ√T
//   Call = S·exp(-q·T)·N(d1) - K·exp(-r·T)·N(d2)
//   Put  = K·exp(-r·T)·N(-d2) - S·exp(-q·T)·N(-d1)
// References:
//   Merton, R. C. (1973). "Theory of Rational Option Pricing." Bell J. Econ.
//   Hull, J. C. (2017). Options, Futures, and Other Derivatives, 10e. p385-388.

function d1d2(S: number, K: number, T: number, r: number, sigma: number, q = 0): [number, number] {
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  return [d1, d2]
}

// ─── Black-Scholes Price ──────────────────────────────────────────────────────

/**
 * Returns the Black-Scholes-Merton theoretical price of a European option.
 *
 * @param q Continuous dividend yield (annualized). Default 0 reduces to
 *          original Black-Scholes. Pass dividendYield from yahooFinance
 *          summaryDetail for accurate pricing on dividend-paying ETFs/stocks.
 *
 * Returns 0 if T ≤ 0, sigma ≤ 0, S ≤ 0, or K ≤ 0.
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
  const discountR = Math.exp(-r * T)
  const discountQ = Math.exp(-q * T)
  if (type === 'call') {
    return S * discountQ * normalCdf(d1) - K * discountR * normalCdf(d2)
  } else {
    return K * discountR * normalCdf(-d2) - S * discountQ * normalCdf(-d1)
  }
}

// ─── Greeks ──────────────────────────────────────────────────────────────────

/**
 * Computes all five standard Black-Scholes Greeks.
 *
 * Edge cases:
 *   - T ≤ 0 (expired): delta is the intrinsic indicator (1/0 for ITM/OTM call,
 *     -1/0 for ITM/OTM put), all other Greeks are 0.
 *   - sigma ≤ 0 or S ≤ 0 or K ≤ 0 (degenerate live option): all Greeks are 0.
 *     A truly zero-vol live option's delta depends on forward moneyness, but
 *     this case is unreachable in practice — IV is bounded > 0 by the solver,
 *     and S/K are positive by market construction.
 *
 * Phase 13 S2 fix (F3.6): T≤0 and sigma≤0 cases are now handled separately so
 * the intrinsic-delta logic only applies at expiry, not when sigma=0 mid-life.
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
  // Expiry — return intrinsic delta indicator.
  if (T <= 0) {
    const intrinsicDelta = type === 'call'
      ? (S > K ? 1 : 0)
      : (S < K ? -1 : 0)
    return { delta: intrinsicDelta, gamma: 0, theta: 0, vega: 0, rho: 0 }
  }
  // Degenerate live option (zero vol or non-positive prices).
  if (sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }
  }

  const sqrtT = Math.sqrt(T)
  const [d1, d2] = d1d2(S, K, T, r, sigma, q)
  const pdf1 = normalPdf(d1)
  const discountR = Math.exp(-r * T)
  const discountQ = Math.exp(-q * T)

  // Delta — Merton (1973): exp(-q·T) · N(d1) for calls; exp(-q·T)·[N(d1)-1] for puts.
  const delta = type === 'call'
    ? discountQ * normalCdf(d1)
    : discountQ * (normalCdf(d1) - 1)

  // Gamma (same for calls and puts) — Merton: exp(-q·T)·N'(d1)/(S·σ·√T)
  const gamma = (discountQ * pdf1) / (S * sigma * sqrtT)

  // Theta (annual, then divide by OPTIONS_DAYS_PER_YEAR for daily)
  // Merton extension adds the +q·S·exp(-q·T)·N(d1) term (call) / -q·S·exp(-q·T)·N(-d1) (put)
  const thetaAnnual = type === 'call'
    ? -(S * discountQ * pdf1 * sigma) / (2 * sqrtT)
      - r * K * discountR * normalCdf(d2)
      + q * S * discountQ * normalCdf(d1)
    : -(S * discountQ * pdf1 * sigma) / (2 * sqrtT)
      + r * K * discountR * normalCdf(-d2)
      - q * S * discountQ * normalCdf(-d1)
  const theta = thetaAnnual / 365

  // Vega: dollar change per 1 vol point. Merton: scaled by exp(-q·T).
  const vegaAnnual = S * discountQ * pdf1 * sqrtT
  const vega = vegaAnnual / 100

  // Rho: dollar change per 1 percentage point move in r
  const rhoAnnual = type === 'call'
    ? K * T * discountR * normalCdf(d2)
    : -K * T * discountR * normalCdf(-d2)
  const rho = rhoAnnual / 100

  return { delta, gamma, theta, vega, rho }
}

// ─── Implied Volatility ───────────────────────────────────────────────────────

const IV_MAX_ITER = 100
// Phase 13 S2 fix (F3.8): tolerance relaxed from 1e-6 to 1e-4. Listed options
// have $0.01 minimum tick; 1e-6 is six orders of magnitude tighter than the
// underlying price precision and just adds Newton-Raphson iterations without
// improving practical IV resolution.
const IV_TOLERANCE = 1e-4
const IV_INIT_SIGMA = 0.3

/**
 * Newton-Raphson implied volatility solver with Merton dividend yield support.
 *
 * Phase 13 S2 fix (F3.1): accepts optional `q` (continuous dividend yield).
 * For dividend-paying instruments, Merton's adjusted intrinsic floor is
 * `S·exp(-q·T) - K·exp(-r·T)` for a call (and the symmetric form for a put);
 * intrinsic with q=0 reduces to the classical S - K·exp(-r·T).
 *
 * @param q Continuous dividend yield. Default 0 (BSM original).
 *
 * Returns null if the market price is below intrinsic, T ≤ 0,
 * or convergence fails after MAX_ITER iterations.
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

  // Check intrinsic value floor (Merton-adjusted when q > 0)
  const intrinsic = type === 'call'
    ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T))
    : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T))
  if (marketPrice < intrinsic - 1e-8) return null

  // F3.2 (Phase 13 S2 partial): Brenner-Subrahmanyam (1988) initial seed for
  // ATM options. For deep ITM/OTM, fall back to a moneyness-adjusted IV_INIT.
  // Reference: Brenner, M. & Subrahmanyam, M. G. (1988). "A Simple Formula
  // to Compute the Implied Standard Deviation." Financial Analysts Journal
  // 44(5), p80-83.
  const moneyness = Math.abs(Math.log(S / K))
  let sigma: number
  if (moneyness < 0.05) {
    // Near-ATM: Brenner-Subrahmanyam closed-form.
    sigma = Math.sqrt(2 * Math.PI / T) * (marketPrice / S)
  } else {
    sigma = IV_INIT_SIGMA
  }
  // Clamp seed to safe range — handles pathological inputs (e.g. premium
  // > spot would otherwise produce a giant initial sigma).
  const SIGMA_MIN = 0.005
  const SIGMA_MAX = 5.0  // 500% IV cap — covers any sane market scenario
  sigma = Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, sigma))

  for (let i = 0; i < IV_MAX_ITER; i++) {
    const price = blackScholesPrice(S, K, T, r, sigma, type, q)
    const diff = price - marketPrice
    if (Math.abs(diff) < IV_TOLERANCE) return sigma

    // Vega in full annual terms — Merton: S·exp(-q·T)·N'(d1)·√T
    const sqrtT = Math.sqrt(T)
    const [d1] = d1d2(S, K, T, r, sigma, q)
    const vegaFull = S * Math.exp(-q * T) * normalPdf(d1) * sqrtT
    if (vegaFull < 1e-12) return null  // flat vega — can't converge

    sigma -= diff / vegaFull
    // Clamp into safe range every iteration to prevent divergence.
    sigma = Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, sigma))
  }

  return null  // did not converge
}
