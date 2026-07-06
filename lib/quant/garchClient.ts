/**
 * GARCH(1,1) client — TS proxy to quant_framework or analytic fallback (Q-041-NEW).
 */

import { tradingDaysPerYear } from '@/lib/backtest/core'

export interface GarchForecastPoint {
  date: string
  conditionalVol: number
}

export interface GarchForecastResult {
  ticker: string
  model: 'GARCH(1,1)'
  forecast: GarchForecastPoint[]
  source: 'python' | 'ewma-fallback'
}

/**
 * EWMA fallback when Python sidecar unavailable (~GARCH proxy for API smoke).
 *
 * Phase 16 audit (2026-05-24) — refinement:
 *   1. Forecast horizon now skips weekends — emits the next N **business
 *      days** (Mon–Fri) starting from tomorrow. Calendar-day dates were
 *      labeling Saturday/Sunday as trading days, which the UI then plotted
 *      as zero-volume bars and confused viewers.
 *   2. EWMA(λ) without a long-term mean is mathematically flat in
 *      multi-step forecasts (no ω term), so all horizon entries share the
 *      same `conditionalVol`. This is *honest* for a pure-EWMA proxy;
 *      real GARCH(1,1) MLE (Phase 16 S3, Q-041-NEW continuation) will
 *      produce a decaying forecast toward unconditional variance.
 *
 * Q25-1 (2026-07-06): annualization and the forecast calendar are now
 * instrument-aware. Crypto trades 365 days/yr, so annualizing its daily
 * variance with √252 understated the displayed conditional vol by
 * √(365/252) ≈ 1.20× and the business-day calendar mislabeled weekend
 * trading days as non-days. Equity callers are unchanged (252, Mon–Fri).
 *
 * @param closes  Daily close series (≥30 bars required).
 * @param horizon Number of forecast days to emit.
 * @param lambda  EWMA decay (RiskMetrics convention 0.94 for daily).
 * @param opts    periodsPerYear: annualization factor (default 252);
 *                includeWeekends: emit Sat/Sun forecast dates (crypto).
 */
export function ewmaVolForecast(
  closes: number[],
  horizon = 20,
  lambda = 0.94,
  opts?: { periodsPerYear?: number; includeWeekends?: boolean },
): GarchForecastPoint[] {
  if (closes.length < 30) return []
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]))
  }
  let varEwma = rets.slice(0, 20).reduce((s, r) => s + r * r, 0) / 20
  for (let i = 20; i < rets.length; i++) {
    varEwma = lambda * varEwma + (1 - lambda) * rets[i] * rets[i]
  }
  const annualVol = Math.sqrt(varEwma) * Math.sqrt(opts?.periodsPerYear ?? 252)
  const includeWeekends = opts?.includeWeekends ?? false
  const out: GarchForecastPoint[] = []
  const cursor = new Date()
  let emitted = 0
  // Cap the search at horizon × 2 calendar days so a pathological clock can't
  // cause an infinite loop. With 5 of every 7 days being business days,
  // 2× horizon is safe headroom.
  for (let probe = 0; probe < horizon * 2 + 7 && emitted < horizon; probe++) {
    cursor.setDate(cursor.getDate() + 1)
    const day = cursor.getUTCDay()
    if (!includeWeekends && (day === 0 || day === 6)) continue // Sun/Sat skipped (equities)
    out.push({
      date: cursor.toISOString().slice(0, 10),
      conditionalVol: annualVol,
    })
    emitted++
  }
  return out
}

export async function fetchGarchForecast(ticker: string, closes: number[]): Promise<GarchForecastResult> {
  const sidecar = process.env.QUANT_FRAMEWORK_URL
  if (sidecar) {
    try {
      const res = await fetch(`${sidecar}/garch/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = (await res.json()) as GarchForecastResult
        return { ...data, source: 'python' }
      }
    } catch {
      /* fallback */
    }
  }
  // Q25-1: crypto (BTC/ETH/SOL — tradingDaysPerYear SSOT) annualizes with 365
  // and forecasts across the full 7-day week; equities stay 252 / Mon–Fri.
  const periodsPerYear = tradingDaysPerYear(ticker, '')
  return {
    ticker,
    model: 'GARCH(1,1)',
    forecast: ewmaVolForecast(closes, 20, 0.94, {
      periodsPerYear,
      includeWeekends: periodsPerYear === 365,
    }),
    source: 'ewma-fallback',
  }
}
