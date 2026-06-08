/**
 * Normalize Yahoo quote fields — regularMarketChangePercent is sometimes decimal (0.016) vs percent (1.6).
 *
 * Yahoo Finance occasionally returns the percent change in decimal form (e.g. 0.016 meaning 1.6%)
 * rather than percent form (1.6). A bare magnitude threshold misclassifies genuine small moves:
 * e.g. Yahoo returning 0.003 for a true 0.3% move would be shown as 0.003%.
 *
 * Strategy: when `regularMarketChange` and `regularMarketPrice` are both available we compute an
 * independent "implied" percent from first principles — (change / price) * 100.  We then pick
 * the candidate (raw or raw*100) whose absolute difference from `implied` is smaller.  This
 * handles small moves correctly without any magic threshold.
 *
 * We fall back to the magnitude heuristic only when price/change are unavailable.
 */

export function normalizedChangePercent(
  regularMarketChangePercent: number | undefined | null,
  regularMarketChange: number | undefined | null,
  regularMarketPrice: number | undefined | null
): number {
  const raw = regularMarketChangePercent

  if (
    regularMarketPrice != null && regularMarketPrice > 0 &&
    regularMarketChange != null && Number.isFinite(regularMarketChange)
  ) {
    // Independent ground-truth: (change / price) * 100 (always in percent units).
    const implied = (100 * regularMarketChange) / regularMarketPrice

    if (raw == null || !Number.isFinite(Number(raw))) return implied

    const r = Number(raw)

    // Pick whichever candidate — r (percent form) or r*100 (decimal form scaled up) —
    // is closer to the implied value. This correctly handles small moves that a bare
    // magnitude threshold would misclassify.
    const diffPercent = Math.abs(r - implied)
    const diffDecimal = Math.abs(r * 100 - implied)
    return diffDecimal < diffPercent ? r * 100 : r
  }

  // No price/change context — fall back to raw as-is (already in percent form most of the time).
  if (raw != null && Number.isFinite(Number(raw))) return Number(raw)
  return 0
}
