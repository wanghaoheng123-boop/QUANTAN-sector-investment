/**
 * Lightweight Estrella-Mishkin style proxy using 10Y-3M spread.
 * Output is 0..1 probability proxy (not a calibrated NY Fed clone).
 */
export function recessionProbabilityFromSpread(spread10y3m: number | null): number {
  if (spread10y3m == null || !Number.isFinite(spread10y3m)) return 0
  const z = -1.3 - 1.5 * spread10y3m
  return 1 / (1 + Math.exp(-z))
}

