/**
 * Volatility-adaptive fair-value bands. Not a recommendation — a transparent mechanical overlay.
 */

export interface BandInputs {
  currentPrice: number
  /** Candidate anchors; nulls dropped before median. */
  anchors: (number | null | undefined)[]
  /** Annualized volatility of log returns, e.g. 0.25 = 25%. */
  annualizedVol: number
  /** Base margin of safety before vol adjustment. */
  baseMargin?: number
}

export interface PriceBands {
  fairValueMid: number | null
  buyZoneHigh: number | null
  sellZoneLow: number | null
  methodology: string
}

export function computeAdaptiveBands(i: BandInputs): PriceBands {
  const anchors = i.anchors.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
  const vol = Math.max(0.05, Math.min(0.8, i.annualizedVol || 0.2))
  const baseM = i.baseMargin ?? 0.08

  if (anchors.length === 0 || !Number.isFinite(i.currentPrice) || i.currentPrice <= 0) {
    return {
      fairValueMid: null,
      buyZoneHigh: null,
      sellZoneLow: null,
      methodology: 'Insufficient anchors to compute a composite fair value.',
    }
  }

  const sorted = [...anchors].sort((a, b) => a - b)
  const mid =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) >> 1]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2

  const m = baseM + Math.min(0.12, vol * 0.6)
  const buyZoneHigh = mid * (1 - m)
  // Sell-zone offset above mid: 0.5*m + 0.35*vol (cached for honest reporting).
  const sellOffset = 0.5 * m + 0.35 * vol
  const sellZoneLow = mid * (1 + sellOffset)

  return {
    fairValueMid: mid,
    buyZoneHigh,
    sellZoneLow,
    // Methodology string previously claimed "buy zone X%-(X+12)%" of fair
    // value, which conflated the *actual* margin (m) with the dynamic
    // range of m as vol varies. The +0.12 was already INSIDE m via
    // Math.min(0.12, vol*0.6), so adding it again was double-counting
    // and gave users an inaccurate display of the buy-zone discount.
    methodology:
      `Composite fair value = median of ${anchors.length} anchor(s) (DCF / analyst target / forward-earnings heuristic). ` +
      `Margin of safety scales with annualized vol (~${(vol * 100).toFixed(1)}%) over a ${(baseM * 100).toFixed(0)}%–${((baseM + 0.12) * 100).toFixed(0)}% range: ` +
      `buy zone at ${(m * 100).toFixed(1)}% below fair value; ` +
      `sell zone at ${(sellOffset * 100).toFixed(1)}% above fair value (asymmetric vol-adjusted extension).`,
  }
}
