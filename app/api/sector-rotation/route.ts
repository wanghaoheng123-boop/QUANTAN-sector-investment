import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { SECTORS } from '@/lib/sectors'
import { sectorScores } from '@/lib/quant/sectorRotation'
import { hasPositiveClose } from '@/lib/quant/chartQuoteFilter'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'

const yahooFinance = new YahooFinance()

/** Fetch 1yr of daily closes for an ETF. Returns null on failure. */
async function fetchCloses(etf: string): Promise<number[] | null> {
  try {
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 1)
    const chart = await yahooFinance.chart(etf, { period1, interval: '1d' })
    const closes = (chart?.quotes ?? [])
      .filter(hasPositiveClose)
      .map((q) => q.close!)
    return closes.length > 20 ? closes : null
  } catch (err) {
    // Phase 13 S2 fix: previously silent; operators couldn't diagnose
    // partial-data sector rotation failures.
    console.warn('[sector-rotation] fetchCloses failed for', etf, err)
    return null
  }
}

export async function GET(request: Request) {
  // Phase 13 S2: rate-limit. Each request triggers 11 yahoo chart calls
  // (one per sector ETF), so abuse amplifies upstream load 11×.
  const rateLimitResponse = applyRateLimit(request, 'sector-rotation', {
    maxRequests: 10,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  try {
    // Fetch all sector ETF closes in parallel
    const etfList = SECTORS.map((s) => s.etf)
    const results = await Promise.allSettled(etfList.map(fetchCloses))

    const etfData: Record<string, number[]> = {}
    for (let i = 0; i < etfList.length; i++) {
      const result = results[i]
      if (result.status === 'fulfilled' && result.value) {
        etfData[etfList[i]] = result.value
      }
    }

    const scores = sectorScores(etfData)

    return NextResponse.json(
      {
        scores,
        fetchedAt: new Date().toISOString(),
        note: 'Sector rotation ranks based on 3/6/12-month momentum and RSI mean-reversion boost.',
      },
      { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' } },
    )
  } catch (e) {
    console.error('[Sector Rotation API]', e)
    return NextResponse.json(
      { error: 'Failed to compute sector rotation', details: sanitizeError(e) ?? null },
      { status: 502 },
    )
  }
}
