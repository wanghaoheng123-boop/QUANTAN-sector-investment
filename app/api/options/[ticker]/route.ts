import { NextResponse } from 'next/server'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'
import { fetchOptionsChain } from '@/lib/options/chain'
import { putCallRatio, maxPain } from '@/lib/options/sentiment'
import { computeGex } from '@/lib/options/gex'
import { unusualFlow, flowSentiment } from '@/lib/options/flow'
import { applyRateLimit } from '@/lib/api/rateLimit'

export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  // Rate limit: 30 req/min per IP
  const rateLimitResponse = applyRateLimit(req, 'options', { maxRequests: 30, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse
  const symbol = yahooSymbolFromParam(params.ticker)

  // Options data is only meaningful for equities/ETFs
  if (symbol.startsWith('^')) {
    return NextResponse.json(
      { error: 'Options data is not available for index symbols.' },
      { status: 422 },
    )
  }

  try {
    const chain = await fetchOptionsChain(symbol)

    const pcRatio = putCallRatio(chain.calls, chain.puts)
    const mp = maxPain(chain.calls, chain.puts)
    const gex = computeGex(chain.calls, chain.puts, chain.underlyingPrice)
    const flow = unusualFlow(chain.calls, chain.puts)
    const sentiment = flowSentiment(flow)

    return NextResponse.json(
      {
        symbol: chain.ticker,
        underlyingPrice: chain.underlyingPrice,
        expirationDates: chain.expirationDates,
        currentExpiry: chain.currentExpiry,
        calls: chain.calls,
        puts: chain.puts,
        sentiment: {
          putCallVolumeRatio: pcRatio.volumeRatio,
          putCallOiRatio: pcRatio.oiRatio,
          maxPain: mp,
          flowLabel: sentiment,
        },
        gex,
        unusualFlow: flow,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } },
    )
  } catch (e) {
    console.error('[Options API]', symbol, e)
    return NextResponse.json(
      { error: 'Failed to fetch options data', details: String(e) },
      { status: 502 },
    )
  }
}
