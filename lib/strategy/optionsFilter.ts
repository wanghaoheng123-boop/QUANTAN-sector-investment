/**
 * Options and microstructure filtering for the simulator API.
 *
 * Fetches options chain data from Yahoo Finance and applies
 * institutional-grade options market filters to BUY signals.
 */

import YahooFinance from 'yahoo-finance2'
import {
  normalizeYahooOptionsChain,
  computeGammaAnalysis,
} from '@/lib/quant/optionsGamma'
import type { OptionsFilterConfig, OptionsSignalFusionConfig } from './strategyConfig'

// ─── OptionsMetrics type ───────────────────────────────────────────────────────

export interface OptionsMetrics {
  gammaFlipStrike: number | null
  callWallStrike: number | null
  putWallStrike: number | null
  maxPainStrike: number | null
  totalGammaExposure: number
  putCallRatio: number
  vanna: number | null
  charm: number | null
  spotPrice: number
}

// ─── Options chain fetching ───────────────────────────────────────────────────

const optionsCache = new Map<string, { data: OptionsMetrics; expires: number }>()
const OPTIONS_CACHE_TTL_MS = 60_000

/**
 * Fetches options chain metrics for a ticker directly from Yahoo Finance.
 * Uses the same methodology as lib/quant/optionsGamma.
 *
 * Returns null if options data is unavailable.
 */
export async function fetchOptionsMetrics(ticker: string): Promise<OptionsMetrics | null> {
  const cached = optionsCache.get(ticker)
  if (cached && Date.now() < cached.expires) return cached.data

  try {
    const [quoteResult, optionsResult] = await Promise.all([
      YahooFinance.quote(ticker) as Promise<{
        regularMarketPrice: number
        regularMarketTime: number
      }>,
      YahooFinance.options(ticker) as Promise<{
        expirationDates: number[]
        hasMiniOptions: boolean
        calls: Record<string, unknown>[]
        puts: Record<string, unknown>[]
      }>,
    ])

    const spotPrice = quoteResult.regularMarketPrice
    const quoteTime = new Date(quoteResult.regularMarketTime * 1000).toISOString()

    if (!spotPrice || spotPrice <= 0) return null

    const rawChain = {
      expirationDates: optionsResult.expirationDates ?? [],
      calls: optionsResult.calls ?? [],
      puts: optionsResult.puts ?? [],
    }

    const expiryChain = normalizeYahooOptionsChain(ticker, spotPrice, rawChain)
    const analysis = computeGammaAnalysis(ticker, spotPrice, quoteTime, expiryChain)

    const metrics: OptionsMetrics = {
      gammaFlipStrike: analysis.gammaFlipStrike,
      callWallStrike: analysis.callWallStrike,
      putWallStrike: analysis.putWallStrike,
      maxPainStrike: analysis.maxPainStrike,
      totalGammaExposure: analysis.totalGammaExposure,
      putCallRatio: analysis.putCallRatio,
      vanna: analysis.vannaExposure,
      charm: analysis.charmExposure,
      spotPrice: analysis.spotPrice,
    }

    optionsCache.set(ticker, { data: metrics, expires: Date.now() + OPTIONS_CACHE_TTL_MS })
    return metrics
  } catch {
    return null
  }
}

// ─── Options filter ───────────────────────────────────────────────────────────

/**
 * Applies options market filters to a BUY signal.
 *
 * @param params  - Options filter configuration from StrategyConfig
 * @param metrics - Computed options metrics (null if unavailable)
 * @param price  - Current signal price
 * @returns Filter result with pass/fail and reason
 */
/**
 * Conservative fusion: block dip-buys when spot is pressed against the call wall band.
 * Does not replace `applyOptionsFilter`; runs after it when enabled.
 */
export function applyOptionsSignalFusion(
  fusion: OptionsSignalFusionConfig,
  metrics: OptionsMetrics | null,
  price: number,
): { pass: boolean; reason: string } {
  if (!fusion.enabled) {
    return { pass: true, reason: 'options signal fusion disabled' }
  }
  if (metrics == null || metrics.callWallStrike == null || !Number.isFinite(metrics.callWallStrike)) {
    return { pass: true, reason: 'call wall unavailable — fusion skipped' }
  }
  const thr = metrics.callWallStrike * (1 + Math.max(0, fusion.callWallProximityBlockPct))
  if (price >= thr) {
    return {
      pass: false,
      reason: `fusion: spot ${price.toFixed(2)} at/above call-wall band (${thr.toFixed(2)})`,
    }
  }
  return { pass: true, reason: 'fusion: below call-wall proximity band' }
}

export function applyOptionsFilter(
  params: OptionsFilterConfig,
  metrics: OptionsMetrics | null,
  price: number,
): { pass: boolean; reason: string } {
  if (!params.useOptionsFilter) {
    return { pass: true, reason: 'options filter disabled' }
  }

  if (metrics === null) {
    return { pass: true, reason: 'options data unavailable' }
  }

  if (
    params.requireCallWallClearance &&
    metrics.callWallStrike !== null &&
    price < metrics.callWallStrike
  ) {
    return {
      pass: false,
      reason: `price ${price.toFixed(2)} below call wall ${metrics.callWallStrike.toFixed(2)}`,
    }
  }

  if (
    params.requirePutWallClearance &&
    metrics.putWallStrike !== null &&
    price < metrics.putWallStrike
  ) {
    return {
      pass: false,
      reason: `price ${price.toFixed(2)} below put wall ${metrics.putWallStrike.toFixed(2)}`,
    }
  }

  if (
    params.maxPutCallRatio !== undefined &&
    Number.isFinite(params.maxPutCallRatio) &&
    metrics.putCallRatio > params.maxPutCallRatio
  ) {
    return {
      pass: false,
      reason: `put/call ratio ${metrics.putCallRatio.toFixed(3)} exceeds max ${params.maxPutCallRatio}`,
    }
  }

  if (
    params.minGammaExposure !== undefined &&
    Number.isFinite(params.minGammaExposure) &&
    metrics.totalGammaExposure < params.minGammaExposure
  ) {
    return {
      pass: false,
      reason: `gamma exposure ${metrics.totalGammaExposure.toFixed(0)} below min ${params.minGammaExposure}`,
    }
  }

  if (params.requirePositiveVanna && metrics.vanna !== null && metrics.vanna <= 0) {
    return {
      pass: false,
      reason: `vanna ${metrics.vanna.toFixed(4)} is not positive`,
    }
  }

  return { pass: true, reason: 'all options filters passed' }
}
