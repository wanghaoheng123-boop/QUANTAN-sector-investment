/**
 * GARCH(1,1) client — TS proxy to quant_framework or analytic fallback (Q-041-NEW).
 */

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

/** EWMA fallback when Python sidecar unavailable (~GARCH proxy for API smoke). */
export function ewmaVolForecast(closes: number[], horizon = 20, lambda = 0.94): GarchForecastPoint[] {
  if (closes.length < 30) return []
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]))
  }
  let varEwma = rets.slice(0, 20).reduce((s, r) => s + r * r, 0) / 20
  for (let i = 20; i < rets.length; i++) {
    varEwma = lambda * varEwma + (1 - lambda) * rets[i] * rets[i]
  }
  const dailyVol = Math.sqrt(varEwma)
  const start = new Date()
  const out: GarchForecastPoint[] = []
  for (let h = 1; h <= horizon; h++) {
    const d = new Date(start)
    d.setDate(d.getDate() + h)
    out.push({ date: d.toISOString().slice(0, 10), conditionalVol: dailyVol * Math.sqrt(252) })
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
  return {
    ticker,
    model: 'GARCH(1,1)',
    forecast: ewmaVolForecast(closes),
    source: 'ewma-fallback',
  }
}
