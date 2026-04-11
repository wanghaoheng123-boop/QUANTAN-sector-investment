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

function d1d2(S: number, K: number, T: number, r: number, sigma: number): [number, number] {
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  return [d1, d2]
}

// ─── Black-Scholes Price ──────────────────────────────────────────────────────

/**
 * Returns the Black-Scholes theoretical price of a European option.
 * Returns 0 if T ≤ 0 or sigma ≤ 0.
 */
export function blackScholesPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const [d1, d2] = d1d2(S, K, T, r, sigma)
  const discount = Math.exp(-r * T)
  if (type === 'call') {
    return S * normalCdf(d1) - K * discount * normalCdf(d2)
  } else {
    return K * discount * normalCdf(-d2) - S * normalCdf(-d1)
  }
}

// ─── Greeks ──────────────────────────────────────────────────────────────────

/**
 * Computes all five standard Black-Scholes Greeks.
 * Returns zeros when T ≤ 0 or sigma ≤ 0.
 */
export function greeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0 }
  }

  const sqrtT = Math.sqrt(T)
  const [d1, d2] = d1d2(S, K, T, r, sigma)
  const pdf1 = normalPdf(d1)
  const discount = Math.exp(-r * T)

  // Delta
  const delta = type === 'call' ? normalCdf(d1) : normalCdf(d1) - 1

  // Gamma (same for calls and puts)
  const gamma = pdf1 / (S * sigma * sqrtT)

  // Theta (annual, then divide by 365 for daily)
  const thetaAnnual = type === 'call'
    ? -(S * pdf1 * sigma) / (2 * sqrtT) - r * K * discount * normalCdf(d2)
    : -(S * pdf1 * sigma) / (2 * sqrtT) + r * K * discount * normalCdf(-d2)
  const theta = thetaAnnual / 365

  // Vega: dollar change per 1 percentage point move in vol (i.e. divide by 100)
  const vegaAnnual = S * pdf1 * sqrtT
  const vega = vegaAnnual / 100

  // Rho: dollar change per 1 percentage point move in r
  const rhoAnnual = type === 'call'
    ? K * T * discount * normalCdf(d2)
    : -K * T * discount * normalCdf(-d2)
  const rho = rhoAnnual / 100

  return { delta, gamma, theta, vega, rho }
}

// ─── Implied Volatility ───────────────────────────────────────────────────────

const IV_MAX_ITER = 100
const IV_TOLERANCE = 1e-6
const IV_INIT_SIGMA = 0.3

/**
 * Newton-Raphson implied volatility solver.
 * Returns null if the market price is below intrinsic value, T ≤ 0,
 * or convergence fails after MAX_ITER iterations.
 */
export function impliedVolatility(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: OptionType,
): number | null {
  if (T <= 0 || marketPrice <= 0 || S <= 0 || K <= 0) return null

  // Check intrinsic value floor
  const intrinsic = type === 'call'
    ? Math.max(0, S - K * Math.exp(-r * T))
    : Math.max(0, K * Math.exp(-r * T) - S)
  if (marketPrice < intrinsic - 1e-8) return null

  let sigma = IV_INIT_SIGMA

  for (let i = 0; i < IV_MAX_ITER; i++) {
    const price = blackScholesPrice(S, K, T, r, sigma, type)
    const diff = price - marketPrice
    if (Math.abs(diff) < IV_TOLERANCE) return sigma

    // Vega in full annual terms (not scaled)
    const sqrtT = Math.sqrt(T)
    const [d1] = d1d2(S, K, T, r, sigma)
    const vegaFull = S * normalPdf(d1) * sqrtT
    if (vegaFull < 1e-12) return null  // flat vega — can't converge

    sigma -= diff / vegaFull
    if (sigma <= 0) sigma = 1e-6  // clamp to positive
  }

  return null  // did not converge
}
