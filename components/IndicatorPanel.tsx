'use client'

import { ChartEmaKey, ChartEmaPeriod, CHART_EMA_PERIODS } from '@/lib/chartEma'

type VisKey = ChartEmaKey | 'vwap' | 'bollingerBands' | 'fibonacci' | 'volSma'

interface IndicatorDef {
  key: string
  label: string
  color: string
  dotColor: string
}

const EMA_COLOR: Record<number, string> = {
  4:   'bg-cyan-300',
  5:   'bg-cyan-400',
  6:   'bg-cyan-500',
  7:   'bg-cyan-600',
  8:   'bg-cyan-700',
  9:   'bg-lime-500',
  10:  'bg-lime-400',
  12:  'bg-lime-600',
  15:  'bg-amber-400',
  20:  'bg-amber-500',
  21:  'bg-orange-500',
  26:  'bg-orange-600',
  30:  'bg-yellow-600',
  40:  'bg-amber-600',
  50:  'bg-violet-500',
  60:  'bg-violet-600',
  100: 'bg-pink-500',
  150: 'bg-teal-500',
  200: 'bg-slate-400',
  250: 'bg-orange-400',
}

const INDICATOR_DEFS: IndicatorDef[] = [
  ...CHART_EMA_PERIODS.map((p) => ({
    key: `ema${p}` as ChartEmaKey,
    label: `EMA ${p}`,
    color: EMA_COLOR[p] ?? 'bg-slate-400',
    dotColor: EMA_COLOR[p]?.replace('bg-', 'text-') ?? 'text-slate-400',
  })),
  { key: 'vwap', label: 'VWAP', color: 'bg-cyan-500', dotColor: 'text-cyan-500' },
  { key: 'bollingerBands', label: 'BB(20,2)', color: 'bg-amber-400/60', dotColor: 'text-amber-400' },
  { key: 'fibonacci', label: 'Fib', color: 'bg-rose-400/60', dotColor: 'text-rose-400' },
  { key: 'volSma', label: 'Vol SMA(20)', color: 'bg-indigo-400/60', dotColor: 'text-indigo-400' },
]

interface IndicatorPanelProps {
  /** Current visibility state from KLineChart */
  vis: Record<VisKey, boolean>
  /** Called when user toggles an indicator */
  onToggle: (key: VisKey) => void
  /** Optional title */
  title?: string
  /** Show volume SMA toggle */
  showVolSma?: boolean
}

export default function IndicatorPanel({
  vis,
  onToggle,
  title = 'Indicators',
  showVolSma = true,
}: IndicatorPanelProps) {
  return (
    <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 w-full">
      <h3 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-3">{title}</h3>

      <div className="space-y-3">
        {/* EMA Group */}
        <div>
          <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1.5">Moving Averages</div>
          <div className="flex flex-wrap gap-1">
            {CHART_EMA_PERIODS.map((p) => {
              const key = `ema${p}` as ChartEmaKey
              const on = !!vis[key]
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onToggle(key)}
                  className={`group relative px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all duration-200 ${
                    on
                      ? `${EMA_COLOR[p] ?? 'bg-slate-600'} text-white border-transparent shadow-sm`
                      : 'border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400'
                  }`}
                >
                  {on && (
                    <span className={`absolute -left-0.5 -top-0.5 w-1.5 h-1.5 rounded-full ${EMA_COLOR[p] ?? 'bg-slate-400'} opacity-70`} />
                  )}
                  {p}
                </button>
              )
            })}
          </div>
        </div>

        {/* Overlays Group */}
        <div>
          <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1.5">Overlays</div>
          <div className="flex flex-col gap-1">
            {INDICATOR_DEFS.filter(d => !d.key.startsWith('ema')).map((d) => {
              if (d.key === 'volSma' && !showVolSma) return null
              const on = !!vis[d.key as VisKey]
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => onToggle(d.key as VisKey)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] font-mono border transition-all duration-200 text-left ${
                    on
                      ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                      : 'border-slate-800 text-slate-600 hover:border-slate-700 hover:text-slate-400'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${on ? d.dotColor : 'bg-slate-700'} transition-colors duration-200 shrink-0`} />
                  <span className={`w-5 h-0.5 ${d.color} inline-block rounded transition-all duration-200 ${!on ? 'opacity-30' : 'opacity-100'}`} />
                  <span className="flex-1">{d.label}</span>
                  <span className={`text-[9px] ml-2 transition-opacity duration-200 ${on ? 'text-cyan-400/70' : 'text-slate-700'}`}>
                    {on ? 'ON' : 'OFF'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
