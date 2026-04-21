import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { normalizeYahooOptionsChain } from '@/lib/quant/optionsGamma'
import { buildOptionsIntelligence } from '@/lib/options/intelligence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker?.toUpperCase() ?? ''
  if (!ticker) {
    return NextResponse.json({ error: 'Ticker is required' }, { status: 400 })
  }

  try {
    const [quoteResult, optionsResult] = await Promise.all([
      YahooFinance.quote(ticker) as Promise<{
        regularMarketPrice: number
        regularMarketTime: number
      }>,
      YahooFinance.options(ticker) as Promise<{
        expirationDates: number[]
        calls: Record<string, unknown>[]
        puts: Record<string, unknown>[]
      }>,
    ])

    const spotPrice = quoteResult.regularMarketPrice
    if (!spotPrice || spotPrice <= 0) {
      return NextResponse.json({ error: `Invalid spot price for ${ticker}` }, { status: 422 })
    }

    const expiries = normalizeYahooOptionsChain(
      ticker,
      spotPrice,
      {
        expirationDates: optionsResult.expirationDates ?? [],
        calls: optionsResult.calls ?? [],
        puts: optionsResult.puts ?? [],
      },
      new Date(quoteResult.regularMarketTime * 1000)
    )

    if (expiries.length === 0) {
      return NextResponse.json({
        ticker,
        error: `No listed options available for ${ticker}`,
      })
    }

    const intelligence = buildOptionsIntelligence(spotPrice, expiries)
    return NextResponse.json(
      {
        ticker,
        quoteTime: new Date(quoteResult.regularMarketTime * 1000).toISOString(),
        ...intelligence,
      },
      {
        headers: {
          'Cache-Control': 's-maxage=120, stale-while-revalidate=300',
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to build options intelligence', details: String(error) },
      { status: 500 }
    )
  }
}
