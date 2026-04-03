'use client'

interface PriceLevel {
  price: number
  type: 'floor' | 'ceiling' | 'pivot' | 'vwap_zone' | 'gamma_wall' | 'order_block'
  strength: number
  sources: string[]
  evidence: {
    touchCount: number
    avgBouncePct: number
    totalVolume: number
    lastTouch: string | null
  }
  distanceFromSpot: number
  label: string
}

interface PriceLevelChartProps {
  ticker: string
  currentPrice: number
  levels: PriceLevel[]
  vwapBands?: {
    upper: number
    mid: number
    lower: number
  }
  candles?: Array<{
    time: number
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
}

const SOURCE_LABELS: Record<string, string> = {
  vwsr: 'Volume-Weighted S/R',
  kelly_atr: 'Kelly ATR Zones',
  order_block: 'Institutional Order Block',
  fibonacci: 'Fibonacci Retracement',
  classic_pivot: 'Pivot Points',
  vwap_bands: 'VWAP Deviation Bands',
  gamma_wall: 'Gamma Wall',
}

const FLOOR_COLORS: Record<string, string> = {
  floor: '#10b981',
  order_block: '#16a34a',
  kelly_atr: '#84cc16',
  pivot: '#22c55e',
  vwap_zone: '#22c55e',
  gamma_wall: '#10b981',
}

const CEILING_COLORS: Record<string, string> = {
  ceiling: '#ef4444',
  gamma_wall: '#f97316',
  pivot: '#fb7185',
  vwap_zone: '#f59e0b',
}

export default function PriceLevelChart({
  ticker,
  currentPrice,
  levels,
  vwapBands,
  candles,
}: PriceLevelChartProps) {
  const svgWidth = 600
  const svgHeight = 240
  const chartPadding = { top: 20, right: 70, bottom: 20, left: 10 }
  const chartWidth = svgWidth - chartPadding.left - chartPadding.right
  const chartHeight = svgHeight - chartPadding.top - chartPadding.bottom

  // Filter levels that are too close to each other (within 0.3% price distance)
  const MIN_LEVEL_DISTANCE_PCT = 0.3
  const filteredLevels: PriceLevel[] = []
  for (const level of levels.sort((a, b) => b.strength - a.strength)) {
    const isTooClose = filteredLevels.some(
      existing =>
        Math.abs(existing.price - level.price) / currentPrice < MIN_LEVEL_DISTANCE_PCT
    )
    if (!isTooClose) {
      filteredLevels.push(level)
    }
  }

  const allPrices = [
    currentPrice,
    ...filteredLevels.map(l => l.price),
    ...(vwapBands ? [vwapBands.upper, vwapBands.mid, vwapBands.lower] : []),
    ...(candles ? [Math.max(...candles.map(c => c.high)), Math.min(...candles.map(c => c.low))] : []),
  ]
  const minPrice = Math.min(...allPrices)
  const maxPrice = Math.max(...allPrices)
  const priceRange = maxPrice - minPrice || 1

  function priceY(price: number): number {
    return chartPadding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight
  }

  function priceToX(price: number): number {
    return chartPadding.left + ((price - minPrice) / priceRange) * chartWidth
  }

  // Price axis labels (4-6 values)
  const priceAxisLabels: number[] = []
  const labelCount = 5
  for (let i = 0; i <= labelCount; i++) {
    priceAxisLabels.push(minPrice + (priceRange / labelCount) * i)
  }

  const floors = filteredLevels.filter(l => l.type === 'floor' || l.type === 'order_block' || l.type === 'pivot' || l.type === 'vwap_zone' || l.type === 'gamma_wall')
  const ceilings = filteredLevels.filter(l => l.type === 'ceiling')

  // Sort by strength for the table
  const sortedLevels = [...filteredLevels].sort((a, b) => b.strength - a.strength)

  // Mini chart path from candles
  const candlePath = candles && candles.length > 1
    ? (() => {
        const recent = candles.slice(-50)
        const prices = recent.map(c => c.close)
        const cMin = Math.min(...prices)
        const cMax = Math.max(...prices)
        const cRange = cMax - cMin || 1
        const pathPoints = recent.map((c, i) => {
          const x = chartPadding.left + (i / (recent.length - 1)) * chartWidth
          const y = chartPadding.top + chartHeight - ((c.close - cMin) / cRange) * chartHeight
          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
        }).join(' ')
        return pathPoints
      })()
    : null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">Price Level Detection</div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Multi-algorithm support/resistance levels — floors (green) and ceilings (red)
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono font-bold text-cyan-400">
            ${currentPrice.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500">{ticker}</div>
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Background grid lines */}
          {[0.25, 0.5, 0.75, 1.0].map(pct => (
            <line
              key={pct}
              x1={chartPadding.left}
              y1={chartPadding.top + chartHeight * (1 - pct)}
              x2={chartPadding.left + chartWidth}
              y2={chartPadding.top + chartHeight * (1 - pct)}
              stroke="#334155"
              strokeWidth="0.5"
              strokeDasharray="2,4"
            />
          ))}

          {/* Mini price chart background */}
          {candlePath && (
            <path
              d={candlePath}
              fill="none"
              stroke="#64748b"
              strokeWidth="1.5"
              opacity={0.3}
            />
          )}

          {/* VWAP bands */}
          {vwapBands && (
            <>
              <line
                x1={chartPadding.left}
                y1={priceY(vwapBands.upper)}
                x2={chartPadding.left + chartWidth}
                y2={priceY(vwapBands.upper)}
                stroke="#f59e0b"
                strokeWidth="1"
                strokeDasharray="4,2"
                opacity={0.6}
              />
              <line
                x1={chartPadding.left}
                y1={priceY(vwapBands.mid)}
                x2={chartPadding.left + chartWidth}
                y2={priceY(vwapBands.mid)}
                stroke="#f59e0b"
                strokeWidth="1.5"
                opacity={0.8}
              />
              <line
                x1={chartPadding.left}
                y1={priceY(vwapBands.lower)}
                x2={chartPadding.left + chartWidth}
                y2={priceY(vwapBands.lower)}
                stroke="#f59e0b"
                strokeWidth="1"
                strokeDasharray="4,2"
                opacity={0.6}
              />
            </>
          )}

          {/* Floor levels */}
          {floors.map((level, i) => {
            const y = priceY(level.price)
            const color = FLOOR_COLORS[level.type] ?? '#22c55e'
            return (
              <g key={`floor-${i}`}>
                <line
                  x1={chartPadding.left}
                  y1={y}
                  x2={chartPadding.left + chartWidth}
                  y2={y}
                  stroke={color}
                  strokeWidth="1.5"
                  opacity={0.7 + (level.strength / 100) * 0.3}
                />
                {/* Label */}
                <text
                  x={chartPadding.left + chartWidth + 4}
                  y={y + 3}
                  fontSize="8"
                  fill={color}
                  fontFamily="monospace"
                >
                  {level.label || 'FLOOR'} {level.strength}%
                </text>
                {/* Dot */}
                <circle
                  cx={chartPadding.left + chartWidth + 2}
                  cy={y}
                  r={2}
                  fill={color}
                />
              </g>
            )
          })}

          {/* Ceiling levels */}
          {ceilings.map((level, i) => {
            const y = priceY(level.price)
            const color = CEILING_COLORS[level.type] ?? '#ef4444'
            return (
              <g key={`ceiling-${i}`}>
                <line
                  x1={chartPadding.left}
                  y1={y}
                  x2={chartPadding.left + chartWidth}
                  y2={y}
                  stroke={color}
                  strokeWidth="1.5"
                  opacity={0.7 + (level.strength / 100) * 0.3}
                />
                {/* Label */}
                <text
                  x={chartPadding.left + chartWidth + 4}
                  y={y + 3}
                  fontSize="8"
                  fill={color}
                  fontFamily="monospace"
                >
                  {level.label || 'CEILING'} {level.strength}%
                </text>
                {/* Dot */}
                <circle
                  cx={chartPadding.left + chartWidth + 2}
                  cy={y}
                  r={2}
                  fill={color}
                />
              </g>
            )
          })}

          {/* Current price line */}
          <line
            x1={chartPadding.left}
            y1={priceY(currentPrice)}
            x2={chartPadding.left + chartWidth}
            y2={priceY(currentPrice)}
            stroke="#22d3ee"
            strokeWidth="1.5"
            strokeDasharray="4,2"
          />

          {/* Price axis labels */}
          {priceAxisLabels.map((price, i) => (
            <text
              key={i}
              x={svgWidth - 5}
              y={priceY(price) + 3}
              textAnchor="end"
              fontSize="8"
              fill="#64748b"
              fontFamily="monospace"
            >
              {price.toFixed(2)}
            </text>
          ))}
        </svg>
      </div>

      {/* Level panel */}
      {sortedLevels.length > 0 && (
        <div className="rounded border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="grid grid-cols-6 gap-1 p-2 text-[9px] text-slate-500 border-b border-slate-800">
            <div>Type</div>
            <div>Price</div>
            <div>Strength</div>
            <div>Sources</div>
            <div>Touches</div>
            <div>Last Touch</div>
          </div>
          {sortedLevels.slice(0, 8).map((level, i) => {
            const isFloor = level.type === 'floor' || level.type === 'order_block' || level.type === 'pivot' || level.type === 'vwap_zone' || level.type === 'gamma_wall'
            const color = isFloor ? 'text-green-400' : 'text-red-400'
            const bgColor = isFloor ? 'bg-green-950/30' : 'bg-red-950/30'
            return (
              <div
                key={i}
                className={`grid grid-cols-6 gap-1 p-2 text-[10px] border-b border-slate-800/50 last:border-b-0 ${bgColor}`}
              >
                <div className={`font-mono font-medium ${color}`}>
                  {level.type.replace('_', ' ').toUpperCase()}
                </div>
                <div className="font-mono text-slate-300">
                  ${level.price.toFixed(2)}
                </div>
                <div className="font-mono text-slate-300">
                  {level.strength}%
                </div>
                <div className="text-slate-500 truncate">
                  {level.sources.map(s => SOURCE_LABELS[s] || s).join(', ')}
                </div>
                <div className="font-mono text-slate-400">
                  {level.evidence.touchCount}
                </div>
                <div className="text-slate-500">
                  {level.evidence.lastTouch
                    ? new Date(level.evidence.lastTouch).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Source legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-500">
        <div className="text-slate-600 font-medium">Sources:</div>
        {Object.entries(SOURCE_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span className="font-mono text-slate-400">{key}</span>
            <span>= {label}</span>
          </div>
        ))}
      </div>

      {/* VWAP label */}
      {vwapBands && (
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0 border-t border-dashed border-amber-400 opacity-60" />
            <span className="text-slate-400">VWAP ±1σ</span>
          </div>
          <div className="text-slate-500">
            Upper: <span className="font-mono text-amber-400">${vwapBands.upper.toFixed(2)}</span>
            {' '}Mid: <span className="font-mono text-amber-400">${vwapBands.mid.toFixed(2)}</span>
            {' '}Lower: <span className="font-mono text-amber-400">${vwapBands.lower.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
