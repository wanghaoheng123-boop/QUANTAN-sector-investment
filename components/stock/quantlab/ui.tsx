'use client'

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-950/40 border border-slate-800/80 px-2 py-1.5">
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-200 font-mono">{value}</div>
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt: (v: number) => string
}) {
  return (
    <label className="block space-y-1">
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span className="font-mono text-slate-200">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-blue-500"
      />
    </label>
  )
}

export function PriceRail({
  price,
  fair,
  buy,
  sell,
}: {
  price: number
  fair: number
  buy: number | null
  sell: number | null
}) {
  const xs = [price, fair, buy, sell].filter((v): v is number => v != null && Number.isFinite(v))
  const rawLo = Math.min(...xs)
  const rawHi = Math.max(...xs)
  const pad = Math.max(rawHi - rawLo, rawLo * 0.002) * 0.08
  const lo = rawLo - pad
  const hi = rawHi + pad
  const span = hi - lo || 1
  const pos = (x: number) => `${((x - lo) / span) * 100}%`

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono text-slate-300">
        <div>
          <span className="text-slate-400 block text-[9px] uppercase tracking-wide">Buy ceiling</span>
          {buy != null ? `$${buy.toFixed(2)}` : '—'}
        </div>
        <div>
          <span className="text-slate-400 block text-[9px] uppercase tracking-wide">Fair mid</span>${fair.toFixed(2)}
        </div>
        <div>
          <span className="text-slate-400 block text-[9px] uppercase tracking-wide">Spot</span>${price.toFixed(2)}
        </div>
        <div>
          <span className="text-slate-400 block text-[9px] uppercase tracking-wide">Sell floor</span>
          {sell != null ? `$${sell.toFixed(2)}` : '—'}
        </div>
      </div>
      <div className="relative h-14 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
        <div className="absolute inset-y-0 w-px bg-slate-600 z-[1]" style={{ left: pos(fair) }} title={`Fair ${fair.toFixed(2)}`} />
        {buy != null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-emerald-500/90 z-[1]"
            style={{ left: pos(buy) }}
            title={`Buy zone ceiling ${buy.toFixed(2)}`}
          />
        )}
        {sell != null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-rose-500/90 z-[1]"
            style={{ left: pos(sell) }}
            title={`Sell zone floor ${sell.toFixed(2)}`}
          />
        )}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-blue-500 shadow-lg z-[2]"
          style={{ left: pos(price) }}
          title={`Spot ${price.toFixed(2)}`}
        />
        <div className="absolute bottom-1 left-2 right-2 flex justify-between text-[9px] text-slate-400 font-mono">
          <span>${lo.toFixed(2)}</span>
          <span>${hi.toFixed(2)}</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed">
        Rail span ${lo.toFixed(2)}–${hi.toFixed(2)} (padded). Cheaper vs model when price is at or below the buy ceiling; above sell floor = richer vs model.
      </p>
    </div>
  )
}
