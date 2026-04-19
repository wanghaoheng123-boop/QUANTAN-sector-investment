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
  return result.quotes.map((q) => ({
    time: (q as { timestamp?: number }).timestamp ?? 0,
    open: (q as { open?: number }).open ?? 0,
    high: (q as { high?: number }).high ?? 0,
    low: (q as { low?: number }).low ?? 0,
    close: (q as { close?: number }).close ?? 0,
    volume: (q as { volume?: number }).volume ?? 0,
  }))
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
    }
  }

  const results = boundedGridSearch(base, rows, p.ticker, p.sector, p.axes, {
    maxIterations: p.maxIterations,
    maxMs: p.maxMs,
  })
  const pareto = paretoFilter(results)
  const pareto3 = paretoFilter3Objectives(results)

  return {
    ticker: p.ticker,
    sector: p.sector,
    lookbackDays: p.lookbackDays,
    bars: rows.length,
    objective: 'full',
    iterationsRun: results.length,
    results: results.sort((a, b) => (b.calmar ?? -1e9) - (a.calmar ?? -1e9)).slice(0, 32),
    pareto: pareto.sort((a, b) => (b.calmar ?? -1e9) - (a.calmar ?? -1e9)),
    pareto3: pareto3.sort((a, b) => (b.calmar ?? -1e9) - (a.calmar ?? -1e9)).slice(0, 24),
    firstBar: rows[0]?.time,
    lastBar: rows[rows.length - 1]?.time,
  }
}
