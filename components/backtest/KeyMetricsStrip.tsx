'use client'

/**
 * KeyMetricsStrip — 6-card portfolio summary row for the backtest page.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx. Pure
 * presentational; composes `BacktestMetricCard`. Computes the displayed
 * Sharpe heuristic inline so the caller only passes the portfolio object.
 */

import { BacktestMetricCard } from './BacktestMetricCard'
import { formatPercent } from '@/lib/format'

interface PortfolioSummary {
  avgReturn: number
  avgAnnReturn: number
  bnhAvg: number
  alpha: number
  maxPortfolioDd: number
  winRate: number
  totalTrades: number
}

interface KeyMetricsStripProps {
  portfolio: PortfolioSummary
  instrumentCount: number
}

function fmtPct(v: number, sign = true): string {
  return formatPercent(v, 2, sign)
}

function fmtRatio(v: number | null): string {
  return v == null ? '—' : v === Infinity ? '∞' : v.toFixed(2)
}

export function KeyMetricsStrip({ portfolio, instrumentCount }: KeyMetricsStripProps) {
  // annualised return / max drawdown — a MAR (Calmar) ratio, NOT a Sharpe.
  // It was labelled "Sharpe Ratio" in the UI while the comment here admitted it
  // was not one (Q-079, Q-103). The label now matches the arithmetic.
  //
  // The `> 0` guard on the return was removed deliberately. It made the negative
  // branch UNREACHABLE, so a LOSING portfolio rendered an em dash instead of a
  // negative ratio — the worst outcome silently displayed as "no data". Only the
  // drawdown denominator needs guarding.
  const displayedMar =
    portfolio.maxPortfolioDd > 0
      ? portfolio.avgAnnReturn / (portfolio.maxPortfolioDd || 1)
      : null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <BacktestMetricCard
        label="Portfolio Return"
        value={fmtPct(portfolio.avgReturn)}
        sub={`Ann: ${fmtPct(portfolio.avgAnnReturn)}`}
        color={portfolio.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}
      />
      <BacktestMetricCard
        // NOT "Alpha": this is the raw arithmetic difference
        // (`truePortfolioReturn - bnhAvg`, engine.ts:213), carrying no
        // risk adjustment and no significance test. Naming it alpha asserts
        // skill the measurement does not establish — see CLAUDE.md I5.
        label="Excess vs B&H"
        value={fmtPct(portfolio.alpha)}
        // F-2 (2026-07-06): B&H is measured over the SAME end-aligned common
        // window as the portfolio return — say so, since the number moved.
        sub={`B&H avg (matched window): ${fmtPct(portfolio.bnhAvg)}`}
        color={portfolio.alpha > 0 ? 'text-cyan-400' : 'text-orange-400'}
      />
      <BacktestMetricCard
        label="Return / Max DD"
        value={fmtRatio(displayedMar)}
        sub="Ann. return ÷ max drawdown"
        // Color the Sharpe card by the displayed Sharpe value, not alpha.
        // Pre-fix the card was painted by `portfolio.alpha > 0` which made
        // a strong Sharpe + weak alpha portfolio look grey/bad and the
        // reverse case look cyan/good — visual-label mismatch.
        color={displayedMar == null ? 'text-slate-400' : displayedMar >= 1 ? 'text-cyan-400' : displayedMar >= 0 ? 'text-amber-400' : 'text-red-400'}
      />
      <BacktestMetricCard
        label="Max Drawdown"
        // `Math.abs` is defensive — `lib/backtest/engine.ts` currently
        // stores `maxPortfolioDd` as a positive magnitude, so the hard-
        // coded `-` prefix produces the right output today. If the engine
        // ever switches to signed-drawdown convention, the cell would
        // otherwise render `--25.0%`. Math.abs makes us convention-agnostic.
        value={`-${(Math.abs(portfolio.maxPortfolioDd) * 100).toFixed(1)}%`}
        sub="Portfolio peak-to-trough"
        color="text-red-400"
      />
      <BacktestMetricCard
        label="Win Rate"
        value={`${(portfolio.winRate * 100).toFixed(1)}%`}
        sub={`${portfolio.totalTrades} total trades`}
        color={portfolio.winRate > 0.5 ? 'text-emerald-400' : 'text-slate-400'}
      />
      <BacktestMetricCard
        label="Instruments"
        value={String(instrumentCount)}
        sub="Active in backtest"
        color="text-slate-300"
      />
    </div>
  )
}
