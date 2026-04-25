import YahooFinance from 'yahoo-finance2'
import type { OhlcvRow } from '@/lib/backtest/engine'
import { mergeStrategyConfig, validateStrategyConfig, type StrategyConfig } from '@/lib/strategy/strategyConfig'
import {
  boundedGridSearch,
  paretoFilter,
  paretoFilter3Objectives,
  type GridAxis,
} from '@/lib/optimize/gridSearch'
import { boundedWalkForwardGridSearch, type WalkForwardGridRow } from '@/lib/optimize/walkForwardGrid'

const yahooFinance = new YahooFinance()

export async function fetchYahooDailyForOptimize(ticker: string, lookbackDays: number): Promise<OhlcvRow[]> {
  const end = new Date()
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
  const result = await yahooFinance.chart(ticker, {
    period1: Math.floor(start.getTime() / 1000),
    period2: Math.floor(end.getTime() / 1000),
    interval: '1d',
  })
  if (!result?.quotes || result.quotes.length === 0) return []
  // FIX (2026-04-25): yahoo-finance2 chart() returns `date` (Date), not `timestamp`.
  // Previous code read `q.timestamp` which was always undefined → every row had time=0.
  return result.quotes.map((q) => {
    const dateField = (q as { date?: Date | string }).date
    const ts = dateField ? Math.floor(new Date(dateField).getTime() / 1000) : 0
    return {
      time: ts,
      open: (q as { open?: number }).open ?? 0,
      high: (q as { high?: number }).high ?? 0,
      low: (q as { low?: number }).low ?? 0,
      close: (q as { close?: number }).close ?? 0,
      volume: (q as { volume?: number }).volume ?? 0,
    }
  }).filter(r => r.time > 0 && r.close > 0)
}

export interface OptimizeExecutionParams {
  ticker: string
  sector: string
  partial: Partial<StrategyConfig>
  axes: GridAxis[]
  lookbackDays: number
  maxIterations: number
  maxMs: number
  objective: 'full' | 'walk_forward'
}

export interface OptimizerTopConfig {
  rank: number
  params: Record<string, number>
  /** For walk_forward objective: avg OOS annualised return. For full: Calmar ratio. */
  primaryScore: number
  oosReturn?: number
  overfittingIndex?: number
  calmar?: number
  sharpe?: number | null
  windows?: number
}

export interface OptimizerReport {
  runAt: string
  ticker: string
  sector: string
  objective: 'full' | 'walk_forward'
  totalCandidates: number
  topConfigs: OptimizerTopConfig[]
}

export interface OptimizeExecutionResult {
  ticker: string
  sector: string
  lookbackDays: number
  bars: number
  objective: 'full' | 'walk_forward'
  iterationsRun: number
  results?: ReturnType<typeof boundedGridSearch>
  pareto?: ReturnType<typeof boundedGridSearch>
  pareto3?: ReturnType<typeof boundedGridSearch>
  walkForwardRows?: WalkForwardGridRow[]
  paretoWf?: WalkForwardGridRow[]
  firstBar?: number
  lastBar?: number
  /** Phase E1: structured top-3 summary for display in the UI optimizer tab. */
  report?: OptimizerReport
}

export async function executeBoundedOptimize(p: OptimizeExecutionParams): Promise<OptimizeExecutionResult> {
  const rows = await fetchYahooDailyForOptimize(p.ticker, p.lookbackDays)
  if (rows.length < 200) {
    throw new Error('Insufficient OHLCV history for this ticker')
  }

  const base = mergeStrategyConfig(p.partial)
  const validation = validateStrategyConfig(base)
  if (!validation.valid) {
    throw new Error('Invalid base config')
  }

  const runAt = new Date().toISOString()

  if (p.objective === 'walk_forward') {
    const wfRows = boundedWalkForwardGridSearch(base, rows, p.ticker, p.sector, p.axes, {
      maxIterations: p.maxIterations,
      maxMs: p.maxMs,
    })
    const paretoWf = wfRows.filter(
      a =>
        !wfRows.some(
          b =>
            b !== a &&
            b.scoreOosReturn >= a.scoreOosReturn &&
            b.overfittingIndex <= a.overfittingIndex &&
            (b.scoreOosReturn > a.scoreOosReturn || b.overfittingIndex < a.overfittingIndex),
        ),
    )
    const top3Wf: OptimizerTopConfig[] = wfRows.slice(0, 3).map((r, i) => ({
      rank: i + 1,
      params: r.params,
      primaryScore: r.scoreOosReturn,
      oosReturn: r.scoreOosReturn,
      overfittingIndex: r.overfittingIndex,
      windows: r.wf.windows.length,
    }))
    const report: OptimizerReport = {
      runAt,
      ticker: p.ticker,
      sector: p.sector,
      objective: 'walk_forward',
      totalCandidates: wfRows.length,
      topConfigs: top3Wf,
    }
    return {
      ticker: p.ticker,
      sector: p.sector,
      lookbackDays: p.lookbackDays,
      bars: rows.length,
      objective: 'walk_forward',
      iterationsRun: wfRows.length,
      walkForwardRows: wfRows.slice(0, 48),
      paretoWf: paretoWf.slice(0, 24),
      firstBar: rows[0]?.time,
      lastBar: rows[rows.length - 1]?.time,
      report,
    }
  }

  const results = boundedGridSearch(base, rows, p.ticker, p.sector, p.axes, {
    maxIterations: p.maxIterations,
    maxMs: p.maxMs,
  })
  const pareto = paretoFilter(results)
  const pareto3 = paretoFilter3Objectives(results)
  const sortedFull = results.sort((a, b) => (b.calmar ?? -1e9) - (a.calmar ?? -1e9))
  const top3Full: OptimizerTopConfig[] = sortedFull.slice(0, 3).map((r, i) => ({
    rank: i + 1,
    params: r.params,
    primaryScore: r.calmar ?? 0,
    calmar: r.calmar ?? undefined,
    sharpe: r.sharpe ?? undefined,
  }))
  const report: OptimizerReport = {
    runAt,
    ticker: p.ticker,
    sector: p.sector,
    objective: 'full',
    totalCandidates: results.length,
    topConfigs: top3Full,
  }

  return {
    ticker: p.ticker,
    sector: p.sector,
    lookbackDays: p.lookbackDays,
    bars: rows.length,
    objective: 'full',
    iterationsRun: results.length,
    results: sortedFull.slice(0, 32),
    pareto: pareto.sort((a, b) => (b.calmar ?? -1e9) - (a.calmar ?? -1e9)),
    pareto3: pareto3.sort((a, b) => (b.calmar ?? -1e9) - (a.calmar ?? -1e9)).slice(0, 24),
    firstBar: rows[0]?.time,
    lastBar: rows[rows.length - 1]?.time,
    report,
  }
}
