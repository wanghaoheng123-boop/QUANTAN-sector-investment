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

/** Continuously compounded risk-free rate for all greeks calculations. */
const RISK_FREE_RATE = 0.0525

function toDate(d: unknown): Date {
  if (d instanceof Date) return d
  return new Date(d as string | number)
}

function normaliseContract(raw: Record<string, unknown>): CallOrPut {
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
    impliedVolatility: Number(raw.impliedVolatility ?? 0),
    inTheMoney: Boolean(raw.inTheMoney),
  }
}

function enrichContract(
  contract: CallOrPut,
  spot: number,
  today: number,
  type: 'call' | 'put',
): EnrichedContract {
  const T = Math.max(0, (contract.expiration.getTime() - today) / (365 * 24 * 60 * 60 * 1000))
  const sigma = contract.impliedVolatility

  const g: Greeks = sigma > 0 && T > 0
    ? greeks(spot, contract.strike, T, RISK_FREE_RATE, sigma, type)
    : { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }

  return { ...contract, ...g }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches an enriched options chain for `symbol`.
 * Optionally pass `date` to target a specific expiration.
 */
export async function fetchOptionsChain(
  symbol: string,
  date?: Date,
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

  const expirationDatesRaw = (raw.expirationDates as unknown[]) ?? []
  const expirationDates = expirationDatesRaw.map(toDate)

  const optionsArr = (raw.options as Record<string, unknown>[]) ?? []
  const firstExpiration = optionsArr[0] ?? null

  const rawCalls = (firstExpiration?.calls as Record<string, unknown>[]) ?? []
  const rawPuts  = (firstExpiration?.puts  as Record<string, unknown>[]) ?? []

  const calls = rawCalls.map((c) => enrichContract(normaliseContract(c), spot, today, 'call'))
  const puts  = rawPuts.map((p)  => enrichContract(normaliseContract(p),  spot, today, 'put'))

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
