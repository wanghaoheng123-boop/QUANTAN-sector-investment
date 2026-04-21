export type YieldCurveState = {
  latestSpread10y2y: number | null
  latestSpread10y3m: number | null
  isInverted: boolean
  slopeLabel: 'steepening' | 'flat' | 'inverted'
}

export function classifyYieldCurve(
  t10y2y: { date: string; value: number }[],
  t10y3m: { date: string; value: number }[]
): YieldCurveState {
  const s2 = t10y2y[t10y2y.length - 1]?.value ?? null
  const s3 = t10y3m[t10y3m.length - 1]?.value ?? null
  const isInverted = (s2 ?? 1) < 0 || (s3 ?? 1) < 0
  let slopeLabel: YieldCurveState['slopeLabel'] = 'flat'
  const ref = s3 ?? s2
  if (ref != null) {
    if (ref < 0) slopeLabel = 'inverted'
    else if (ref > 1.2) slopeLabel = 'steepening'
  }
  return {
    latestSpread10y2y: s2,
    latestSpread10y3m: s3,
    isInverted,
    slopeLabel,
  }
}

