/**
 * Bounded parameter search for StrategyConfig — serverless-safe caps.
 */

import type { StrategyConfig } from '@/lib/strategy/strategyConfig'
import { mergeStrategyConfig, validateStrategyConfig } from '@/lib/strategy/strategyConfig'
import { toBacktestConfig } from '@/lib/strategy/strategyConfig'
import { backtestInstrument } from '@/lib/backtest/engine'
import type { OhlcvRow } from '@/lib/backtest/engine'

export interface GridAxis {
  /** Dot path under StrategyConfig, e.g. `regime.smaPeriod` */
  path: string
  values: number[]
}

export interface GridSearchRow {
  params: Record<string, number>
  totalReturn: number
  sharpe: number | null
  sortino: number | null
  maxDrawdown: number
  calmar: number | null
  trades: number
  /** Trades per bar — rough turnover proxy for comparison only. */
  turnoverProxy: number
}

function setPath(obj: Record<string, unknown>, path: string, value: number): void {
  const parts = path.split('.')
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (!(k in cur) || typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

function calmar(totalReturn: number, maxDd: number): number | null {
  if (!Number.isFinite(totalReturn) || maxDd <= 1e-8) return null
  return totalReturn / maxDd
}

export interface BoundedGridSearchOptions {
  maxIterations?: number
  maxMs?: number
}

/**
 * Cartesian product over axes with hard caps on iterations and wall time.
 * Each variant is validated; invalid configs are skipped.
 */
export function boundedGridSearch(
  base: StrategyConfig,
  rows: OhlcvRow[],
  ticker: string,
  sector: string,
  axes: GridAxis[],
  opts: BoundedGridSearchOptions = {},
): GridSearchRow[] {
  const maxIterations = opts.maxIterations ?? 48
  const maxMs = opts.maxMs ?? 20_000
  const started = Date.now()
  const out: GridSearchRow[] = []

  const totalCombos = axes.reduce((a, axis) => a * Math.max(axis.values.length, 1), 1)
  const n = Math.min(totalCombos, maxIterations)

  for (let flat = 0; flat < n; flat++) {
    if (Date.now() - started > maxMs) break
    const params: Record<string, number> = {}
    const variant: Record<string, unknown> = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
    let rem = flat
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i]
      const L = Math.max(axis.values.length, 1)
      const j = rem % L
      rem = Math.floor(rem / L)
      const vi = axis.values[j]
      params[axis.path] = vi
      setPath(variant, axis.path, vi)
    }

    const merged = mergeStrategyConfig(variant as Partial<StrategyConfig>)
    const v = validateStrategyConfig(merged)
    if (!v.valid) continue

    const bt = toBacktestConfig(merged)
    const r = backtestInstrument(ticker, sector, rows, bt)
    out.push({
      params,
      totalReturn: r.totalReturn,
      sharpe: r.sharpeRatio,
      sortino: r.sortinoRatio,
      maxDrawdown: r.maxDrawdown,
      calmar: calmar(r.totalReturn, r.maxDrawdown),
      trades: r.totalTrades,
      turnoverProxy: r.totalTrades / Math.max(rows.length, 1),
    })
  }

  return out
}

/** Non-dominated rows for (Calmar ↑, maxDrawdown ↓). */
export function paretoFilter(rows: GridSearchRow[]): GridSearchRow[] {
  return rows.filter(
    a => !rows.some(
      b =>
        b !== a &&
        (b.calmar ?? -1e9) >= (a.calmar ?? -1e9) &&
        b.maxDrawdown <= a.maxDrawdown &&
        ((b.calmar ?? -1e9) > (a.calmar ?? -1e9) || b.maxDrawdown < a.maxDrawdown),
    ),
  )
}

/** 3-objective Pareto: maximize return & Sortino, minimize max drawdown. */
export function paretoFilter3Objectives(rows: GridSearchRow[]): GridSearchRow[] {
  return rows.filter(
    a =>
      !rows.some(b => {
        if (b === a) return false
        const btRet = b.totalReturn >= a.totalReturn
        const btSort = (b.sortino ?? -1e9) >= (a.sortino ?? -1e9)
        const btDd = b.maxDrawdown <= a.maxDrawdown
        const strict =
          b.totalReturn > a.totalReturn ||
          (b.sortino ?? -1e9) > (a.sortino ?? -1e9) ||
          b.maxDrawdown < a.maxDrawdown
        return btRet && btSort && btDd && strict
      }),
  )
}
