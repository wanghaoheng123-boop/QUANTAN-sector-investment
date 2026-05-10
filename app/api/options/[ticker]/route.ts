import { NextResponse } from 'next/server'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'
import { fetchOptionsChain } from '@/lib/options/chain'
import { putCallRatio, maxPain } from '@/lib/options/sentiment'
import { computeGex } from '@/lib/options/gex'
import { unusualFlow, flowSentiment } from '@/lib/options/flow'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'

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
        // Phase 13 S2 (R3 C3.3 — OPRA compliance signal): yahoo-finance2 returns
        // delayed options quotes (free tier ≈ 15-20 min). Surface this so UI can
        // render an explicit "DELAYED" label and downstream callers can decide.
        dataProvenance: {
          provider: 'yahoo-finance2',
          delayedMinutes: 15,
          realtime: false,
        },
      },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } },
    )
  } catch (e) {
    console.error('[Options API]', symbol, e)
    // Phase 13 S2 fix (F4.8): sanitized error message in production.
    return NextResponse.json(
      { error: 'Failed to fetch options data', details: sanitizeError(e) ?? null },
      { status: 502 },
    )
  }
}
