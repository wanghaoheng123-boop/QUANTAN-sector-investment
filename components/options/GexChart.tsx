'use client'

import type { GexResult } from '@/lib/options/gex'

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

  const maxAbs = Math.max(...strikeGex.map((s) => Math.abs(s.gex)), 1)
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
        <span className="text-gray-400">Total GEX:</span>
        <span className={totalGex >= 0 ? 'text-emerald-400' : 'text-red-400'}>
          {totalGex >= 0 ? '+' : ''}{fmtGex(totalGex)}
        </span>
        {flipPoint != null && (
          <>
            <span className="text-gray-400">Flip:</span>
            <span className="text-yellow-400">${flipPoint.toFixed(2)}</span>
          </>
        )}
        <span className="text-gray-400">Spot:</span>
        <span className="text-gray-300">${spot.toFixed(2)}</span>
      </div>

      {/* Bar chart */}
      <div className="overflow-y-auto max-h-96">
        <svg width={BAR_MAX_WIDTH * 2 + 80} height={chartHeight} className="font-mono">
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

          {/* Flip point marker */}
          {flipPoint != null && (
            <line
              x1={0}
              y1={((flipPoint - minStrike) / strikeRange) * chartHeight}
              x2={BAR_MAX_WIDTH * 2 + 80}
              y2={((flipPoint - minStrike) / strikeRange) * chartHeight}
              stroke="#fbbf24"
              strokeWidth={1}
              strokeDasharray="4,3"
              opacity={0.8}
            />
          )}
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
