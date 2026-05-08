'use client'

interface SparklineProps {
  data: number[]
  color: string
  width?: number
  height?: number
  /** Optional accessible label override; defaults to a direction + magnitude string. */
  ariaLabel?: string
}

export default function Sparkline({ data, color, width = 80, height = 32, ariaLabel }: SparklineProps) {
  if (!data || data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const first = data[0]
  const last = data[data.length - 1]
  const isUp = last >= first
  const lineColor = isUp ? '#00d084' : '#ff4757'

  // F6.2 (Phase 13 S2): screen-reader-friendly chart description (WCAG 1.1.1).
  // Default summarizes direction + percent change + bar count.
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0
  const defaultLabel =
    `Sparkline trend: ${isUp ? 'up' : 'down'} ${Math.abs(pctChange).toFixed(1)}% across ${data.length} bars; ` +
    `range ${min.toFixed(2)} to ${max.toFixed(2)}.`
  const label = ariaLabel ?? defaultLabel

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {/* Fill area */}
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#spark-${color.replace('#', '')})`}
      />
      <polyline
        points={points}
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
