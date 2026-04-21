import { classifyCreditCycle } from './creditCycle'
import { classifyFedPolicy } from './fedPolicy'
import { recessionProbabilityFromSpread } from './recessionProbability'
import { classifyYieldCurve } from './yieldCurve'

export type BusinessCyclePhase =
  | 'recovery'
  | 'expansion'
  | 'late_cycle'
  | 'slowdown'
  | 'contraction'
  | 'recession'

export type BusinessCycleState = {
  phase: BusinessCyclePhase
  confidence: number
  recessionProbability: number
  compositeScore: number
  sectorBias: { overweight: string[]; underweight: string[] }
}

export function computeBusinessCycleScore(inputs: {
  t10y2y: { date: string; value: number }[]
  t10y3m: { date: string; value: number }[]
  hyOas: { date: string; value: number }[]
  igOas: { date: string; value: number }[]
  unrate: { date: string; value: number }[]
  icsa: { date: string; value: number }[]
  fedFunds: { date: string; value: number }[]
}): BusinessCycleState {
  const yc = classifyYieldCurve(inputs.t10y2y, inputs.t10y3m)
  const cc = classifyCreditCycle(inputs.hyOas, inputs.igOas)
  const ff = classifyFedPolicy(inputs.fedFunds)
  const unrate = inputs.unrate[inputs.unrate.length - 1]?.value ?? 4
  const claims = inputs.icsa[inputs.icsa.length - 1]?.value ?? 250_000
  const rp = recessionProbabilityFromSpread(yc.latestSpread10y3m)

  const laborStress = Math.min(1, Math.max(0, (unrate - 4) / 3))
  const claimsStress = Math.min(1, Math.max(0, (claims - 250_000) / 250_000))
  const policyStress = ff.stance === 'aggressive' ? 0.8 : ff.stance === 'hiking' ? 0.5 : 0.2
  const inversionStress = yc.isInverted ? 0.9 : 0.2
  const compositeScore =
    inversionStress * 0.4 + cc.creditStressScore * 0.25 + laborStress * 0.15 + claimsStress * 0.1 + policyStress * 0.1

  let phase: BusinessCyclePhase = 'expansion'
  if (rp > 0.65 || compositeScore > 0.8) phase = 'recession'
  else if (compositeScore > 0.65) phase = 'contraction'
  else if (compositeScore > 0.52) phase = 'slowdown'
  else if (compositeScore > 0.42) phase = 'late_cycle'
  else if (compositeScore < 0.25) phase = 'recovery'

  const sectorBiasByPhase: Record<BusinessCyclePhase, { overweight: string[]; underweight: string[] }> = {
    recovery: { overweight: ['XLY', 'XLF', 'XLI'], underweight: ['XLU', 'XLP'] },
    expansion: { overweight: ['XLK', 'XLE', 'XLB'], underweight: ['XLU', 'XLV'] },
    late_cycle: { overweight: ['XLE', 'XLB', 'XLV'], underweight: ['XLF', 'XLY'] },
    slowdown: { overweight: ['XLV', 'XLP', 'XLU'], underweight: ['XLY', 'XLF'] },
    contraction: { overweight: ['XLV', 'XLP', 'XLU'], underweight: ['XLK', 'XLF'] },
    recession: { overweight: ['XLV', 'XLP', 'XLU'], underweight: ['XLK', 'XLF', 'XLY'] },
  }

  return {
    phase,
    confidence: Math.min(0.95, Math.max(0.4, 0.5 + Math.abs(compositeScore - 0.45))),
    recessionProbability: rp,
    compositeScore,
    sectorBias: sectorBiasByPhase[phase],
  }
}

