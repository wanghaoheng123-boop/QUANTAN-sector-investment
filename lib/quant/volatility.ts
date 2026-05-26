/**
 * Annualized volatility from a daily close series.
 *
 * Convention (Phase 14 Q2-M-1 doc'd): LOG RETURNS r_i = ln(c_i / c_{i-1}).
 *
 * Why log returns for vol:
 *   • Log returns aggregate additively over time, so σ_T = σ_1 · √T is the
 *     correct horizon scaling (T-day vol = √T · daily vol).
 *   • Simple returns aggregate across portfolios but NOT across time — using
 *     them with the √252 factor introduces a small but systematic bias when
 *     daily moves are large (the bias is O(σ²/2)).
 *   • Standard reference: Tsay (2010) "Analysis of Financial Time Series",
 *     pp 3–7 — "log returns aggregate over time, simple returns aggregate
 *     across portfolios."
 *
 * Sister functions in regimeDetection.ts and relativeStrength.ts also use
 * log returns for the same reason. `lib/quant/indicators.ts::dailyReturns`
 * deliberately uses SIMPLE returns because it feeds portfolio-aggregation
 * (Sharpe, Sortino, contribution analysis).
 */
export function annualizedVolFromCloses(closes: number[]): number {
  const c = closes.filter((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)
  if (c.length < 8) return 0.22
  const lr: number[] = []
  for (let i = 1; i < c.length; i++) lr.push(Math.log(c[i] / c[i - 1]))
  const mean = lr.reduce((a, b) => a + b, 0) / lr.length
  const varSample =
    lr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, lr.length - 1)
  const dailySigma = Math.sqrt(Math.max(varSample, 0))
  return dailySigma * Math.sqrt(252)
}
