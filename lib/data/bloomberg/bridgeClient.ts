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
import { parseQuoteTime } from '@/lib/format'

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
  /**
   * Q-129: the timestamp the BRIDGE reported for this quote, ISO or null.
   * Null when the bridge supplied none or supplied an unparseable one. A
   * consumer may never substitute another vendor's clock for it — that is the
   * defect this field exists to make impossible (see lib/data/mergeQuotes.ts).
   */
  quoteTime: string | null
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

/**
 * Q-128: parse a bridge numeric with a FULL-STRING contract.
 *
 * The previous implementation used `parseFloat`, which parses a PREFIX and
 * silently discards the rest: `'1,234.5'` became `1` and `'123oops'` became
 * `123`. It also returned `0` when nothing parsed, which fabricates a value —
 * and for a price, 0 is not a neutral default but a false quote.
 *
 * Returns null for anything that is not a complete, finite number. Callers
 * decide what absent means for their field; nothing here invents one.
 * `'1e309'` parses but is not finite, so it is rejected by the finite check.
 */
export function parseBridgeNumber(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x !== 'string') return null
  const s = x.trim()
  if (s === '') return null
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * First alternate key that yields a usable number.
 *
 * Preserves the previous `a || b || c` preference for a NON-ZERO alternate —
 * bridges report 0 for "not supplied" on several fields — while distinguishing
 * "every key was absent or malformed" (null) from "a key genuinely said zero"
 * (0). Malformed input can therefore no longer outrank a valid later key.
 */
function pickNumber(...candidates: unknown[]): number | null {
  let sawZero = false
  for (const c of candidates) {
    const n = parseBridgeNumber(c)
    if (n === null) continue
    if (n === 0) { sawZero = true; continue }
    return n
  }
  return sawZero ? 0 : null
}

/** Q-129: the bridge's own clock for this row, under any of its spellings. */
export function pickBridgeQuoteTime(row: Record<string, unknown>): string | null {
  return parseQuoteTime(
    row.quoteTime ?? row.time ?? row.TIME ?? row.timestamp ?? row.lastUpdate ??
    row.LAST_UPDATE ?? row.LAST_UPDATE_DT ?? row.regularMarketTime ?? null,
  )
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

/**
 * Q-108: a URL alone must never enable public redistribution. This server-only
 * acknowledgement records an operator assertion, not proof of a licence.
 * The substantive licence decision remains with the owner (Q-082/Q-083).
 */
const REDISTRIBUTION_ACK = 'i-confirm-our-bloomberg-agreement-permits-this-redistribution'

export function bloombergBridgeState(): 'off' | 'unacknowledged' | 'enabled' {
  if (!process.env.BLOOMBERG_BRIDGE_URL?.trim()) return 'off'
  if (process.env.BLOOMBERG_REDISTRIBUTION_ACK?.trim() !== REDISTRIBUTION_ACK) {
    return 'unacknowledged'
  }
  return 'enabled'
}

/** True only when both the bridge URL and redistribution acknowledgement are set. */
export function isBloombergBridgeConfigured(): boolean {
  return bloombergBridgeState() === 'enabled'
}

/**
 * POST JSON { tickers: string[] } to bridge; expect { quotes: [...] }.
 * Each row: flexible keys (last/LAST_PRICE/pxLast, etc.).
 */
export async function fetchBloombergQuotesViaBridge(
  tickers: string[]
): Promise<Map<string, BloombergQuoteNormalized> | null> {
  const base = process.env.BLOOMBERG_BRIDGE_URL?.trim()
  if (!base || tickers.length === 0 || !isBloombergBridgeConfigured()) return null

  const timeout = Math.min(30_000, Math.max(500, parseInt(process.env.BLOOMBERG_BRIDGE_TIMEOUT_MS || '4000', 10)))
  const secret = process.env.BLOOMBERG_BRIDGE_SECRET?.trim()

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeout)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) headers['X-Bridge-Secret'] = secret

    const res = await fetch(`${base.replace(/\/$/, '')}/quotes`, {
      method: 'POST',
      // Custom secret headers can be forwarded across origins by redirects.
      redirect: 'error',
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

      // Q-128: a malformed price is a missing price. Dropping the row leaves the
      // Yahoo quote standing rather than overwriting it with a parsed prefix.
      const price = pickNumber(row.last, row.LAST_PRICE, row.pxLast, row.PX_LAST, row.regularMarketPrice)
      if (price === null || price <= 0) continue

      // Secondary fields degrade to 0, which the merge already reads as
      // "absent" and attributes to Yahoo — see QuoteProvenance below.
      const change = pickNumber(row.change, row.CHANGE, row.NET_CHANGE, row.regularMarketChange) ?? 0
      const changePct =
        pickNumber(row.changePct, row.pctChange, row.PCT_CHG, row.CHANGE_PCT, row.regularMarketChangePercent) ?? 0
      const vol = pickNumber(row.volume, row.VOLUME, row.regularMarketVolume) ?? 0
      const hi = pickNumber(row.high52w, row.HIGH_52WEEK, row.fiftyTwoWeekHigh) ?? 0
      const lo = pickNumber(row.low52w, row.LOW_52WEEK, row.fiftyTwoWeekLow) ?? 0
      const pe = pickNumber(row.pe, row.PE_RATIO, row.trailingPE) ?? 0
      const mcap = row.marketCap ?? row.MARKET_CAP ?? row.CUR_MKT_CAP
      // Phase 13 S2 fix (F4.7): use formatCompactNumber for proper T/B/M
      // formatting. Previously hardcoded 'B' suffix made AAPL render as
      // "3500.0B" and small caps as "0.3B".
      let marketCap = 'N/A'
      if (typeof mcap === 'number' && mcap > 0) marketCap = formatCompactNumber(mcap)
      else if (typeof mcap === 'string') marketCap = mcap

      const bid = pickNumber(row.bid, row.BID) ?? undefined
      const ask = pickNumber(row.ask, row.ASK) ?? undefined

      map.set(ticker, {
        ticker,
        quoteTime: pickBridgeQuoteTime(row),
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
  if (!isBloombergBridgeConfigured()) return { ok: false, error: 'Bloomberg bridge not acknowledged' }

  const secret = process.env.BLOOMBERG_BRIDGE_SECRET?.trim()
  const started = Date.now()
  try {
    const headers: Record<string, string> = {}
    if (secret) headers['X-Bridge-Secret'] = secret
    const res = await fetch(`${base.replace(/\/$/, '')}/health`, { headers, redirect: 'error', signal: AbortSignal.timeout(3000) })
    return { ok: res.ok, latencyMs: Date.now() - started, error: res.ok ? undefined : `HTTP ${res.status}` }
  } catch (e) {
    // Phase 13 S2 fix (F4.8): never leak raw error in production responses.
    return { ok: false, latencyMs: Date.now() - started, error: sanitizeError(e) ?? 'bridge unreachable' }
  }
}
