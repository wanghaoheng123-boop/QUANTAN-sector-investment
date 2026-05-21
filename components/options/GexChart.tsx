'use client'

import type { GexResult } from '@/lib/options/gex'
import { MetricTooltip } from '@/components/MetricTooltip'

interface Props {
  gex: GexResult
  spot: number
}

function fmtGex(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toFixed(0)
}

export default function GexChart({ gex, spot }: Props) {
  const { strikeGex, totalGex, flipPoint } = gex
  if (strikeGex.length === 0) {
    return <p className="text-xs text-gray-500">No GEX data available.</p>
  }

  // Phase 14 wave 40: graceful fallback when every strike has zero GEX.
  // Pre-wave-40 the chain.ts picker selected the front-month even when it
  // was expiring today; every contract's gamma was zero (correct at T=0)
  // and totalGex collapsed to 0. Even after the picker fix in chain.ts,
  // illiquid symbols (mid-cap stocks with thin options) can still produce
  // all-zero GEX if the picked expiration has zero open interest. Surface
  // that explicitly rather than rendering an empty chart of zero-width
  // bars that look indistinguishable from "data is loading".
  const nonZeroStrikes = strikeGex.filter((s) => s.gex !== 0).length
  if (nonZeroStrikes === 0 || totalGex === 0) {
    return (
      <div className="space-y-1 py-2">
        <p className="text-xs text-gray-400">
          No gamma exposure to chart — the picked expiration has{' '}
          {strikeGex.length > 0 ? 'no open interest with measurable gamma' : 'no contracts'}.
        </p>
        <p className="text-[10px] text-gray-500">
          This is common at expiration day for the front-month, or on illiquid mid-cap symbols.
        </p>
      </div>
    )
  }

  // Phase 14 wave 41 (UX-F5): replace spread-based `Math.max(...)` with a
  // reducer. Two reasons:
  //   1. `Math.max(...veryLargeArray)` blows the JS call-stack at ~100k args.
  //      Deep chains for index symbols (SPX/SPY) can approach this scale.
  //   2. The spread evaluates Math.abs(NaN) → NaN, and Math.max(NaN, x) → NaN
  //      for any x. A single non-finite strike GEX would yield maxAbs=NaN
  //      and every subsequent bar width = NaN.
  const maxAbs = strikeGex.reduce(
    (m, s) => (Number.isFinite(s.gex) && Math.abs(s.gex) > m ? Math.abs(s.gex) : m),
    1,
  )
  const BAR_HEIGHT = 18
  const BAR_MAX_WIDTH = 180
  const chartHeight = strikeGex.length * (BAR_HEIGHT + 2)

  // Find range for strike axis annotation
  const allStrikes = strikeGex.map((s) => s.strike)
  const minStrike = Math.min(...allStrikes)
  const maxStrike = Math.max(...allStrikes)
  const strikeRange = maxStrike - minStrike || 1

  return (
    <div className="space-y-2">
      {/* Summary row */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gray-400 inline-flex items-center">
          Total GEX:<MetricTooltip metricKey="gex" compact />
        </span>
        <span className={totalGex >= 0 ? 'text-emerald-400' : 'text-red-400'}>
          {totalGex >= 0 ? '+' : ''}{fmtGex(totalGex)}
        </span>
        {/* Phase 14 wave 41 (UX-F4): finite-guard every .toFixed. flipPoint
            and spot are both nominally `number` but can arrive as NaN from
            halted symbols or degenerate compute. The prior unconditional
            `.toFixed` crashed the chart. */}
        {flipPoint != null && Number.isFinite(flipPoint) && (
          <>
            <span className="text-gray-400 inline-flex items-center">
              Flip:<MetricTooltip metricKey="gammaFlip" compact />
            </span>
            <span className="text-yellow-400">${flipPoint.toFixed(2)}</span>
          </>
        )}
        <span className="text-gray-400">Spot:</span>
        <span className="text-gray-300">
          {Number.isFinite(spot) && spot > 0 ? `$${spot.toFixed(2)}` : '—'}
        </span>
      </div>

      {/* Bar chart — F6.2 (Phase 13 S2): chart text alternative for screen readers (WCAG 1.1.1). */}
      <div className="overflow-y-auto max-h-96">
        <svg
          width={BAR_MAX_WIDTH * 2 + 80}
          height={chartHeight}
          className="font-mono"
          role="img"
          aria-label={
            `Gamma exposure by strike — ${strikeGex.length} strikes from ${minStrike} to ${maxStrike}, ` +
            `total GEX ${fmtGex(totalGex)}` +
            (flipPoint != null && Number.isFinite(flipPoint) ? `, gamma flip at ${flipPoint.toFixed(2)}` : '') +
            (Number.isFinite(spot) && spot > 0 ? `. Spot ${spot.toFixed(2)}.` : '.')
          }
        >
          {strikeGex.map((item, i) => {
            const y = i * (BAR_HEIGHT + 2)
            const barWidth = (Math.abs(item.gex) / maxAbs) * BAR_MAX_WIDTH
            const isPositive = item.gex >= 0
            const x = isPositive ? BAR_MAX_WIDTH : BAR_MAX_WIDTH - barWidth

            // Spot marker line
            const spotNorm = (item.strike - minStrike) / strikeRange
            const isNearSpot = Math.abs(item.strike - spot) < (maxStrike - minStrike) / strikeGex.length / 2

            return (
              <g key={item.strike}>
                {/* Strike label */}
                <text
                  x={BAR_MAX_WIDTH - 4}
                  y={y + BAR_HEIGHT * 0.75}
                  textAnchor="end"
                  fontSize={10}
                  fill={isNearSpot ? '#a78bfa' : '#6b7280'}
                >
                  {item.strike}
                </text>

                {/* GEX bar */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={BAR_HEIGHT}
                  fill={isPositive ? '#10b981' : '#ef4444'}
                  opacity={0.8}
                  rx={2}
                />

                {/* GEX value */}
                {barWidth > 20 && (
                  <text
                    x={isPositive ? x + barWidth - 3 : x + 3}
                    y={y + BAR_HEIGHT * 0.75}
                    textAnchor={isPositive ? 'end' : 'start'}
                    fontSize={9}
                    fill="white"
                    opacity={0.9}
                  >
                    {fmtGex(item.gex)}
                  </text>
                )}
              </g>
            )
          })}

          {/* Center divider */}
          <line
            x1={BAR_MAX_WIDTH}
            y1={0}
            x2={BAR_MAX_WIDTH}
            y2={chartHeight}
            stroke="#374151"
            strokeWidth={1}
          />

          {/* Flip point marker — Phase 14 wave 16 fix.
              Prior code positioned the flip line by `(flipPoint − minStrike) / strikeRange × chartHeight`,
              i.e. proportional to STRIKE VALUE. But the bars are positioned by INDEX
              (`y = i × (BAR_HEIGHT + 2)`), and strikes are typically NON-uniformly spaced
              (e.g. $5 below $100, $10 to $500, $25 above). Result: the flip-point line
              pointed at a completely different bar from the one it should annotate.
              Fix: locate the index brackets that contain flipPoint among the sorted strikes,
              interpolate the within-bracket fraction, and convert THAT to a y-pixel. */}
          {flipPoint != null && (() => {
            // Find the index brackets that contain flipPoint in the sorted strikes.
            // strikeGex is in ascending strike order (sorted in computeGex).
            const n = strikeGex.length
            let y: number
            if (n === 0) {
              y = 0
            } else if (flipPoint <= strikeGex[0].strike) {
              y = 0  // above first bar — clamp to top
            } else if (flipPoint >= strikeGex[n - 1].strike) {
              y = (n - 1) * (BAR_HEIGHT + 2)  // below last bar — clamp to bottom
            } else {
              // Binary search for upper bound to keep the lookup O(log n) for large chains.
              let lo = 0, hi = n - 1
              while (lo + 1 < hi) {
                const mid = (lo + hi) >> 1
                if (strikeGex[mid].strike <= flipPoint) lo = mid
                else hi = mid
              }
              // Now strikes[lo] <= flipPoint < strikes[hi]; lo + 1 === hi.
              const sLo = strikeGex[lo].strike
              const sHi = strikeGex[hi].strike
              const frac = sHi > sLo ? (flipPoint - sLo) / (sHi - sLo) : 0
              y = (lo + frac) * (BAR_HEIGHT + 2)
            }
            return (
              <line
                x1={0}
                y1={y}
                x2={BAR_MAX_WIDTH * 2 + 80}
                y2={y}
                stroke="#fbbf24"
                strokeWidth={1}
                strokeDasharray="4,3"
                opacity={0.8}
              />
            )
          })()}
        </svg>
      </div>

      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-500 inline-block rounded" /> Long gamma (stabilising)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-500 inline-block rounded" /> Short gamma (amplifying)</span>
        {flipPoint != null && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-yellow-400 inline-block" /> Flip point</span>}
      </div>
    </div>
  )
}
