import type { BacktestResult, WalkForwardSummary } from '@/lib/backtest/engine'
import { accumulationScore } from '@/lib/alpha/accumulationProxies'
import { regimeScore, sectorPersistenceScore } from '@/lib/alpha/rankingRegimeFeatures'

export interface LiveMicrostructureSnapshot {
  rsi14?: number | null
  macdHist?: number | null
  atrPct?: number | null
  deviationPct?: number | null
  changePct?: number | null
}

export interface InstitutionalRankingInput {
  result: BacktestResult
  walkForward?: WalkForwardSummary | null
  live?: LiveMicrostructureSnapshot
}

export interface InstitutionalRankingRow {
  ticker: string
  sector: string
  rankScore: number
  expectedReturnScore: number
  riskControlScore: number
  robustnessScore: number
  timingScore: number
  regimeScore: number
  persistenceScore: number
  accumulationScore: number
  conviction: 'A' | 'B' | 'C'
  thesis: string
  actionBias: 'accumulate' | 'watch' | 'avoid'
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function scaleRange(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x) || hi <= lo) return 0
  return clamp01((x - lo) / (hi - lo))
}

function deriveTimingScore(live?: LiveMicrostructureSnapshot): number {
  if (!live) return 0.5
  const rsi = live.rsi14
  const dev = live.deviationPct
  const macdHist = live.macdHist
  const atrPct = live.atrPct
  const dayMove = live.changePct

  // Early-entry bias: mild dip into trend + positive momentum turn + controlled volatility.
  const dip = rsi == null ? 0.5 : clamp01((62 - rsi) / 24)
  const nearTrend = dev == null ? 0.5 : clamp01((3 - Math.abs(dev)) / 3)
  const momentumTurn = macdHist == null ? 0.5 : macdHist > 0 ? 0.7 : 0.35
  const volControl = atrPct == null ? 0.5 : clamp01((8 - atrPct) / 8)
  const chasePenalty = dayMove == null ? 0 : dayMove > 2.5 ? 0.15 : 0

  return clamp01(0.28 * dip + 0.26 * nearTrend + 0.24 * momentumTurn + 0.22 * volControl - chasePenalty)
}

function convictionFromScore(score: number, hasWalkForward: boolean): 'A' | 'B' | 'C' {
  // Conviction A requires OOS evidence — without walk-forward, cap at B regardless of IS score
  if (score >= 0.72 && hasWalkForward) return 'A'
  if (score >= 0.56) return 'B'
  return 'C'
}

function actionFromScore(score: number): 'accumulate' | 'watch' | 'avoid' {
  if (score >= 0.68) return 'accumulate'
  if (score >= 0.52) return 'watch'
  return 'avoid'
}

export function buildInstitutionalRanking(inputs: InstitutionalRankingInput[]): InstitutionalRankingRow[] {
  const sectorToReturns = new Map<string, number[]>()
  for (const { result } of inputs) {
    const arr = sectorToReturns.get(result.sector) ?? []
    arr.push(result.annualizedReturn)
    sectorToReturns.set(result.sector, arr)
  }

  const rows = inputs.map(({ result, walkForward, live }) => {
    const expectedReturnScore = clamp01(
      0.65 * scaleRange(result.annualizedReturn, -0.03, 0.25) +
      0.35 * scaleRange(result.excessReturn, -0.05, 0.2),
    )

    const riskControlScore = clamp01(
      0.55 * (1 - scaleRange(result.maxDrawdown, 0.08, 0.5)) +
      0.2 * scaleRange(result.winRate, 0.35, 0.75) +
      0.25 * scaleRange(result.profitFactor === Infinity ? 3 : result.profitFactor, 0.8, 2.5),
    )

    const hasWalkForward = walkForward != null && walkForward.windows.length > 0
    const oosReturn = walkForward?.avgOsReturn ?? 0
    const oosRatio = walkForward?.avgOosRatio ?? 0
    const overfit = walkForward?.overfittingIndex ?? 1
    const robustnessScore = hasWalkForward
      ? clamp01(
          0.5 * scaleRange(oosReturn, -0.03, 0.18) +
          0.25 * scaleRange(oosRatio, 0.25, 1) +
          0.25 * (1 - scaleRange(overfit, 0.25, 0.9)),
        )
      : 0  // no walk-forward data → robustness unknown; do not falsely score 0.5

    const timingScore = deriveTimingScore(live)
    const regime = regimeScore({
      annualizedReturn: result.annualizedReturn,
      maxDrawdown: result.maxDrawdown,
      sharpeRatio: result.sharpeRatio,
      sortinoRatio: result.sortinoRatio,
      winRate: result.winRate,
    })
    const sectorSeries = (sectorToReturns.get(result.sector) ?? []).slice(0, 8)
    const persistence = sectorPersistenceScore(sectorSeries)
    const accumulation = accumulationScore({
      atrPct: live?.atrPct,
      macdHist: live?.macdHist,
      rsi14: live?.rsi14,
      changePct: live?.changePct,
    })

    // Profit-first weights. When walk-forward is unavailable, robustness weight (0.20)
    // is redistributed to expectedReturn (+0.12) and riskControl (+0.08) so rankings
    // remain meaningful rather than being penalised for missing data.
    const wExpected   = hasWalkForward ? 0.34 : 0.46
    const wRiskCtrl   = hasWalkForward ? 0.18 : 0.26
    const wRobustness = hasWalkForward ? 0.20 : 0.00
    const rankScore = clamp01(
      wExpected   * expectedReturnScore +
      wRiskCtrl   * riskControlScore +
      wRobustness * robustnessScore +
      0.1 * timingScore +
      0.08 * regime +
      0.05 * persistence +
      0.05 * accumulation,
    )

    const conviction = convictionFromScore(rankScore, hasWalkForward)
    const actionBias = actionFromScore(rankScore)
    const thesis =
      actionBias === 'accumulate'
        ? 'Return + OOS robustness lead while drawdown remains controlled.'
        : actionBias === 'watch'
          ? 'Mixed quality: wait for cleaner timing or stronger OOS confirmation.'
          : 'Weak return-quality or unstable OOS behavior versus risk.'

    return {
      ticker: result.ticker,
      sector: result.sector,
      rankScore,
      expectedReturnScore,
      riskControlScore,
      robustnessScore,
      timingScore,
      regimeScore: regime,
      persistenceScore: persistence,
      accumulationScore: accumulation,
      conviction,
      thesis,
      actionBias,
    }
  })

  return rows.sort((a, b) => b.rankScore - a.rankScore)
}
