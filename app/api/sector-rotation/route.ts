import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { SECTORS } from '@/lib/sectors'
import { sectorScores } from '@/lib/quant/sectorRotation'
import { hasPositiveClose } from '@/lib/quant/chartQuoteFilter'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'

const yahooFinance = new YahooFinance()

/**
 * Fetch 1yr of daily closes for an ETF.
 * Returns the closes on success, or a structured failure reason so callers
 * can distinguish "thin data" from "fetch failed" (R4-M-5, Phase 14).
 */
type FetchResult =
  | { ok: true; closes: number[] }
  | { ok: false; reason: 'insufficient_data' | 'fetch_failed'; count?: number }

async function fetchCloses(etf: string): Promise<FetchResult> {
  try {
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 1)
    const chart = await yahooFinance.chart(etf, { period1, interval: '1d' })
    const closes = (chart?.quotes ?? [])
      .filter(hasPositiveClose)
      .map((q) => q.close!)
    if (closes.length > 20) return { ok: true, closes }
    // R4-M-5 (Phase 14): make thin-data exclusions visible to operators.
    console.warn(JSON.stringify({
      event: 'sector-rotation.insufficient_data',
      etf,
      closes: closes.length,
      minimum: 21,
    }))
    return { ok: false, reason: 'insufficient_data', count: closes.length }
  } catch (err) {
    // Phase 13 S2 fix: previously silent; operators couldn't diagnose
    // partial-data sector rotation failures.
    console.warn('[sector-rotation] fetchCloses failed for', etf, err)
    return { ok: false, reason: 'fetch_failed' }
  }
}

export async function GET(request: Request) {
  // Phase 13 S2: rate-limit. Each request triggers 11 yahoo chart calls
  // (one per sector ETF), so abuse amplifies upstream load 11×.
  const rateLimitResponse = await applyRateLimit(request, 'sector-rotation', {
    maxRequests: 10,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  try {
    // Fetch all sector ETF closes in parallel
    const etfList = SECTORS.map((s) => s.etf)
    const results = await Promise.allSettled(etfList.map(fetchCloses))

    const etfData: Record<string, number[]> = {}
    const excludedSectors: Array<{ etf: string; reason: string; closes?: number }> = []
    for (let i = 0; i < etfList.length; i++) {
      const etf = etfList[i]
      const result = results[i]
      if (result.status === 'fulfilled' && result.value.ok) {
        etfData[etf] = result.value.closes
      } else if (result.status === 'fulfilled' && !result.value.ok) {
        // R4-M-5 (Phase 14): surface excluded sectors in the response so
        // operators and end-users know why a sector is missing.
        excludedSectors.push({
          etf,
          reason: result.value.reason,
          closes: result.value.count,
        })
      } else if (result.status === 'rejected') {
        excludedSectors.push({ etf, reason: 'promise_rejected' })
      }
    }

    const scores = sectorScores(etfData)

    return NextResponse.json(
      {
        scores,
        excludedSectors,
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
