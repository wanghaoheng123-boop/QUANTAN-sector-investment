/**
 * Walk-Forward Analysis.
 *
 * Splits data into N in-sample (training) and out-of-sample (testing)
 * windows. This is the gold standard for detecting overfitting: if IS ≫ OOS,
 * the strategy is likely curve-fit. Robust strategies show similar metrics
 * in both periods.
 *
 * Phase 16 P15-NEW-10 (2026-05-24): Extracted from `lib/backtest/engine.ts`
 * to keep engine.ts ≤ 600 LOC (S3 architectural target). engine.ts continues
 * to re-export every public symbol from this module so existing call sites
 * (tests, scripts, app routes) do NOT need to change their imports.
 *
 * Reference: Pardo, R. (2008). The Evaluation and Optimization of Trading
 * Strategies, 2e. Wiley. Ch.11 (Walk-Forward Analysis).
 */

import type { OhlcvRow } from './dataLoader'
import { backtestInstrument, tradingDaysPerYear } from './core'
import { getRiskFreeRateSync } from '@/lib/quant/riskFreeRate'

// ─── Public types ───────────────────────────────────────────────────────────

export interface WFWWindow {
  periodLabel: string
  startDate: string
  endDate: string
  isReturn: number
  isSharpe: number | null
  osReturn: number
  osSharpe: number | null
  /** Clamped for UI stability (±1..2). See oosRatioRaw for metric truth. */
  oosRatio: number
  oosRatioRaw: number
}

export interface WalkForwardSummary {
  avgIsReturn: number
  avgOsReturn: number
  avgIsSharpe: number | null
  avgOsSharpe: number | null
  avgOosRatio: number
  /** 0 = perfectly robust, 1 = fully overfit (IS ≫ OS) */
  overfittingIndex: number
  windows: WFWWindow[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** F1.15 — raw OOS/IS ratio plus display clamp for tail overfit warnings. */
export function computeOosRatio(isAnn: number, osAnn: number): { raw: number; display: number } {
  const raw = isAnn !== 0 ? osAnn / isAnn : 0
  return { raw, display: Math.min(2, Math.max(-1, raw)) }
}

// F-12: `periodDays` is the asset's trading days per year (252 equities / 365
// crypto). Hardcoding 252 mis-annualized BTC walk-forward IS/OS returns + Sharpe.
// Defaults to 252 to preserve equity behaviour for any caller that omits it.
function annualized(totalReturn: number, days: number, periodDays = 252): number {
  const years = days / periodDays
  return years > 0 ? ((1 + totalReturn) ** (1 / years) - 1) : 0
}

function windowSharpe(dailyReturns: number[], periodDays = 252): number | null {
  if (dailyReturns.length < 30) return null
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
  const sd = Math.sqrt(Math.max(variance, 0))
  if (sd < 1e-10) return null
  const rfD = getRiskFreeRateSync() / periodDays
  return ((mean - rfD) / sd) * Math.sqrt(periodDays)
}

/** Compute daily returns from an equity-curve slice [a, b). */
function sliceDailyReturns(equityCurve: number[], a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a + 1; i < b && i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]
    if (prev > 0) {
      const r = (equityCurve[i] - prev) / prev
      if (Number.isFinite(r)) out.push(r)
    }
  }
  return out
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Walk-forward analysis via trade attribution.
 *
 * Phase 13 S2 fix (F1.1) — Architectural rework:
 *
 *   PREVIOUS BUG: this function ran `backtestInstrument(testRows)` with
 *   `testRows` of length `testDays = 63`. But `backtestInstrument` short-
 *   circuits when `rows.length < 252` (the 200-bar warmup gate plus 52-bar
 *   minimum signal generation), so the test-window result was always
 *   identically zero. `oosRatio` and `overfittingIndex` were therefore
 *   meaningless — every window reported osReturn=0 regardless of
 *   strategy performance, giving false confidence in OOS robustness.
 *
 *   FIXED APPROACH: run a SINGLE backtest on the full series (which has
 *   sufficient warmup), then partition the resulting trades into IS/OS
 *   windows by entry date. Window return is the sum of trade pnlPct for
 *   trades whose entry date falls within the window. Annualized to a
 *   per-year rate using the window's calendar length.
 *
 *   Note on parameter optimisation: this codebase uses fixed sector-
 *   profile parameters (no per-window re-optimisation), so the strict
 *   "walk-forward optimisation" interpretation (Pardo 2008) doesn't
 *   apply. The function answers "how stable is this strategy across
 *   non-overlapping time windows?" rather than "how much does parameter
 *   re-optimisation overfit?" Sufficient for the platform's stability
 *   diagnostic needs.
 *
 *   Reference: Pardo, R. (2008). The Evaluation and Optimization of
 *   Trading Strategies, 2e. Wiley. Ch.11 (Walk-Forward Analysis).
 */
export function walkForwardAnalysis(
  ticker: string,
  sector: string,
  rows: OhlcvRow[],
  trainDays = 252,
  testDays = 63,
): WFWWindow[] {
  const windows: WFWWindow[] = []
  const n = rows.length

  // Need at least one full IS window past the engine's 252-bar warmup.
  const WARMUP = 252
  if (n < WARMUP + trainDays + testDays) return windows

  // F-12: annualize per the asset's trading calendar (365 for crypto, 252 equities).
  const annDays = tradingDaysPerYear(ticker, sector)

  // Single backtest on full series — produces all trades + equity curve.
  // Note: even when zero trades fire, we still emit windows with 0/0
  // returns so the temporal scaffolding (window labels, dates) is
  // populated for downstream UI tabs that expect a non-empty array.
  const fullResult = backtestInstrument(ticker, sector, rows)
  const trades = fullResult.closedTrades

  // Map row index → ISO date string for window boundary lookups.
  const dateAt = (idx: number) =>
    new Date(rows[idx].time * 1000).toISOString().slice(0, 10)

  // Pre-bucket trades by entry-date for O(N) windowing.
  const sortedTrades = [...trades].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )

  let trainStart = WARMUP
  while (trainStart + trainDays + testDays <= n) {
    const trainEnd = trainStart + trainDays
    const testEnd = trainEnd + testDays

    const trainStartDate = dateAt(trainStart)
    const trainEndDate = dateAt(trainEnd - 1)
    const testStartDate = dateAt(trainEnd)
    const testEndDate = dateAt(testEnd - 1)

    // Trade-attribution: sum pnlPct of trades entering inside each window.
    let isReturnSum = 0
    let osReturnSum = 0
    for (const t of sortedTrades) {
      if (t.date < trainStartDate) continue
      if (t.date > testEndDate) break
      const pnl = t.pnlPct ?? 0
      if (t.date <= trainEndDate) {
        isReturnSum += pnl
      } else if (t.date >= testStartDate) {
        osReturnSum += pnl
      }
    }

    const isAnn = annualized(isReturnSum, trainDays, annDays)
    const osAnn = annualized(osReturnSum, testDays, annDays)

    // Sharpe per window: compute from equityHistory slice. equityHistory[0]
    // is initial capital (set BEFORE the loop), and the loop pushes one
    // entry per iteration starting at row index 200. Index mapping:
    //   row i (i ≥ 200) ↔ equityHistory[i - 199].
    const histStart = Math.max(0, trainStart - 199)
    const histTrainEnd = Math.max(histStart, trainEnd - 199)
    const histTestEnd = Math.max(histTrainEnd, testEnd - 199)
    const isReturns = sliceDailyReturns(fullResult.equityCurve, histStart, histTrainEnd)
    const osReturns = sliceDailyReturns(fullResult.equityCurve, histTrainEnd, histTestEnd)
    const isSharpe = windowSharpe(isReturns, annDays)
    const osSharpe = windowSharpe(osReturns, annDays)

    const { raw: oosRatioRaw, display: oosRatio } = computeOosRatio(isAnn, osAnn)

    windows.push({
      periodLabel: `${trainStartDate.slice(0, 7)} – ${testEndDate.slice(0, 7)}`,
      startDate: trainStartDate,
      endDate: testEndDate,
      isReturn: isAnn,
      isSharpe,
      osReturn: osAnn,
      osSharpe,
      oosRatio,
      oosRatioRaw,
    })

    trainStart += testDays
  }

  return windows
}

export function walkForwardSummary(windows: WFWWindow[]): WalkForwardSummary {
  if (windows.length === 0) {
    return { avgIsReturn: 0, avgOsReturn: 0, avgIsSharpe: null, avgOsSharpe: null, avgOosRatio: 0, overfittingIndex: 1, windows }
  }
  const avgIsReturn = windows.reduce((s, w) => s + w.isReturn, 0) / windows.length
  const avgOsReturn = windows.reduce((s, w) => s + w.osReturn, 0) / windows.length
  const avgIsSharpe = windows.reduce((s, w) => s + (w.isSharpe ?? 0), 0) / windows.length
  const avgOsSharpe = windows.reduce((s, w) => s + (w.osSharpe ?? 0), 0) / windows.length
  const avgOosRatio = windows.reduce((s, w) => s + w.oosRatio, 0) / windows.length
  // overfittingIndex: 0 = IS ≈ OS, > 0.5 = suspicious overfitting
  const overfittingIndex = avgIsReturn > 0
    ? Math.max(0, Math.min(1, (avgIsReturn - avgOsReturn) / (Math.abs(avgIsReturn) + 0.001)))
    : 0

  return {
    avgIsReturn,
    avgOsReturn,
    avgIsSharpe: Number.isFinite(avgIsSharpe) ? avgIsSharpe : null,
    avgOsSharpe: Number.isFinite(avgOsSharpe) ? avgOsSharpe : null,
    avgOosRatio,
    overfittingIndex,
    windows,
  }
}
