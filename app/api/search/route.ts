import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'
import { applyRateLimit } from '@/lib/api/rateLimit'

// Prevent Next.js from attempting static rendering — this route needs request.url at runtime.
export const dynamic = 'force-dynamic'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

/** Skip non-tradeable clutter; everything else from Yahoo stays (types vary by region). */
const EXCLUDED_QUOTE_TYPES = new Set(['OPTION'])

function mapQuoteRow(quote: {
  symbol: string
  shortname?: string
  longname?: string
  exchDisp?: string
  exchange?: string
  typeDisp?: string
  quoteType?: string
}) {
  return {
    symbol: quote.symbol,
    shortname:
      (typeof quote.shortname === 'string' && quote.shortname) ||
      (typeof quote.longname === 'string' && quote.longname) ||
      quote.symbol,
    exchange: quote.exchDisp || quote.exchange || '',
    typeDisp: quote.typeDisp || quote.quoteType || '',
  }
}

/** Single-token symbol guess: AAPL, BRK-B, BRK.B, 9988.HK, GC=F, ^VIX */
function looksLikeTickerToken(s: string): string | null {
  const t = s.trim().toUpperCase()
  if (t.length < 1 || t.length > 24) return null
  if (!/^[A-Z0-9^.\-=*]+$/.test(t)) return null
  return yahooSymbolFromParam(t)
}

/** When Yahoo `search()` fails or returns nothing, map common names → ticker for direct `quote()`. */
const COMPANY_NAME_HINTS: Record<string, string> = {
  apple: 'AAPL',
  microsoft: 'MSFT',
  amazon: 'AMZN',
  google: 'GOOGL',
  tesla: 'TSLA',
  meta: 'META',
  nvidia: 'NVDA',
}

async function resolveDirectQuote(raw: string) {
  const symbol = looksLikeTickerToken(raw)
  if (!symbol) return null
  try {
    const quoteResult = await yahooFinance.quote(symbol)
    const q = (Array.isArray(quoteResult) ? quoteResult[0] : quoteResult) as {
      symbol?: string
      shortName?: string
      longName?: string
      quoteType?: string
      exchange?: string
      fullExchangeName?: string
    }
    if (!q) return null
    const sym = q.symbol || symbol
    if (!sym) return null
    return mapQuoteRow({
      symbol: sym,
      shortname: q.shortName,
      longname: q.longName,
      exchDisp: q.fullExchangeName,
      exchange: q.exchange,
      typeDisp: q.quoteType,
      quoteType: q.quoteType,
    })
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  // Rate limit: 30 req/min per IP
  const rateLimitResponse = applyRateLimit(request, 'search', { maxRequests: 30, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  try {
    return await handleSearchGet(request)
  } catch (error) {
    console.error('[Search API] Unhandled error:', error)
    return NextResponse.json({ quotes: [], error: 'search_unavailable' })
  }
}

async function handleSearchGet(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()
  const limitRaw = parseInt(searchParams.get('limit') || '40', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 40

  if (!q) {
    return NextResponse.json({ quotes: [] })
  }

  const seen = new Set<string>()
  const out: ReturnType<typeof mapQuoteRow>[] = []

  const pushUnique = (row: ReturnType<typeof mapQuoteRow>) => {
    const k = row.symbol.toUpperCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(row)
  }

  try {
    const result = await yahooFinance.search(q, { newsCount: 0, quotesCount: limit })

    const raw = result.quotes ?? []
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      if (!('symbol' in row) || typeof row.symbol !== 'string') continue
      if ('isYahooFinance' in row && row.isYahooFinance === false) continue
      const qt = 'quoteType' in row && typeof row.quoteType === 'string' ? row.quoteType : ''
      if (qt && EXCLUDED_QUOTE_TYPES.has(qt)) continue
      pushUnique(mapQuoteRow(row as Parameters<typeof mapQuoteRow>[0]))
      if (out.length >= limit) break
    }
  } catch (error) {
    console.error('[Search API] Yahoo search failed:', error)
  }

  const hintTicker = COMPANY_NAME_HINTS[q.toLowerCase()]
  if (out.length === 0 && hintTicker) {
    const direct = await resolveDirectQuote(hintTicker)
    if (direct) pushUnique(direct)
  }

  if (out.length === 0 || looksLikeTickerToken(q)) {
    const direct = await resolveDirectQuote(q)
    if (direct) {
      const sym = direct.symbol.toUpperCase()
      const idx = out.findIndex((r) => r.symbol.toUpperCase() === sym)
      if (idx >= 0) out.splice(idx, 1)
      out.unshift(direct)
    }
  }

  return NextResponse.json({ quotes: out.slice(0, limit) })
}
