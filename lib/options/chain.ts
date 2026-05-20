/**
 * Options chain fetcher — wraps yahoo-finance2 options() and enriches each
 * contract with Black-Scholes Greeks computed from the Yahoo IV.
 */

import YahooFinance from 'yahoo-finance2'
import { greeks } from './greeks'
import type { Greeks } from './greeks'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Normalised options contract from Yahoo Finance. */
export interface CallOrPut {
  contractSymbol: string
  strike: number
  currency?: string
  lastPrice: number
  change: number
  percentChange?: number
  volume?: number
  openInterest?: number
  bid?: number
  ask?: number
  contractSize: string
  expiration: Date
  lastTradeDate: Date
  impliedVolatility: number
  inTheMoney: boolean
}

export interface EnrichedContract extends CallOrPut {
  delta: number
  gamma: number
  /** $/day */
  theta: number
  /** per 1 vol-point */
  vega: number
  rho: number
}

export interface EnrichedChain {
  ticker: string
  underlyingPrice: number
  expirationDates: Date[]
  currentExpiry: Date | null
  calls: EnrichedContract[]
  puts: EnrichedContract[]
}

// ─── Internals ────────────────────────────────────────────────────────────────

const yahooFinance = new YahooFinance()

// Phase 13 S2 (F1.4 partial): centralized in lib/quant/constants.ts.
// Eventual FRED-backed getRiskFreeRate(tenorDays) will be a 1-line change.
import { OPTIONS_RFR_ANNUAL as RISK_FREE_RATE } from '@/lib/quant/constants'

function toDate(d: unknown): Date {
  if (d instanceof Date) return d
  return new Date(d as string | number)
}

function normaliseContract(raw: Record<string, unknown>): CallOrPut {
  // Q3-H-3 (Phase 14): Yahoo returns IV as decimal (0.25 = 25%). If we see
  // > 5.0, it's almost certainly a percentage-vs-decimal upstream bug — a
  // raw value like 25 would propagate to Black-Scholes and blow up every
  // Greek for the contract. Clamp to 0 (Greeks reported as zeros) and log
  // for forensics so we can spot upstream schema drift early.
  let ivRaw = Number(raw.impliedVolatility ?? 0)
  if (Number.isFinite(ivRaw) && ivRaw > 5.0) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      event: 'options.iv_out_of_range',
      symbol: String(raw.contractSymbol ?? ''),
      raw: ivRaw,
    }))
    ivRaw = 0
  }
  if (!Number.isFinite(ivRaw)) ivRaw = 0

  return {
    contractSymbol: String(raw.contractSymbol ?? ''),
    strike: Number(raw.strike ?? 0),
    currency: raw.currency != null ? String(raw.currency) : undefined,
    lastPrice: Number(raw.lastPrice ?? 0),
    change: Number(raw.change ?? 0),
    percentChange: raw.percentChange != null ? Number(raw.percentChange) : undefined,
    volume: raw.volume != null ? Number(raw.volume) : undefined,
    openInterest: raw.openInterest != null ? Number(raw.openInterest) : undefined,
    bid: raw.bid != null ? Number(raw.bid) : undefined,
    ask: raw.ask != null ? Number(raw.ask) : undefined,
    contractSize: String(raw.contractSize ?? 'REGULAR'),
    expiration: toDate(raw.expiration),
    lastTradeDate: toDate(raw.lastTradeDate ?? raw.expiration),
    impliedVolatility: ivRaw,
    inTheMoney: Boolean(raw.inTheMoney),
  }
}

/**
 * Day-count convention (F3.7 — Phase 13 S2 documentation):
 * ────────────────────────────────────────────────────────
 *   Time-to-expiry is computed in CALENDAR DAYS / 365 (ACT/365). Theta is
 *   subsequently divided by 365 in `greeks()` to produce per-calendar-day
 *   theta. This matches Hull (2017) op cit. p385 and Bloomberg defaults.
 *
 *   Alternative conventions in use elsewhere:
 *     • Trading-day basis (252)   — used by some venues for theta annualisation
 *     • Business-day basis (≈252) — used by some IRS / OIS desks
 *
 *   Switching conventions changes theta by ~30% (252 vs 365 → 0.69× factor)
 *   so any platform reading our theta values must use ACT/365.
 *
 * Dividend yield (Merton 1973 — Phase 13 S2 gap close):
 * ──────────────────────────────────────────────────────
 *   The `greeks()` function was extended earlier in this phase to accept
 *   `q` (continuous dividend yield). Without `q`, BS-1973 prices puts
 *   too low and calls too high for any dividend-paying underlying. This
 *   function now forwards a caller-supplied `q` (default 0 for
 *   back-compat). The `fetchOptionsChain` API takes a `dividendYield`
 *   parameter that flows through here.
 */
function enrichContract(
  contract: CallOrPut,
  spot: number,
  today: number,
  type: 'call' | 'put',
  q = 0,
): EnrichedContract {
  const T = Math.max(0, (contract.expiration.getTime() - today) / (365 * 24 * 60 * 60 * 1000))
  const sigma = contract.impliedVolatility

  // Phase 14 wave 39 — OPTIONS CHAIN GREEKS FIX.
  //
  // Bug: the prior gate `sigma > 0 && T > 0` returned `{delta:0,...all zeros}`
  // whenever EITHER condition failed. This made the intrinsic-delta logic
  // inside greeks() (greeks.ts:145-150 — returns delta=1 for ITM call at
  // expiry, -1 for ITM put, 0 for OTM) DEAD CODE, never reached.
  //
  // Real-world impact: every contract in the closest expiry of a stock's
  // chain reports delta=0 for the entire trading day of expiration because
  // Yahoo sets `expiration` to midnight UTC of the expiry day, so by any
  // mid-day request `(expiration - today)` is already negative → T=0 → gate
  // returns all zeros. Deep-ITM calls expiring today reported delta=0
  // instead of 1. The MaxPainGauge / GexChart / FlowScanner all rendered
  // degenerate values because their inputs were these zero-Greek contracts.
  //
  // Fix: call greeks() unconditionally. The function correctly handles
  // every edge case internally:
  //   - T <= 0 (expired):    intrinsic delta (1/0/-1) + other Greeks 0
  //   - sigma <= 0:           all Greeks 0
  //   - S <= 0 or K <= 0:     all Greeks 0
  //   - normal path:          full Black-Scholes-Merton
  //
  // Reference: Hull (2017) op cit. p373 — at expiry, delta is the
  //   intrinsic indicator (sign of moneyness), not zero.
  const g: Greeks = greeks(spot, contract.strike, T, RISK_FREE_RATE, sigma, type, q)

  return { ...contract, ...g }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches an enriched options chain for `symbol`.
 *
 * @param symbol  Yahoo-normalized ticker (e.g. 'AAPL', '^SPX').
 * @param date    Optional target expiration. If omitted, returns the
 *                first available expiration.
 * @param dividendYield  Optional continuous dividend yield (e.g. 0.014 for
 *                       SPY's 1.4%). Forwarded to greeks() for Merton-
 *                       extended pricing. Defaults to 0 for back-compat —
 *                       callers should supply this whenever the underlying
 *                       is known to yield. The yahoo-finance2 quote
 *                       response includes `trailingAnnualDividendYield`
 *                       which can be passed by the API route.
 *
 * The route reads Yahoo's quote first to extract dividendYield, then
 * passes it here. This keeps fetchOptionsChain a pure function over
 * its inputs.
 */
export async function fetchOptionsChain(
  symbol: string,
  date?: Date,
  dividendYield = 0,
): Promise<EnrichedChain> {
  // Use validateResult: false to tolerate Yahoo schema drift
  const raw = await (yahooFinance as unknown as {
    options(
      symbol: string,
      queryOptions?: { date?: Date },
      moduleOptions?: { validateResult: boolean },
    ): Promise<Record<string, unknown>>
  }).options(symbol, date ? { date } : {}, { validateResult: false })

  const quote = raw.quote as Record<string, unknown> | undefined
  const spot = Number(quote?.regularMarketPrice ?? 0)
  const today = Date.now()

  // Defensive clamp: dividend yield outside [0, 0.20] is almost certainly
  // a misreading (REIT yields top out around 12%; energy MLPs ~10%).
  // Clamp to prevent absurd pricing from a corrupted upstream value.
  const q = Number.isFinite(dividendYield) && dividendYield >= 0 && dividendYield <= 0.20
    ? dividendYield : 0

  const expirationDatesRaw = (raw.expirationDates as unknown[]) ?? []
  const expirationDates = expirationDatesRaw.map(toDate)

  const optionsArr = (raw.options as Record<string, unknown>[]) ?? []
  const firstExpiration = optionsArr[0] ?? null

  const rawCalls = (firstExpiration?.calls as Record<string, unknown>[]) ?? []
  const rawPuts  = (firstExpiration?.puts  as Record<string, unknown>[]) ?? []

  const calls = rawCalls.map((c) => enrichContract(normaliseContract(c), spot, today, 'call', q))
  const puts  = rawPuts.map((p)  => enrichContract(normaliseContract(p),  spot, today, 'put',  q))

  const currentExpiry = firstExpiration?.expirationDate != null
    ? toDate(firstExpiration.expirationDate)
    : null

  return {
    ticker: String(raw.underlyingSymbol ?? symbol),
    underlyingPrice: spot,
    expirationDates,
    currentExpiry,
    calls,
    puts,
  }
}
