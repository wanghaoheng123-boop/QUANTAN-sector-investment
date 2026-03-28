import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

const ALLOWED_TYPES = new Set([
  'EQUITY',
  'ETF',
  'MUTUALFUND',
  'INDEX',
  'CURRENCY',
  'CRYPTOCURRENCY',
])

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()
  const limitRaw = parseInt(searchParams.get('limit') || '40', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 40

  if (!q) {
    return NextResponse.json({ quotes: [] })
  }

  try {
    const result = await yahooFinance.search(q, {
      newsCount: 0,
      quotesCount: limit,
    })

    const raw = result.quotes ?? []
    const quotes = raw
      .filter((row): row is typeof row & { symbol: string } => {
        if (!row || typeof row !== 'object') return false
        if (!('symbol' in row) || typeof row.symbol !== 'string') return false
        if ('isYahooFinance' in row && row.isYahooFinance === false) return false
        const qt = 'quoteType' in row && typeof row.quoteType === 'string' ? row.quoteType : ''
        if (qt && !ALLOWED_TYPES.has(qt)) return false
        return true
      })
      .slice(0, limit)
      .map((quote) => ({
        symbol: quote.symbol,
        shortname:
          (typeof quote.shortname === 'string' && quote.shortname) ||
          (typeof quote.longname === 'string' && quote.longname) ||
          quote.symbol,
        exchange: quote.exchDisp || quote.exchange || '',
        typeDisp: quote.typeDisp || quote.quoteType || '',
      }))

    return NextResponse.json({ quotes })
  } catch (error) {
    console.error('[Search API] Error searching Yahoo Finance:', error)
    return NextResponse.json({ error: 'Failed to fetch search results', quotes: [] }, { status: 500 })
  }
}
