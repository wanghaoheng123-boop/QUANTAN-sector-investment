/**
 * Q-139 — the single backtest pass, split into consecutive periods.
 *
 * The /backtest Analysis tab called this "Walk-Forward / Overfitting Check"
 * with "Rolling Quarterly Performance" and an "In-Sample" figure. None of
 * those were true: `backtestInstrument` fits no parameters, so there is no
 * in-sample/out-of-sample split; the four "quarters" were four equal slices of
 * a ~4-year curve (about a year each); and the "In-Sample" number was the
 * full-period result. What the split CAN show honestly is whether a result is
 * concentrated in one stretch of the window — so that is what it is named.
 *
 * Sharpe follows the engine's own definition (lib/backtest/core.ts): daily
 * returns of the equity curve, excess over the annual risk-free rate spread
 * evenly across the instrument's trading days, annualised by √(days per year)
 * — Sharpe, W. F. (1994), "The Sharpe Ratio", J. Portfolio Management 21(1).
 * The panel used to hardcode 4% and 252 days while the engine used 4.5% and
 * 365 for crypto, so the same curve had two Sharpes on one page.
 */

export interface PeriodStats {
  /** 1-based, oldest first. */
  index: number
  /** Equity-curve points in this period. */
  bars: number
  totalReturn: number
  /** Null when the period is too short to annualise meaningfully. */
  annualizedReturn: number | null
  sharpe: number | null
}

/** Below this many returns a period's Sharpe and annualisation are noise. */
const MIN_PERIOD_RETURNS = 10
/** A standard deviation this small is a flat (all-cash) period, not a ratio's denominator. */
const FLAT_SD = 1e-10

export function splitIntoPeriods(
  curve: readonly number[],
  daysPerYear: number,
  riskFreeAnnual: number,
  periods = 4,
): PeriodStats[] {
  const len = curve.length
  const size = Math.floor(len / periods)
  if (size < MIN_PERIOD_RETURNS + 1) return []
  const out: PeriodStats[] = []
  for (let p = 0; p < periods; p++) {
    // Each period starts at the previous one's last point, so the periods'
    // returns chain to the whole: no return between periods is dropped.
    const start = p === 0 ? 0 : p * size - 1
    const end = p === periods - 1 ? len : (p + 1) * size
    const seg = curve.slice(start, end)
    const rets: number[] = []
    for (let i = 1; i < seg.length; i++) {
      const r = (seg[i] - seg[i - 1]) / seg[i - 1]
      if (Number.isFinite(r)) rets.push(r)
    }
    const totalReturn = (seg[seg.length - 1] - seg[0]) / seg[0]
    if (rets.length < MIN_PERIOD_RETURNS || !Number.isFinite(totalReturn)) {
      out.push({ index: p + 1, bars: seg.length, totalReturn, annualizedReturn: null, sharpe: null })
      continue
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length
    const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1))
    const rfDaily = riskFreeAnnual / daysPerYear
    out.push({
      index: p + 1,
      bars: seg.length,
      totalReturn,
      annualizedReturn: (1 + totalReturn) ** (daysPerYear / rets.length) - 1,
      sharpe: sd > FLAT_SD ? ((mean - rfDaily) / sd) * Math.sqrt(daysPerYear) : null,
    })
  }
  return out
}
