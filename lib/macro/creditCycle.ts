export type CreditCycleState = {
  hyOas: number | null
  igOas: number | null
  creditStressScore: number
  regime: 'benign' | 'watch' | 'stress'
}

export function classifyCreditCycle(
  hySeries: { date: string; value: number }[],
  igSeries: { date: string; value: number }[]
): CreditCycleState {
  const hy = hySeries[hySeries.length - 1]?.value ?? null
  const ig = igSeries[igSeries.length - 1]?.value ?? null
  const hyScore = hy == null ? 0 : Math.min(1, Math.max(0, (hy - 3) / 7))
  const igScore = ig == null ? 0 : Math.min(1, Math.max(0, (ig - 1) / 4))
  const creditStressScore = hyScore * 0.7 + igScore * 0.3
  let regime: CreditCycleState['regime'] = 'benign'
  if (creditStressScore > 0.7) regime = 'stress'
  else if (creditStressScore > 0.4) regime = 'watch'
  return { hyOas: hy, igOas: ig, creditStressScore, regime }
}

