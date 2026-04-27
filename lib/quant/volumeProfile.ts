/**
 * Volume Profile Analysis — compute Point of Control (POC) and Value Area
 * from OHLCV bars.
 *
 * POC = price level with the highest traded volume.
 * Value Area = smallest price range containing >= 70% of total volume.
 */

import type { OhlcvBar } from '@/lib/quant/indicators'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProfileBin {
  price: number   // midpoint of the bin
  volume: number  // total volume attributed to this bin
}

export interface VolumeProfileResult {
  poc: number              // Point of Control price
  valueAreaHigh: number    // top of 70% value area
  valueAreaLow: number     // bottom of 70% value area
  profileBins: ProfileBin[]
}

export type PriceZone = 'above_va' | 'in_va' | 'below_va' | 'at_poc'

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Compute volume profile from OHLCV bars.
 *
 * @param bars - OHLCV bars (uses last `lookback` bars)
 * @param numBins - Number of price bins (default 50)
 * @param lookback - Number of recent bars to use (default 50)
 */
export function volumeProfile(
  bars: OhlcvBar[],
  numBins = 50,
  lookback = 50,
): VolumeProfileResult | null {
  const slice = bars.slice(-Math.min(lookback, bars.length))
  if (slice.length < 5) return null

  // Find price range
  let minPrice = Infinity
  let maxPrice = -Infinity
  for (const b of slice) {
    if (b.low < minPrice) minPrice = b.low
    if (b.high > maxPrice) maxPrice = b.high
  }
  if (maxPrice <= minPrice || !Number.isFinite(minPrice)) return null

  const range = maxPrice - minPrice
  const binSize = range / numBins
  const bins: ProfileBin[] = []
  for (let i = 0; i < numBins; i++) {
    bins.push({
      price: minPrice + (i + 0.5) * binSize,
      volume: 0,
    })
  }

  // Distribute volume across bins
  // For each bar, spread its volume across bins that overlap [low, high]
  for (const bar of slice) {
    const lowBin = Math.max(0, Math.floor((bar.low - minPrice) / binSize))
    const highBin = Math.min(numBins - 1, Math.floor((bar.high - minPrice) / binSize))
    const numOverlap = highBin - lowBin + 1
    const volPerBin = bar.volume / Math.max(1, numOverlap)
    for (let i = lowBin; i <= highBin; i++) {
      bins[i].volume += volPerBin
    }
  }

  // Find POC (bin with max volume)
  let pocIdx = 0
  let maxVol = 0
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].volume > maxVol) {
      maxVol = bins[i].volume
      pocIdx = i
    }
  }

  // Value Area: expand from POC until >= 70% of total volume
  const totalVol = bins.reduce((s, b) => s + b.volume, 0)
  const targetVol = totalVol * 0.70

  let vaLow = pocIdx
  let vaHigh = pocIdx
  let vaVol = bins[pocIdx].volume

  while (vaVol < targetVol && (vaLow > 0 || vaHigh < bins.length - 1)) {
    const expandLow = vaLow > 0 ? bins[vaLow - 1].volume : -1
    const expandHigh = vaHigh < bins.length - 1 ? bins[vaHigh + 1].volume : -1

    if (expandLow >= expandHigh) {
      vaLow--
      vaVol += bins[vaLow].volume
    } else {
      vaHigh++
      vaVol += bins[vaHigh].volume
    }
  }

  return {
    poc: bins[pocIdx].price,
    valueAreaHigh: bins[vaHigh].price + binSize / 2,
    valueAreaLow: bins[vaLow].price - binSize / 2,
    profileBins: bins,
  }
}

/**
 * Classify current price relative to the volume profile value area.
 */
export function priceRelativeToPOC(
  price: number,
  profile: VolumeProfileResult,
): PriceZone {
  const pocTolerance = (profile.valueAreaHigh - profile.valueAreaLow) * 0.05
  if (Math.abs(price - profile.poc) <= pocTolerance) return 'at_poc'
  if (price > profile.valueAreaHigh) return 'above_va'
  if (price < profile.valueAreaLow) return 'below_va'
  return 'in_va'
}
