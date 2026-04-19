/**
 * Bounded walk-forward parameter search: score configs by OOS segment quality (Phase 5).
 */

import type { StrategyConfig } from '@/lib/strategy/strategyConfig'
import { mergeStrategyConfig, validateStrategyConfig } from '@/lib/strategy/strategyConfig'
import { toBacktestConfig } from '@/lib/strategy/strategyConfig'
import {
  walkForwardAnalysis,
  walkForwardSummary,
  type OhlcvRow,
  type WalkForwardSummary,
} from '@/lib/backtest/engine'
import type { GridAxis } from '@/lib/optimize/gridSearch'

export interface WalkForwardGridRow {
  params: Record<string, number>
  wf: WalkForwardSummary
  /** Primary score: higher is better (avg OOS annualized return). */
  scoreOosReturn: number
  overfittingIndex: number
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

export interface BoundedWfGridOptions {
  maxIterations?: number
  maxMs?: number
  trainDays?: number
  testDays?: number
}

/**
 * Same enumeration pattern as boundedGridSearch, but each variant is scored on walk-forward summary.
 */
export function boundedWalkForwardGridSearch(
  base: StrategyConfig,
  rows: OhlcvRow[],
  ticker: string,
  sector: string,
  axes: GridAxis[],
  opts: BoundedWfGridOptions = {},
): WalkForwardGridRow[] {
  const maxIterations = opts.maxIterations ?? 36
  const maxMs = opts.maxMs ?? 25_000
  const trainDays = opts.trainDays ?? 252
  const testDays = opts.testDays ?? 63
  const started = Date.now()
  const out: WalkForwardGridRow[] = []

  const totalCombos = axes.reduce((a, axis) => a * Math.max(axis.values.length, 1), 1)
  const n = Math.min(totalCombos, maxIterations)

  const wfCfg = (cfg: StrategyConfig) => toBacktestConfig(cfg)

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
    if (!validateStrategyConfig(merged).valid) continue
    if (rows.length < trainDays + testDays + 50) continue

    const wf = walkForwardSummary(
      walkForwardAnalysis(ticker, sector, rows, trainDays, testDays, wfCfg(merged)),
    )
    if (wf.windows.length === 0) continue

    out.push({
      params,
      wf,
      scoreOosReturn: wf.avgOsReturn,
      overfittingIndex: wf.overfittingIndex,
    })
  }

  return out.sort((a, b) => b.scoreOosReturn - a.scoreOosReturn)
}
