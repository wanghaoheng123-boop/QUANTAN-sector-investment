'use client'

interface Props {
  maxPain: number
  spot: number
}

export default function MaxPainGauge({ maxPain, spot }: Props) {
  const range = spot * 0.08  // ±8% around spot
  const min = spot - range
  const max = spot + range

  function toPercent(price: number): number {
    return Math.min(100, Math.max(0, ((price - min) / (max - min)) * 100))
  }

  const spotPct = toPercent(spot)
  const painPct = toPercent(maxPain)
  const diff = ((maxPain - spot) / spot) * 100
  const direction = diff > 0.1 ? 'above' : diff < -0.1 ? 'below' : 'at'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">Max Pain</span>
        <span className="text-yellow-400 font-mono font-bold">${maxPain.toFixed(2)}</span>
        <span className={`${diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-gray-400'} text-xs`}>
          {direction === 'at' ? 'At spot' : `${Math.abs(diff).toFixed(1)}% ${direction} spot`}
        </span>
      </div>

      {/* Gauge bar */}
      <div className="relative h-5 bg-gray-800 rounded-full overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-red-900/30 via-gray-700/20 to-emerald-900/30 rounded-full" />

        {/* Max pain marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-yellow-400"
          style={{ left: `${painPct}%` }}
        />
        {/* Pain label */}
        <div
          className="absolute -top-5 text-xs text-yellow-400 -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${painPct}%` }}
        >
          Pain
        </div>

        {/* Spot marker */}
        <div
          className="absolute top-0.5 bottom-0.5 w-1.5 bg-indigo-400 rounded-full -translate-x-1/2"
          style={{ left: `${spotPct}%` }}
        />
      </div>

      {/* Scale labels */}
      <div className="flex justify-between text-xs text-gray-600 font-mono">
        <span>${min.toFixed(0)}</span>
        <span className="text-gray-400">Spot: <span className="text-indigo-300">${spot.toFixed(2)}</span></span>
        <span>${max.toFixed(0)}</span>
      </div>

      <p className="text-xs text-gray-500">
        Max Pain is the strike where aggregate option holders lose the most at expiry.
        Stocks sometimes gravitate toward max pain near expiration.
      </p>
    </div>
  )
}
