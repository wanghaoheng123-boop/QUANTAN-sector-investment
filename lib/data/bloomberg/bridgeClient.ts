/**
 * Optional HTTP bridge to Bloomberg (blpapi) running beside a Terminal or B-PIPE gateway.
 * You host the bridge; this app never embeds Bloomberg credentials.
 *
 * Redistribution: comply with your Bloomberg Terminal Agreement / Data License.
 */

import { timingSafeEqual } from 'crypto'
import { fromBloombergSecurity } from './toBloombergSecurity'
import { formatCompactNumber } from '@/lib/format'
import { sanitizeError } from '@/lib/api/sanitize'

/**
 * Timing-safe comparison for `X-Bridge-Secret` (F7.5 / Q-037).
 * Use in bridge servers and any inbound auth that mirrors this header.
 */
export function bridgeSecretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected?.trim()) return true
  if (provided == null) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type BloombergQuoteNormalized = {
  ticker: string
  price: number
  change: number
  changePct: number
  volume: number
  high52w: number
  low52w: number
  pe: number
  marketCap: string
  bid?: number
  ask?: number
  dataSource: 'bloomberg'
}

function num(x: unknown): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && x.trim() !== '') {
    const parsed = parseFloat(x)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function pickSymbol(row: Record<string, unknown>): string {
  const sym =
    (row.symbol as string) ||
    (row.ticker as string) ||
    (row.TICKER as string) ||
    (row.security as string) ||
    ''
  if (sym.includes('Equity') || sym.includes('Index')) return fromBloombergSecurity(sym)
  return sym.replace(/\s+/g, '').toUpperCase()
}

export function isBloombergBridgeConfigured(): boolean {
  return Boolean(process.env.BLOOMBERG_BRIDGE_URL?.trim())
}

/**
 * POST JSON { tickers: string[] } to bridge; expect { quotes: [...] }.
 * Each row: flexible keys (last/LAST_PRICE/pxLast, etc.).
 */
export async function fetchBloombergQuotesViaBridge(
  tickers: string[]
): Promise<Map<string, BloombergQuoteNormalized> | null> {
  const base = process.env.BLOOMBERG_BRIDGE_URL?.trim()
  if (!base || tickers.length === 0) return null

  const timeout = Math.min(30_000, Math.max(500, parseInt(process.env.BLOOMBERG_BRIDGE_TIMEOUT_MS || '4000', 10)))
  const secret = process.env.BLOOMBERG_BRIDGE_SECRET?.trim()

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeout)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) headers['X-Bridge-Secret'] = secret

    const res = await fetch(`${base.replace(/\/$/, '')}/quotes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tickers }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.warn('[Bloomberg bridge] HTTP', res.status, await res.text().catch(() => ''))
      return null
    }

    const body = (await res.json()) as { quotes?: unknown[] }
    const rows = Array.isArray(body.quotes) ? body.quotes : []
    const map = new Map<string, BloombergQuoteNormalized>()

    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const ticker = pickSymbol(row)
      if (!ticker) continue

      const price =
        num(row.last) ||
        num(row.LAST_PRICE) ||
        num(row.pxLast) ||
        num(row.PX_LAST) ||
        num(row.regularMarketPrice)
      if (price <= 0) continue

      const change = num(row.change) || num(row.CHANGE) || num(row.NET_CHANGE) || num(row.regularMarketChange)
      const changePct =
        num(row.changePct) ||
        num(row.pctChange) ||
        num(row.PCT_CHG) ||
        num(row.CHANGE_PCT) ||
        num(row.regularMarketChangePercent)
      const vol = num(row.volume) || num(row.VOLUME) || num(row.regularMarketVolume)
      const hi = num(row.high52w) || num(row.HIGH_52WEEK) || num(row.fiftyTwoWeekHigh)
      const lo = num(row.low52w) || num(row.LOW_52WEEK) || num(row.fiftyTwoWeekLow)
      const pe = num(row.pe) || num(row.PE_RATIO) || num(row.trailingPE)
      const mcap = row.marketCap ?? row.MARKET_CAP ?? row.CUR_MKT_CAP
      // Phase 13 S2 fix (F4.7): use formatCompactNumber for proper T/B/M
      // formatting. Previously hardcoded 'B' suffix made AAPL render as
      // "3500.0B" and small caps as "0.3B".
      let marketCap = 'N/A'
      if (typeof mcap === 'number' && mcap > 0) marketCap = formatCompactNumber(mcap)
      else if (typeof mcap === 'string') marketCap = mcap

      const bid = num(row.bid) || num(row.BID) || undefined
      const ask = num(row.ask) || num(row.ASK) || undefined

      map.set(ticker, {
        ticker,
        price,
        change,
        changePct,
        volume: vol,
        high52w: hi,
        low52w: lo,
        pe,
        marketCap,
        bid: bid || undefined,
        ask: ask || undefined,
        dataSource: 'bloomberg',
      })
    }

    return map.size > 0 ? map : null
  } catch (e) {
    console.warn('[Bloomberg bridge]', e)
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function bridgeHealthCheck(): Promise<{
  ok: boolean
  latencyMs?: number
  error?: string
}> {
  const base = process.env.BLOOMBERG_BRIDGE_URL?.trim()
  if (!base) return { ok: false, error: 'BLOOMBERG_BRIDGE_URL not set' }

  const secret = process.env.BLOOMBERG_BRIDGE_SECRET?.trim()
  const started = Date.now()
  try {
    const headers: Record<string, string> = {}
    if (secret) headers['X-Bridge-Secret'] = secret
    const res = await fetch(`${base.replace(/\/$/, '')}/health`, { headers, signal: AbortSignal.timeout(3000) })
    return { ok: res.ok, latencyMs: Date.now() - started, error: res.ok ? undefined : `HTTP ${res.status}` }
  } catch (e) {
    // Phase 13 S2 fix (F4.8): never leak raw error in production responses.
    return { ok: false, latencyMs: Date.now() - started, error: sanitizeError(e) ?? 'bridge unreachable' }
  }
}
