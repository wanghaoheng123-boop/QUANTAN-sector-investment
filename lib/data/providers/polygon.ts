/**
 * Polygon.io data provider (free tier: 5 API calls/min, end-of-day data).
 *
 * Requires environment variable: POLYGON_API_KEY
 * Free tier docs: https://polygon.io/docs/stocks/get_v2_aggs_ticker__stocksticker__range__multiplier___timespan___from___to
 */

import type { DataProvider, DailyBar, QuoteSnapshot } from './types'

const POLYGON_BASE = 'https://api.polygon.io'
const RATE_LIMIT_MS = 13_000  // ~5 req/min with 1 req per 13s

let lastCallMs = 0

async function rateLimitedFetch(url: string, apiKey: string): Promise<Response> {
  const now = Date.now()
  const wait = RATE_LIMIT_MS - (now - lastCallMs)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallMs = Date.now()
  return fetch(`${url}${url.includes('?') ? '&' : '?'}apiKey=${apiKey}`)
}

export class PolygonProvider implements DataProvider {
  readonly name = 'polygon.io'
  private readonly apiKey: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.POLYGON_API_KEY ?? ''
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0
  }

  async fetchDaily(ticker: string, startDate: Date | string): Promise<DailyBar[] | null> {
    if (!this.isAvailable()) return null
    try {
      const from = startDate instanceof Date
        ? startDate.toISOString().slice(0, 10)
        : startDate
      const to = new Date().toISOString().slice(0, 10)
      const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000`
      const res = await rateLimitedFetch(url, this.apiKey)
      if (!res.ok) return null
      const data = await res.json() as { results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> }
      if (!data.results?.length) return null
      return data.results.map((r) => ({
        date: new Date(r.t).toISOString().slice(0, 10),
        open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
      }))
    } catch {
      return null
    }
  }

  async fetchQuote(ticker: string): Promise<QuoteSnapshot | null> {
    if (!this.isAvailable()) return null
    try {
      const url = `${POLYGON_BASE}/v2/last/trade/${ticker}`
      const res = await rateLimitedFetch(url, this.apiKey)
      if (!res.ok) return null
      const data = await res.json() as { results?: { p: number; t: number } }
      if (!data.results) return null
      return {
        ticker,
        price: data.results.p,
        change: 0,
        changePct: 0,
        updatedAt: new Date(data.results.t / 1_000_000).toISOString(),
      }
    } catch {
      return null
    }
  }
}

export const polygonProvider = new PolygonProvider()
