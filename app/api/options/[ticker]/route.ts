import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { fetchOptionsChain } from '@/lib/options/chain'
import { putCallRatio, maxPain } from '@/lib/options/sentiment'
import { computeGex } from '@/lib/options/gex'
import { unusualFlow, flowSentiment } from '@/lib/options/flow'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'

const yahooFinance = new YahooFinance()

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: tickerParam } = await params
  // Rate limit: 30 req/min per IP
  const rateLimitResponse = await applyRateLimit(req, 'options', { maxRequests: 30, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  // Phase 16 audit (2026-05-24): switched from the permissive
  // yahooSymbolFromParam (no character whitelist — F7.3 risk) to the strict
  // normalizeTicker SSOT in lib/api/sanitize.ts. Routes accepting a ticker
  // path param MUST validate it before reaching the upstream Yahoo client.
  const symbol = normalizeTicker(tickerParam)
  if (!symbol) {
    return NextResponse.json({ error: 'Invalid ticker symbol' }, { status: 400 })
  }

  // Options data is only meaningful for equities/ETFs
  if (symbol.startsWith('^')) {
    return NextResponse.json(
      { error: 'Options data is not available for index symbols.' },
      { status: 422 },
    )
  }

  try {
    // Phase 13 S2: pull trailing annual dividend yield from the underlying's
    // quote so the Merton-extended Black-Scholes pricing in chain.ts uses
    // the correct `q`. Without this, SPY/JNJ/utility puts are mispriced.
    // Fail-open to q=0 if the quote fetch fails — better to emit BS-1973
    // greeks than no greeks at all.
    let dividendYield = 0
    try {
      const q = await yahooFinance.quote(symbol) as Record<string, unknown> | null
      const raw = q?.trailingAnnualDividendYield
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 0.20) {
        dividendYield = raw
      }
    } catch {
      // Non-critical: fall through with q=0
    }

    const chain = await fetchOptionsChain(symbol, undefined, dividendYield)

    const pcRatio = putCallRatio(chain.calls, chain.puts)
    // Phase 14 wave 41 F2: pass spot so tied minima resolve to the strike
    // nearest current price instead of the (often deep-OTM) lowest strike.
    const mp = maxPain(chain.calls, chain.puts, chain.underlyingPrice)
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
