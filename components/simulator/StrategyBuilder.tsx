'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  type StrategyConfig,
  type PresetName,
  type StrategyPreset,
  validateStrategyConfig,
  applyStrategyPreset,
  DEFAULT_STRATEGY_CONFIG,
  mergeStrategyConfig,
  STRATEGY_PRESETS,
  DEFAULT_DEVIATION_ZONES,
  type StopLossMode,
  type KellyMode,
  type StrategyMode,
} from '@/lib/strategy/strategyConfig'
import { apiUrl } from '@/lib/infra/apiBase'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface StrategyBuilderProps {
  onRun: (config: StrategyConfig) => void
  onReset?: () => void
  /** Fired when user clicks a named risk preset (for optimizer axes / Command Center). */
  onPresetSelect?: (presetName: PresetName) => void
  initialConfig?: Partial<StrategyConfig>
  isRunning?: boolean
  /** When `expert`, the Advanced JSON editor starts expanded. */
  uxMode?: 'beginner' | 'expert'
}

// ─── Theme constants ───────────────────────────────────────────────────────────

const TABS = ['Regime & MA', 'Entry Signals', 'Risk & Sizing', 'Advanced Filters'] as const
type TabKey = typeof TABS[number]

// ─── Live Quote types ──────────────────────────────────────────────────────────

interface LiveQuote {
  ticker: string
  price: number | null
  rsi14: number | null
  atrPct: number | null
  deviationPct: number | null
  macdHistogram: number | null
  bbPercent: number | null
  lastDate: string | null
}

// ─── Tooltip Component ─────────────────────────────────────────────────────────

interface TooltipProps {
  brief: React.ReactNode
  detail?: React.ReactNode
  children: React.ReactNode
}

function Tooltip({ brief, detail, children }: TooltipProps) {
  const [briefVisible, setBriefVisible] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const briefRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const hasDetail = detail !== undefined

  return (
    <div ref={briefRef} className="relative inline-flex items-center">
      <div
        onMouseEnter={() => !detailOpen && setBriefVisible(true)}
        onMouseLeave={() => setBriefVisible(false)}
      >
        {children}
      </div>
      {briefVisible && !detailOpen && (
        <div className="absolute left-full top-0 ml-2 z-50 w-80 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-4 pointer-events-none">
          <div className="text-xs text-slate-300 leading-relaxed space-y-2">
            {brief}
          </div>
          <div className="absolute left-0 top-4 -translate-x-2 w-0 h-0 border-4 border-transparent border-r-slate-600" />
        </div>
      )}
      {hasDetail && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setBriefVisible(false)
            setDetailOpen(!detailOpen)
          }}
          className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-700 text-slate-400 text-[10px] font-bold cursor-pointer ml-1.5 hover:bg-slate-600 hover:text-slate-300 transition-colors"
        >
          ℹ
        </button>
      )}
      {detailOpen && detail && (
        <div
          ref={detailRef}
          className="absolute left-full top-0 ml-2 z-50 w-96 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-4"
          onMouseLeave={() => setDetailOpen(false)}
        >
          <div className="text-xs text-slate-300 leading-relaxed space-y-2">
            {detail}
          </div>
          <div className="absolute left-0 top-4 -translate-x-2 w-0 h-0 border-4 border-transparent border-r-slate-600" />
        </div>
      )}
    </div>
  )
}

function TooltipTrigger() {
  return (
    <span className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-700 text-slate-400 text-[10px] font-bold cursor-help ml-1.5 hover:bg-slate-600 hover:text-slate-300 transition-colors">
      ?
    </span>
  )
}

// ─── Number Input with Stepper ─────────────────────────────────────────────────

interface NumberInputProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  prefix?: string
  decimals?: number
  className?: string
}

function NumberInput({ value, onChange, min = 0, max = 100, step = 1, suffix = '', prefix = '', decimals = 0, className = '' }: NumberInputProps) {
  const fmt = (v: number) => `${prefix}${v.toFixed(decimals)}${suffix}`

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(decimals)))}
        className="w-6 h-6 flex items-center justify-center rounded bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white text-xs font-bold transition-colors"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, +v.toFixed(decimals))))
        }}
        className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-cyan-500/50"
      />
      <button
        onClick={() => onChange(Math.min(max, +(value + step).toFixed(decimals)))}
        className="w-6 h-6 flex items-center justify-center rounded bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white text-xs font-bold transition-colors"
      >
        +
      </button>
    </div>
  )
}

// ─── Slider + Number Combo ──────────────────────────────────────────────────────

interface SliderInputProps {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
  decimals?: number
}

function SliderInput({ value, onChange, min, max, step = 0.01, suffix = '', decimals = 2 }: SliderInputProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(+parseFloat(e.target.value).toFixed(decimals))}
        className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-cyan-500"
        style={{ accentColor: '#06b6d4' }}
      />
      <span className="text-xs text-cyan-400 font-mono w-14 text-right shrink-0">
        {value.toFixed(decimals)}{suffix}
      </span>
    </div>
  )
}

// ─── Select Input ─────────────────────────────────────────────────────────────

interface SelectInputProps {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}

function SelectInput({ value, onChange, options, className = '' }: SelectInputProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50 cursor-pointer ${className}`}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

interface ToggleProps {
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

function Toggle({ value, onChange, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
        value ? 'bg-cyan-500' : 'bg-slate-700'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ─── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{title}</div>
      {subtitle && <div className="text-[10px] text-slate-600 mt-0.5">{subtitle}</div>}
    </div>
  )
}

// ─── Param Row ───────────────────────────────────────────────────────────────

interface ParamRowProps {
  label: string
  brief: React.ReactNode
  tooltip?: React.ReactNode
  children: React.ReactNode
  value?: React.ReactNode
}

function ParamRow({ label, brief, tooltip, children, value }: ParamRowProps) {
  return (
    <div className="flex items-start justify-between py-2 px-3 rounded-lg hover:bg-slate-800/40 transition-colors group">
      <div className="flex items-center min-w-0 mr-3">
        <span className="text-xs text-slate-400 truncate">{label}</span>
        <Tooltip brief={brief} detail={tooltip}>
          <TooltipTrigger />
        </Tooltip>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {children}
        {value !== undefined && (
          <span className="text-xs font-mono text-cyan-400 w-14 text-right">{value}</span>
        )}
      </div>
    </div>
  )
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-slate-800 my-2" />
}

// ─── Live Quote Preview ────────────────────────────────────────────────────────

interface LiveQuotePreviewProps {
  ticker: string
  onTickerChange: (t: string) => void
  quote: LiveQuote | null
  loading: boolean
}

function LiveQuotePreview({ ticker, onTickerChange, quote, loading }: LiveQuotePreviewProps) {
  const [inputVal, setInputVal] = useState(ticker)

  useEffect(() => { setInputVal(ticker) }, [ticker])

  const fmt = (v: number | null, decimals = 2, prefix = '') =>
    v == null ? '—' : `${prefix}${v.toFixed(decimals)}`

  const fmtMoney = (v: number | null) =>
    v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const rsiColor = quote?.rsi14 == null ? 'text-slate-500' :
    quote.rsi14 > 70 ? 'text-red-400' :
    quote.rsi14 < 30 ? 'text-emerald-400' : 'text-slate-300'

  const devColor = quote?.deviationPct == null ? 'text-slate-500' :
    quote.deviationPct < -20 ? 'text-red-400' :
    quote.deviationPct < 0 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Live Quote Preview</div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter' && inputVal.trim()) onTickerChange(inputVal.trim())
          }}
          placeholder="Enter ticker (e.g. AAPL)"
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
        />
        <button
          onClick={() => inputVal.trim() && onTickerChange(inputVal.trim())}
          className="px-3 py-1 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs rounded hover:bg-cyan-500/30 transition-colors"
        >
          Fetch
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin" />
        </div>
      ) : quote ? (
        <div className="space-y-2">
          <div className="text-center mb-3">
            <div className="text-lg font-bold text-white font-mono">{quote.ticker}</div>
            <div className={`text-2xl font-bold font-mono ${quote.price != null ? 'text-white' : 'text-slate-600'}`}>
              {fmtMoney(quote.price)}
            </div>
            {quote.lastDate && (
              <div className="text-[10px] text-slate-600 mt-0.5">{quote.lastDate}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              ['RSI (14)', fmt(quote.rsi14, 1), rsiColor],
              ['ATR%', fmt(quote.atrPct, 2) + '%', 'text-slate-300'],
              ['200EMA Dev', fmt(quote.deviationPct, 2) + '%', devColor],
              ['MACD Hist', fmt(quote.macdHistogram, 3), quote.macdHistogram != null ? (quote.macdHistogram > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'],
              ['BB%', fmt(quote.bbPercent, 2), 'text-slate-300'],
            ].map(([label, val, color]) => (
              <div key={label as string} className="bg-slate-800/60 rounded-lg px-3 py-2 border border-slate-700/50">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
                <div className={`text-sm font-mono font-bold ${color}`}>{val}</div>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-slate-600 mt-2 text-center">
            Simulated data — not financial advice
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-slate-500 text-xs">
          Enter a ticker to preview live indicators
        </div>
      )}
    </div>
  )
}

// ─── Deviation Zones Panel ─────────────────────────────────────────────────────

interface DeviationZonesPanelProps {
  zones: typeof DEFAULT_DEVIATION_ZONES
  onChange: (z: typeof DEFAULT_DEVIATION_ZONES) => void
}

function DeviationZonesPanel({ zones, onChange }: DeviationZonesPanelProps) {
  const [open, setOpen] = useState(false)

  const fields: { key: keyof typeof DEFAULT_DEVIATION_ZONES; label: string; suffix: string; min: number; max: number; step: number; decimals: number; description: string }[] = [
    { key: 'extremeBullThreshold', label: 'Extreme Bull', suffix: '%', min: 5, max: 50, step: 0.5, decimals: 1, description: 'Price must be this % above SMA to be considered EXTREME_BULL (overbought zone — no buy signals).' },
    { key: 'extendedBullThreshold', label: 'Extended Bull', suffix: '%', min: 2, max: 30, step: 0.5, decimals: 1, description: 'Price above this % of SMA enters EXTENDED_BULL zone — avoid chasing.' },
    { key: 'healthyBullThreshold', label: 'Healthy Bull', suffix: '%', min: -10, max: 10, step: 0.5, decimals: 1, description: 'Price within ±this % of SMA is HEALTHY_BULL — acceptable for entries.' },
    { key: 'firstDipThreshold', label: 'First Dip', suffix: '%', min: -30, max: 0, step: 0.5, decimals: 1, description: 'Price this % below SMA = FIRST_DIP zone. Primary BUY entry zone.' },
    { key: 'deepDipThreshold', label: 'Deep Dip', suffix: '%', min: -50, max: -5, step: 0.5, decimals: 1, description: 'Price this % below SMA = DEEP_DIP. High-conviction BUY zone.' },
    { key: 'bearAlertThreshold', label: 'Bear Alert', suffix: '%', min: -60, max: -10, step: 0.5, decimals: 1, description: 'Price this % below SMA = BEAR_ALERT. Only buy with strongest confirmations.' },
  ]

  const update = (key: keyof typeof DEFAULT_DEVIATION_ZONES, val: number) => {
    onChange({ ...zones, [key]: val })
  }

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/60 hover:bg-slate-800 transition-colors text-xs text-slate-300"
      >
        <span>Deviation Zones ({open ? 'Expanded' : 'Collapsed'})</span>
        <span className="text-cyan-400 text-[10px]">{zones.extremeBullThreshold}% / {zones.extendedBullThreshold}% / {zones.firstDipThreshold}% / {zones.deepDipThreshold}%</span>
        <span className="text-slate-500 ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-2 space-y-1 bg-slate-900/40">
          {fields.map(f => (
            <div key={f.key} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/30">
              <div className="flex items-center min-w-0 mr-2">
                <Tooltip brief={<div>{f.description}<div className="mt-1 text-slate-400">Default: {DEFAULT_DEVIATION_ZONES[f.key]}{f.suffix}</div></div>}>
                  <span className="text-[10px] text-slate-400 truncate">{f.label}</span>
                  <TooltipTrigger />
                </Tooltip>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <NumberInput value={zones[f.key]} onChange={v => update(f.key, v)} min={f.min} max={f.max} step={f.step} suffix={f.suffix} decimals={f.decimals} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Regime & MA ─────────────────────────────────────────────────────────

interface RegimeTabProps {
  config: StrategyConfig
  onChange: (c: StrategyConfig) => void
}

function RegimeTab({ config, onChange }: RegimeTabProps) {
  const r = config.regime

  const upd = (patch: Partial<typeof r>) => onChange({ ...config, regime: { ...r, ...patch } })
  const updZones = (z: typeof r.deviationZones) => onChange({ ...config, regime: { ...r, deviationZones: z } })

  return (
    <div className="space-y-4">
      <SectionHeader title="SMA Configuration" subtitle="200 = institutional standard for long-term trend" />
      <div className="space-y-1">
        <ParamRow
          label="SMA Period"
          brief={<div>The number of daily closing prices averaged to compute the SMA.</div>}
          tooltip={
            <div>
              <div className="font-semibold text-cyan-400 mb-1">Simple Moving Average Period</div>
              <div>The number of daily closing prices averaged to compute the SMA. 200 is the industry standard used by institutional investors for long-term trend identification.</div>
              <div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 200 (captures major trends, fewer whipsaws) · <span className="text-emerald-400">Aggressive:</span> 50-100 (more signals, more noise)</div>
              <div className="mt-1 text-slate-500">Warning: Period must be &gt; slope lookback or slope measurement is meaningless.</div>
            </div>
          }
          value={`${r.smaPeriod}`}
        >
          <NumberInput value={r.smaPeriod} onChange={v => upd({ smaPeriod: v })} min={10} max={500} step={10} />
        </ParamRow>

        <ParamRow
          label="Slope Lookback"
          brief={<div>Number of bars over which to measure the rate of change of the SMA itself.</div>}
          tooltip={
            <div>
              <div className="font-semibold text-cyan-400 mb-1">SMA Slope Lookback Window</div>
              <div>Number of bars over which to measure the rate of change of the SMA itself. A positive slope means the long-term trend is rising — essential for any BUY signal.</div>
              <div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 20-30 (smooth, filters noise) · <span className="text-emerald-400">Short-term:</span> 5-10 (reactive but noisy)</div>
              <div className="mt-1 text-slate-500">Must be significantly smaller than SMA period.</div>
            </div>
          }
          value={`${r.smaSlopeLookback}`}
        >
          <NumberInput value={r.smaSlopeLookback} onChange={v => upd({ smaSlopeLookback: v })} min={3} max={r.smaPeriod - 1} step={1} />
        </ParamRow>

        <ParamRow
          label="Slope Threshold"
          brief={<div>Minimum % change of the SMA value over the lookback window to consider the trend positive.</div>}
          tooltip={
            <div>
              <div className="font-semibold text-cyan-400 mb-1">Minimum SMA Slope to Confirm Uptrend</div>
              <div>Minimum % change of the SMA value over the lookback window to consider the trend positive. Values below this are treated as flat/uncertain.</div>
              <div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 0.5-1.0% (only buy in strong trends) · <span className="text-emerald-400">Active:</span> 0.1-0.3% (allows more signals in choppy markets)</div>
              <div className="mt-1 text-slate-500">Raising this filter reduces false signals in sideways markets but may miss early entries.</div>
            </div>
          }
          value={`${(r.smaSlopeThreshold * 100).toFixed(2)}%`}
        >
          <SliderInput value={r.smaSlopeThreshold * 100} onChange={v => upd({ smaSlopeThreshold: v / 100 })} min={0.05} max={3} step={0.05} suffix="%" decimals={2} />
        </ParamRow>
      </div>

      <Divider />

      <SectionHeader title="Deviation Zones" subtitle="Define price proximity thresholds for each regime zone" />
      <DeviationZonesPanel zones={r.deviationZones} onChange={updZones} />

      <Divider />

      <SectionHeader title="Price Proximity" subtitle="Prevents buying stocks that are in a sustained downtrend far from SMA" />
      <div className="space-y-1">
        <ParamRow
          label="Price Proximity Threshold"
          brief={<div>How close price must have been to the SMA in the recent lookback window to qualify for dip BUY signals.</div>}
          tooltip={
            <div>
              <div className="font-semibold text-cyan-400 mb-1">Price Proximity to SMA Required for BUY</div>
              <div>How close price must have been to the SMA in the recent lookback window to qualify for dip BUY signals. Expressed as a positive % (e.g. 5 = price was within 5% of SMA).</div>
              <div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 3-5% (ensure price is near mean, not falling knife) · <span className="text-emerald-400">Relaxed:</span> 10-15% (allow more varied entries)</div>
              <div className="mt-1 text-slate-500">Warning: Setting too high (e.g. &gt;20%) allows buying "forever falling" stocks. Setting too low (&lt;2%) may reject valid entries in volatile markets.</div>
            </div>
          }
          value={`${r.priceProximityThreshold}%`}
        >
          <SliderInput value={r.priceProximityThreshold} onChange={v => upd({ priceProximityThreshold: v })} min={1} max={30} step={0.5} suffix="%" decimals={1} />
        </ParamRow>
      </div>

      <Divider />

      <SectionHeader title="Strategy Mode" subtitle="Defines which signal logic is used for entries and exits" />
      <div className="space-y-1">
        <ParamRow
          label="Mode"
          brief={<div>Dip-buy based on 200SMA deviation zones with positive slope confirmation.</div>}
          tooltip={
            <div>
              <div className="font-semibold text-cyan-400 mb-1">Active Strategy Mode</div>
              <div><span className="text-amber-400">Regime:</span> Dip-buy based on 200SMA deviation zones — buys when price pulls back to healthy zones with positive slope. Default, institutional.</div>
              <div><span className="text-cyan-400">Momentum:</span> Buys when price breaks above SMA with strong momentum. Does not dip-buy.</div>
              <div><span className="text-emerald-400">Mean Reversion:</span> Statistical z-score based entries — buys when price is far below mean, sells when far above.</div>
              <div><span className="text-red-400">Breakout:</span> Buys on price/volume breakouts from consolidation ranges.</div>
              <div className="mt-1 text-slate-500">Regime mode is recommended for most market conditions. Momentum excels in trending markets (2020-2021). Mean Reversion works in range-bound markets.</div>
            </div>
          }
          value=""
        >
          <SelectInput
            value={config.strategyMode.strategyMode}
            onChange={v => onChange({ ...config, strategyMode: { ...config.strategyMode, strategyMode: v as StrategyMode } })}
            options={[
              { value: 'regime', label: 'Regime (Dip-Buy)' },
              { value: 'momentum', label: 'Momentum' },
              { value: 'mean_reversion', label: 'Mean Reversion' },
              { value: 'breakout', label: 'Breakout' },
            ]}
          />
        </ParamRow>
      </div>
    </div>
  )
}

// ─── Tab: Entry Signals ────────────────────────────────────────────────────────

interface EntryTabProps {
  config: StrategyConfig
  onChange: (c: StrategyConfig) => void
}

function EntryTab({ config, onChange }: EntryTabProps) {
  const c = config.confirmations

  const upd = (patch: Partial<typeof c>) => onChange({ ...config, confirmations: { ...c, ...patch } })

  return (
    <div className="space-y-4">
      {/* RSI */}
      <SectionHeader title="RSI (Relative Strength Index)" subtitle="Momentum oscillator measuring speed and change of price movements" />
      <div className="space-y-1">
        <ParamRow label="RSI Period" brief={<div>Number of periods for RSI calculation.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">RSI Lookback Period</div><div>Number of periods for RSI calculation. 14 = Wilder's original setting. Shorter periods (7) are more reactive; longer (21) are smoother.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 14-21 · <span className="text-emerald-400">Active:</span> 7-10</div></div>
        } value={`${c.rsiPeriod}`}>
          <NumberInput value={c.rsiPeriod} onChange={v => upd({ rsiPeriod: v })} min={2} max={50} step={1} />
        </ParamRow>
        <ParamRow label="RSI Bull Threshold" brief={<div>RSI value below which the market is considered oversold/bullish for BUY entries.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">RSI Oversold Threshold for BUY</div><div>RSI value below which the market is considered oversold/bullish for BUY entries. Lower = stricter oversold requirement.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 25-30 (only buy at deep oversold) · <span className="text-emerald-400">Aggressive:</span> 38-42 (allows earlier entries)</div><div className="mt-1 text-slate-500">Must be &lt; RSI Bear Threshold.</div></div>
        } value={`${c.rsiBullThreshold}`}>
          <SliderInput value={c.rsiBullThreshold} onChange={v => upd({ rsiBullThreshold: v })} min={10} max={55} step={1} suffix="" decimals={0} />
        </ParamRow>
        <ParamRow label="RSI Bear Threshold" brief={<div>RSI value above which the market is considered overbought for SELL signals.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">RSI Overbought Threshold for SELL</div><div>RSI value above which the market is considered overbought for SELL signals.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 65-70 · <span className="text-emerald-400">Aggressive:</span> 58-62 (exit earlier to protect profits)</div></div>
        } value={`${c.rsiBearThreshold}`}>
          <SliderInput value={c.rsiBearThreshold} onChange={v => upd({ rsiBearThreshold: v })} min={45} max={85} step={1} suffix="" decimals={0} />
        </ParamRow>
      </div>

      <Divider />

      {/* MACD */}
      <SectionHeader title="MACD (Moving Average Convergence Divergence)" subtitle="Trend-following momentum indicator showing relationship between two EMAs" />
      <div className="space-y-1">
        <ParamRow label="MACD Fast Period" brief={<div>The 12-period EMA is the fast line that reacts quickly to price changes.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Fast EMA Period for MACD Line</div><div>The 12-period EMA is the fast line that reacts quickly to price changes. Combined with the slow line to generate the MACD histogram.</div><div className="mt-2 text-slate-400">Standard: 12 · Short-term: 8-10 · Longer-term: 15-17</div></div>
        } value={`${c.macdFast}`}>
          <NumberInput value={c.macdFast} onChange={v => upd({ macdFast: v })} min={5} max={30} step={1} />
        </ParamRow>
        <ParamRow label="MACD Slow Period" brief={<div>The 26-period EMA is the slow line that provides the anchor for the MACD.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Slow EMA Period for MACD Line</div><div>The 26-period EMA is the slow line that provides the anchor for the MACD. The difference between fast and slow creates the MACD histogram.</div><div className="mt-2 text-slate-400">Standard: 26 · Short-term: 17-20 · Longer-term: 30-35</div></div>
        } value={`${c.macdSlow}`}>
          <NumberInput value={c.macdSlow} onChange={v => upd({ macdSlow: v })} min={15} max={50} step={1} />
        </ParamRow>
        <ParamRow label="MACD Signal Period" brief={<div>The 9-period EMA of the MACD line itself creates the signal line.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">EMA Smoothing Period for Signal Line</div><div>The 9-period EMA of the MACD line itself creates the signal line. Crossovers of MACD vs. signal generate trading signals.</div><div className="mt-2 text-slate-400">Standard: 9 · More signals: 5-7 · Fewer signals: 12-15</div></div>
        } value={`${c.macdSignal}`}>
          <NumberInput value={c.macdSignal} onChange={v => upd({ macdSignal: v })} min={5} max={20} step={1} />
        </ParamRow>
      </div>

      <Divider />

      {/* ATR */}
      <SectionHeader title="ATR (Average True Range)" subtitle="Measures market volatility — daily range as a percentage of price" />
      <div className="space-y-1">
        <ParamRow label="ATR Period" brief={<div>Number of periods for ATR calculation.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">ATR Calculation Lookback Period</div><div>Number of periods for ATR calculation. 14 = standard. Shorter = more reactive volatility measure.</div><div className="mt-2 text-slate-400">Standard: 14 · Short-term: 7 · Long-term: 21</div></div>
        } value={`${c.atrPeriod}`}>
          <NumberInput value={c.atrPeriod} onChange={v => upd({ atrPeriod: v })} min={5} max={50} step={1} />
        </ParamRow>
        <ParamRow label="ATR Bull Threshold %" brief={<div>ATR% = (ATR / Price) × 100 — daily volatility as a % of price.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Minimum ATR% for BUY Signal</div><div>ATR% = (ATR / Price) × 100 — daily volatility as a % of price. ATR% &gt; N means the stock has meaningful daily range suitable for swing trades. ATR% &lt; 1% = low volatility; position may not have enough range to be profitable after costs.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 2.5-4% (only trade volatile instruments) · <span className="text-emerald-400">Aggressive:</span> 1-1.5% (include lower-vol assets)</div></div>
        } value={`${c.atrBullThreshold.toFixed(1)}%`}>
          <SliderInput value={c.atrBullThreshold} onChange={v => upd({ atrBullThreshold: v })} min={0.5} max={6} step={0.1} suffix="%" decimals={1} />
        </ParamRow>
      </div>

      <Divider />

      {/* Bollinger Bands */}
      <SectionHeader title="Bollinger Bands" subtitle="Statistical envelope around SMA measuring price deviation from mean" />
      <div className="space-y-1">
        <ParamRow label="BB Period" brief={<div>Lookback period for the middle band (SMA) and standard deviation calculation.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Bollinger Bands Middle Band Period</div><div>Lookback period for the middle band (SMA) and standard deviation calculation.</div><div className="mt-2 text-slate-400">Standard: 20 · Short-term: 10-15 · Long-term: 30-50</div></div>
        } value={`${c.bbPeriod}`}>
          <NumberInput value={c.bbPeriod} onChange={v => upd({ bbPeriod: v })} min={10} max={100} step={5} />
        </ParamRow>
        <ParamRow label="BB Std Dev Multiplier" brief={<div>How many standard deviations the outer bands are placed from the middle SMA.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Number of Standard Deviations for Outer Bands</div><div>How many standard deviations the outer bands are placed from the middle SMA. 2 = ~95% of price action within bands.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Wide bands:</span> 2.5-3 (fewer signals, more significant) · <span className="text-emerald-400">Tight bands:</span> 1.5-2 (more signals)</div></div>
        } value={`${c.bbStdDev}σ`}>
          <SliderInput value={c.bbStdDev} onChange={v => upd({ bbStdDev: v })} min={1} max={4} step={0.25} suffix="σ" decimals={2} />
        </ParamRow>
        <ParamRow label="BB Bull Threshold" brief={<div>BB% value for bullish BUY confirmation.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">BB% Value for Bullish BUY Confirmation</div><div>BB% = (price - lower band) / (upper band - lower band). BB% &lt; 0.20 means price is in the lower 20% of its recent range — near the lower Bollinger Band, suggesting oversold conditions.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 0.05-0.15 (buy only near absolute lower band) · <span className="text-emerald-400">Aggressive:</span> 0.25-0.40 (buy anywhere in lower half)</div></div>
        } value={c.bbBullThreshold.toFixed(2)}>
          <SliderInput value={c.bbBullThreshold} onChange={v => upd({ bbBullThreshold: v })} min={0.01} max={0.6} step={0.01} suffix="" decimals={2} />
        </ParamRow>
      </div>

      <Divider />

      {/* Composite */}
      <SectionHeader title="Composite Confirmation Score" subtitle="BUY signal requires N of 4 indicators to be bullish simultaneously" />
      <div className="space-y-1">
        <ParamRow label="Min Confirmations for BUY" brief={<div>The composite score sums bullish indications from RSI, MACD histogram, ATR%, and Bollinger Bands.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Minimum Bullish Indicators Required for BUY</div><div>The composite score sums bullish indications from RSI, MACD histogram, ATR%, and Bollinger Bands. BUY is only triggered when at least N of 4 indicators confirm.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 3-4 (high-quality signals only) · <span className="text-emerald-400">Balanced:</span> 2 (default, recommended) · <span className="text-orange-400">Aggressive:</span> 1 (more trades, more whipsaws)</div><div className="mt-1 text-slate-500">Warning: Setting minConfirmations too low (&lt;2) greatly increases trade frequency and false signals. Setting too high (&gt;3) may generate very few signals.</div></div>
        } value={`${c.minConfirmations} of 4`}>
          <SliderInput value={c.minConfirmations} onChange={v => upd({ minConfirmations: Math.round(v) })} min={1} max={4} step={1} suffix="" decimals={0} />
        </ParamRow>
      </div>
    </div>
  )
}

// ─── Tab: Risk & Sizing ────────────────────────────────────────────────────────

interface RiskTabProps {
  config: StrategyConfig
  onChange: (c: StrategyConfig) => void
}

function RiskTab({ config, onChange }: RiskTabProps) {
  const s = config.stopLoss
  const p = config.positionSizing

  const updStop = (patch: Partial<typeof s>) => onChange({ ...config, stopLoss: { ...s, ...patch } })
  const updPos = (patch: Partial<typeof p>) => onChange({ ...config, positionSizing: { ...p, ...patch } })

  return (
    <div className="space-y-4">
      {/* Stop Loss Mode */}
      <SectionHeader title="Stop Loss Mode" subtitle="Method for calculating initial stop-loss level after entry" />
      <div className="space-y-1">
        <ParamRow label="Stop Loss Mode" brief={<div>Method for calculating initial stop-loss level after entry.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Stop Loss Calculation Method</div><div><span className="text-amber-400">Fixed:</span> Fixed % below entry price. Simplest but doesn't adapt to volatility.</div><div><span className="text-cyan-400">ATR (recommended):</span> ATR-multiple-based stop. Adapts to current market volatility automatically. 1.5× ATR at entry with 2% daily volatility = 3% stop.</div><div><span className="text-emerald-400">Chandelier:</span> Highest high since entry − ATR × multiplier. Trail stop that locks in profits as price rises.</div><div className="mt-1 text-slate-500">ATR mode is recommended for most strategies as it adapts to volatility automatically.</div></div>
        } value="">
          <SelectInput
            value={s.stopLossMode}
            onChange={v => updStop({ stopLossMode: v as StopLossMode })}
            options={[
              { value: 'fixed', label: 'Fixed %' },
              { value: 'atr', label: 'ATR Multiplier' },
              { value: 'chandelier', label: 'Chandelier' },
            ]}
          />
        </ParamRow>
        <ParamRow label="ATR Multiplier" brief={<div>stopDistance = ATR × multiplier.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">ATR Stop Distance Multiplier</div><div>stopDistance = ATR × multiplier. With ATR% at entry = 2% and multiplier = 1.5, the stop is 3% below entry.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Tight (0.5-1.0×):</span> Suitable for low-vol assets, risks premature stop-outs</div><div><span className="text-cyan-400">Balanced (1.5-2.0×):</span> Default, recommended for most assets</div><div><span className="text-emerald-400">Wide (2.5-4.0×):</span> High-vol assets (ARKK, TQQQ), allows volatility room</div><div className="mt-1 text-slate-500">The floor and ceiling settings constrain the ATR-based stop from being too tight or too wide in low/high volatility environments.</div></div>
        } value={`${s.stopLossAtrMultiplier}×`}>
          <SliderInput value={s.stopLossAtrMultiplier} onChange={v => updStop({ stopLossAtrMultiplier: v })} min={0.5} max={5} step={0.1} suffix="×" decimals={1} />
        </ParamRow>
        <ParamRow label="Stop Loss Floor" brief={<div>Prevents the stop from being unreasonably tight in low-volatility assets.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Minimum Stop Loss as % of Entry</div><div>Prevents the stop from being unreasonably tight in low-volatility assets. Even if ATR-based calculation gives a 1% stop, this floor enforces a minimum.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 2-3% · <span className="text-emerald-400">Standard:</span> 3-5%</div><div className="mt-1 text-slate-500">Floor &lt; 1% risks being triggered by normal daily noise in low-vol assets.</div></div>
        } value={`${(s.stopLossFloor * 100).toFixed(1)}%`}>
          <SliderInput value={s.stopLossFloor * 100} onChange={v => updStop({ stopLossFloor: v / 100 })} min={0.5} max={15} step={0.25} suffix="%" decimals={1} />
        </ParamRow>
        <ParamRow label="Stop Loss Ceiling" brief={<div>Prevents the stop from being unreasonably wide, protecting capital efficiency.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Maximum Stop Loss as % of Entry</div><div>Prevents the stop from being unreasonably wide, protecting capital efficiency. Even in high-vol assets, this caps risk per position.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 8-10% · <span className="text-emerald-400">Standard:</span> 12-15% · <span className="text-orange-400">Aggressive:</span> 20-25%</div><div className="mt-1 text-slate-500">Ceiling &gt; 20% defeats the purpose of stop loss as a risk management tool. Most institutional strategies target 5-15% maximum loss per position.</div></div>
        } value={`${(s.stopLossCeiling * 100).toFixed(1)}%`}>
          <SliderInput value={s.stopLossCeiling * 100} onChange={v => updStop({ stopLossCeiling: v / 100 })} min={3} max={40} step={0.5} suffix="%" decimals={1} />
        </ParamRow>
      </div>

      <Divider />

      {/* Trailing Stop */}
      <SectionHeader title="Trailing Stop" subtitle="Dynamic stop that locks in profit as price moves in your favor" />
      <div className="space-y-1">
        <ParamRow label="Use Trailing Stop" brief={<div>Enable trailing stop mechanism to lock in profits as price moves in your favor.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Enable Trailing Stop Mechanism</div><div>When enabled, the stop level rises as price moves in your favor, locking in profits. The two-level system (Trail 1 → break-even, Trail 2 → ATR lock) is the industry-standard approach.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Recommended:</span> ON for all strategies. Turning it off means holding through intermediate drawdowns.</div></div>
        } value="">
          <Toggle value={s.useTrailingStop} onChange={v => updStop({ useTrailingStop: v })} />
        </ParamRow>
        {s.useTrailingStop && (
          <>
            <ParamRow label="Trail ATR Multiplier 1" brief={<div>Lock profit when price moves to: entry + ATR × trailMultiplier1 above entry.</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">First Trailing Stop Level</div><div>Lock profit when price moves to: entry + ATR × trailMultiplier1 above entry. At this point the stop is raised to break-even.</div><div className="mt-2">Example: ATR = $2, entry = $100. Profit lock triggers when price reaches $100 + 2×$2 = $104.</div><div className="mt-1 text-slate-500">Trail 1 must be &lt; Trail 2. Too tight (e.g. 1×) = premature lock. Too loose (e.g. 4×) = give back too much profit.</div></div>
            } value={`${s.trailAtrMultiplier1}×`}>
              <SliderInput value={s.trailAtrMultiplier1} onChange={v => updStop({ trailAtrMultiplier1: v })} min={0.5} max={8} step={0.25} suffix="×" decimals={1} />
            </ParamRow>
            <ParamRow label="Trail ATR Multiplier 2" brief={<div>After reaching Trail 1 profit, stop is tightened to lock in meaningful profit above break-even.</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Second Trailing Stop Level</div><div>After reaching Trail 1 profit, stop is tightened to: entry + trailLockMultiplier × ATR. At this level the stop locks in meaningful profit above break-even.</div><div className="mt-2">Example: ATR = $2, entry = $100, trailMultiplier2 = 4×. Profit of 8% reached → stop locks at $100 + 1×$2 = $102.</div><div className="mt-1 text-slate-500">Higher values = let winners run longer. Lower values = lock profit earlier.</div></div>
            } value={`${s.trailAtrMultiplier2}×`}>
              <SliderInput value={s.trailAtrMultiplier2} onChange={v => updStop({ trailAtrMultiplier2: v })} min={1} max={10} step={0.25} suffix="×" decimals={1} />
            </ParamRow>
          </>
        )}
      </div>

      <Divider />

      {/* Portfolio Risk */}
      <SectionHeader title="Portfolio Risk" subtitle="Circuit breakers that protect overall portfolio from prolonged drawdowns" />
      <div className="space-y-1">
        <ParamRow label="Max Drawdown Cap" brief={<div>If total portfolio equity drops by this fraction from peak, all positions are closed.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Portfolio-Level Maximum Drawdown Circuit Breaker</div><div>If total portfolio equity drops by this fraction from peak, all open positions are closed and no new entries are taken. This is the ultimate risk control mechanism.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 15-20% · <span className="text-cyan-400">Balanced:</span> 25% · <span className="text-emerald-400">Aggressive:</span> 30-40%</div><div className="mt-1 text-slate-500">Setting this &gt; 40% defeats the purpose. Most professional strategies target 20-25% as the maximum tolerable drawdown.</div></div>
        } value={`${(s.maxDrawdownCap * 100).toFixed(0)}%`}>
          <SliderInput value={s.maxDrawdownCap * 100} onChange={v => updStop({ maxDrawdownCap: v / 100 })} min={5} max={60} step={1} suffix="%" decimals={0} />
        </ParamRow>
        <ParamRow label="Position Cap" brief={<div>Even if Kelly calculation suggests a larger position, this cap limits maximum exposure.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Maximum Position Size as % of Portfolio</div><div>Even if Kelly calculation suggests a larger position, this cap limits maximum exposure to any single instrument.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 10-15% · <span className="text-cyan-400">Balanced:</span> 20-25% · <span className="text-emerald-400">Aggressive:</span> 30-50%</div><div className="mt-1 text-slate-500">Single positions &gt; 25% create concentrated risk. Warren Buffett's rule: never risk more than 2% on one idea.</div></div>
        } value={`${(s.positionCap * 100).toFixed(0)}%`}>
          <SliderInput value={s.positionCap * 100} onChange={v => updStop({ positionCap: v / 100 })} min={5} max={60} step={1} suffix="%" decimals={0} />
        </ParamRow>
      </div>

      <Divider />

      {/* Kelly */}
      <SectionHeader title="Kelly Criterion Sizing" subtitle="Mathematically optimal position sizing based on win rate and win/loss ratio" />
      <div className="space-y-1">
        <ParamRow label="Kelly Mode" brief={<div>Kelly criterion calculates the optimal fraction of capital to risk based on win rate and win/loss ratio.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Kelly Criterion Position Sizing Mode</div><div>The Kelly criterion calculates the optimal fraction of capital to risk based on your historical win rate and average win/loss ratio: K = W - (1-W)/R</div><div><span className="text-amber-400">Full Kelly:</span> 100% of mathematically optimal fraction. High edge, high variance — expect 30-50% drawdowns even with positive edge.</div><div><span className="text-cyan-400">Half Kelly:</span> 50% of Kelly. Recommended for most traders — good balance of growth and risk control.</div><div><span className="text-emerald-400">Quarter Kelly:</span> 25% of Kelly. Very conservative — appropriate for regulated funds or retirement accounts.</div><div><span className="text-slate-400">Fixed:</span> Ignore Kelly — use the fixed position size parameter regardless of edge.</div><div className="mt-1 text-slate-500">Professional tip: Even with a positive edge, Full Kelly generates extreme volatility. Most practitioners use 1/4 to 1/2 Kelly.</div></div>
        } value="">
          <SelectInput
            value={p.kellyMode}
            onChange={v => updPos({ kellyMode: v as KellyMode })}
            options={[
              { value: 'full', label: 'Full Kelly' },
              { value: 'half', label: 'Half Kelly (Recommended)' },
              { value: 'quarter', label: 'Quarter Kelly' },
              { value: 'fixed', label: 'Fixed Size' },
            ]}
          />
        </ParamRow>
        {p.kellyMode === 'fixed' && (
          <ParamRow label="Fixed Position Size" brief={<div>Used when Kelly Mode = 'Fixed'. Ignores Kelly calculation entirely.</div>} tooltip={
            <div><div className="font-semibold text-cyan-400 mb-1">Fixed Position Size %</div><div>Used when Kelly Mode = 'Fixed'. Ignores Kelly calculation entirely and uses this static % of capital per trade.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 5-10% · <span className="text-emerald-400">Active:</span> 10-20%</div></div>
          } value={`${(p.fixedPositionSize * 100).toFixed(0)}%`}>
            <SliderInput value={p.fixedPositionSize * 100} onChange={v => updPos({ fixedPositionSize: v / 100 })} min={1} max={50} step={1} suffix="%" decimals={0} />
          </ParamRow>
        )}
        <ParamRow label="Max Kelly Fraction" brief={<div>Prevents over-concentration from high-confidence signals.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Maximum Kelly Fraction to Ever Apply</div><div>Prevents over-concentration from high-confidence signals. Even if Kelly calculation suggests 80% of capital for a "perfect" signal, this cap limits it.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 10-25% · <span className="text-cyan-400">Balanced:</span> 25-35% · <span className="text-emerald-400">Aggressive:</span> 40-50%</div><div className="mt-1 text-slate-500">A 25% max Kelly fraction with Half Kelly mode means at most 12.5% of capital per trade — already significant concentration.</div></div>
        } value={`${(p.maxKellyFraction * 100).toFixed(0)}%`}>
          <SliderInput value={p.maxKellyFraction * 100} onChange={v => updPos({ maxKellyFraction: v / 100 })} min={5} max={100} step={1} suffix="%" decimals={0} />
        </ParamRow>
      </div>
    </div>
  )
}

// ─── Tab: Advanced Filters ────────────────────────────────────────────────────

interface AdvancedTabProps {
  config: StrategyConfig
  onChange: (c: StrategyConfig) => void
}

function AdvancedTab({ config, onChange }: AdvancedTabProps) {
  const o = config.optionsFilter
  const m = config.microstructureFilter

  const updOpt = (patch: Partial<typeof o>) => onChange({ ...config, optionsFilter: { ...o, ...patch } })
  const updMicro = (patch: Partial<typeof m>) => onChange({ ...config, microstructureFilter: { ...m, ...patch } })

  return (
    <div className="space-y-4">
      <SectionHeader title="Options Market Filter" subtitle="Institutional-grade filter using options market structure (requires options data feed)" />
      <div className="space-y-1">
        <ParamRow label="Use Options Filter" brief={<div>Enable options market structure filter for institutional-grade signals.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Enable Options Market Structure Filter</div><div>When enabled, additional options-market conditions (put/call ratio, gamma exposure, Vanna) must be satisfied before BUY signals are issued. These filters capture institutional flow dynamics invisible to price charts alone.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Requires:</span> Live or end-of-day options data feed (e.g. from CBOE, Tradier, or QuantConnect data)</div><div className="mt-1 text-slate-500">Expert-level filter. Disable if options data is unavailable or unreliable.</div></div>
        } value="">
          <Toggle value={o.useOptionsFilter} onChange={v => updOpt({ useOptionsFilter: v })} />
        </ParamRow>

        {o.useOptionsFilter && (
          <>
            <ParamRow label="Require Call Wall Clearance" brief={<div>Call walls act as gravitational ceilings. Price above a call wall tends to continue upward.</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Require Price Above Call Strike Wall</div><div>Call walls are clusters of call open interest at specific strikes — they act as gravitational ceilings. Price above a call wall tends to continue upward as dealers must hedge rising prices by buying stock. Requiring clearance means only buying when price has cleared this ceiling.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> ON — wait for price to clear major call walls</div><div className="text-slate-500 mt-1">Only active when Options Filter is enabled.</div></div>
            } value="">
              <Toggle value={o.requireCallWallClearance} onChange={v => updOpt({ requireCallWallClearance: v })} />
            </ParamRow>
            <ParamRow label="Require Put Wall Clearance" brief={<div>Put walls act as support floors. Price above a put wall has strong support beneath it.</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Require Price Above Put Strike Wall</div><div>Put walls (clusters of put OI) act as support floors — dealers must sell stock as price falls toward these levels, creating a natural floor. Price above a put wall has strong support beneath it.</div><div className="mt-1 text-slate-500">Only active when Options Filter is enabled.</div></div>
            } value="">
              <Toggle value={o.requirePutWallClearance} onChange={v => updOpt({ requirePutWallClearance: v })} />
            </ParamRow>
            <ParamRow label="Max Put/Call Ratio" brief={<div>P/C ratio = total put OI / total call OI. High P/C indicates hedging activity.</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Maximum Put/Call Ratio for BUY Signal</div><div>P/C ratio = total put OI / total call OI. High P/C (&gt;1) indicates hedging activity (bearish). Low P/C (&lt;0.7) indicates speculative call buying (bullish).</div><div className="mt-2 text-slate-400">&lt;0.5: Very bullish · 0.5-1.0: Neutral · &gt;1.0: Bearish (reject signal) · 2.0: Extremely bearish</div><div className="mt-1 text-slate-500">Setting max too high disables this filter effectively. Set to 0.5-0.7 for aggressive bearish filtering.</div></div>
            } value={o.maxPutCallRatio === Infinity ? '∞' : o.maxPutCallRatio.toFixed(1)}>
              <SliderInput value={Math.min(o.maxPutCallRatio === Infinity ? 3 : o.maxPutCallRatio, 3)} onChange={v => updOpt({ maxPutCallRatio: v })} min={0.1} max={3} step={0.1} suffix="" decimals={1} />
            </ParamRow>
            <ParamRow label="Min Gamma Exposure" brief={<div>Positive GEX means dealers must buy stock as price rises (bullish).</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Minimum Gamma Exposure (GEX) for BUY Signal</div><div>GEX = sum(gamma × open_interest × contract_multiplier). Positive GEX means dealers must buy stock as price rises (amplifies upward moves — bullish). Negative GEX amplifies downward moves.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 0 to +∞ (only buy when dealers are long gamma) · <span className="text-emerald-400">Relaxed:</span> Allow negative GEX entries</div><div className="mt-1 text-slate-500">Set to -Infinity to disable this filter. Requires live options Greeks data.</div></div>
            } value={o.minGammaExposure === -Infinity ? '−∞' : o.minGammaExposure.toFixed(0)}>
              <NumberInput value={o.minGammaExposure === -Infinity ? 0 : o.minGammaExposure} onChange={v => updOpt({ minGammaExposure: v })} min={-10000} max={10000} step={100} />
            </ParamRow>
            <ParamRow label="Require Positive Vanna" brief={<div>Positive Vanna means delta increases as IV increases (good for upward moves).</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Require Vanna &gt; 0 for BUY Signal</div><div>Vanna = ∂Delta/∂IV = ∂Vega/∂Spot — measures how delta changes with volatility. Positive Vanna means delta increases as IV increases (good: upward moves bring more buying pressure from dealers hedging their options books).</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> ON — require positive Vanna</div><div className="mt-1 text-slate-500">Expert-level filter. Requires options Greeks data (Bloomberg, RiskMetrics, or similar).</div></div>
            } value="">
              <Toggle value={o.requirePositiveVanna} onChange={v => updOpt({ requirePositiveVanna: v })} />
            </ParamRow>
          </>
        )}
      </div>

      <Divider />

      <SectionHeader title="Market Microstructure Filter" subtitle="Order flow and tape-reading filters (requires Level 2 / time-of-sale data)" />
      <div className="space-y-1">
        <ParamRow label="Use Microstructure Filter" brief={<div>Enable order imbalance and delta conditions before BUY signals are issued.</div>} tooltip={
          <div><div className="font-semibold text-cyan-400 mb-1">Enable Market Microstructure Filter</div><div>When enabled, order imbalance, delta, and dealer hedging bias conditions must be met before BUY signals are issued. These filters read the "tape" — actual order flow — to gauge institutional positioning.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Requires:</span> Real-time Level 2 / time-of-sale data (e.g. from a premium data provider like Tick Data LLC, Binance, or a prop firm feed)</div><div className="mt-1 text-slate-500">Expert-level filter. Most retail traders use price/volume data only. Enable only if you have reliable real-time order flow data.</div></div>
        } value="">
          <Toggle value={m.useMicrostructureFilter} onChange={v => updMicro({ useMicrostructureFilter: v })} />
        </ParamRow>

        {m.useMicrostructureFilter && (
          <>
            <ParamRow label="Max Order Imbalance" brief={<div>Imbalance = (bid_volume - ask_volume) / (bid_volume + ask_volume). +0.3 = bid side has 30% more volume.</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Maximum Order Imbalance Ratio to Allow BUY</div><div>Imbalance = (bid_volume - ask_volume) / (bid_volume + ask_volume). +0.3 = bid side has 30% more volume (bullish). Signals are rejected if imbalance &lt; -maxOrderImbalance (excessive selling pressure).</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 0.1-0.2 (only buy on strong bid-side volume) · <span className="text-emerald-400">Balanced:</span> 0.3-0.4</div><div className="mt-1 text-slate-500">This filters out entries during periods of heavy selling pressure even if all other indicators are bullish.</div></div>
            } value={m.maxOrderImbalance.toFixed(2)}>
              <SliderInput value={m.maxOrderImbalance} onChange={v => updMicro({ maxOrderImbalance: v })} min={0.05} max={1.0} step={0.05} suffix="" decimals={2} />
            </ParamRow>
            <ParamRow label="Require Positive Delta" brief={<div>Positive cumulative delta means buyers are more aggressive — a key institutional flow indicator.</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Require Cumulative Delta &gt; 0</div><div>Delta = volume traded at bid (aggressive selling) vs. ask (aggressive buying). Positive cumulative delta over the lookback period means buyers are more aggressive — a key institutional flow indicator.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> ON — requires tape to confirm buying pressure</div><div className="mt-1 text-slate-500">Even if price is rising, if delta is negative (more volume hitting bids), the move may be unsustained.</div></div>
            } value="">
              <Toggle value={m.requirePositiveDelta} onChange={v => updMicro({ requirePositiveDelta: v })} />
            </ParamRow>
            <ParamRow label="Max Dealer Hedging Bias" brief={<div>Dealer hedging bias = estimated gamma-related hedging flow (shares/day × 1000).</div>} tooltip={
              <div><div className="font-semibold text-cyan-400 mb-1">Maximum Dealer Hedging Bias for BUY Signal</div><div>Dealer hedging bias = estimated gamma-related hedging flow (shares/day × 1000). High positive bias (&gt; threshold) means dealers are long gamma and will buy on upticks — a floor. High negative bias = dealers short gamma, will sell on upticks — a ceiling.</div><div className="mt-2 text-slate-400"><span className="text-amber-400">Conservative:</span> 20-50 (only buy when dealers are heavily long gamma) · <span className="text-emerald-400">Balanced:</span> 100-200</div><div className="mt-1 text-slate-500">Units: thousands of shares/day. A bias of 100 = dealers hedging 100,000 shares/day in one direction.</div></div>
            } value={`${m.maxDealerHedgingBias}`}>
              <SliderInput value={m.maxDealerHedgingBias} onChange={v => updMicro({ maxDealerHedgingBias: v })} min={-100} max={300} step={5} suffix="" decimals={0} />
            </ParamRow>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StrategyBuilder({
  onRun,
  onReset,
  onPresetSelect,
  initialConfig,
  isRunning = false,
  uxMode = 'beginner',
}: StrategyBuilderProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('Regime & MA')
  const [config, setConfig] = useState<StrategyConfig>(() => mergeStrategyConfig(initialConfig))
  const [expertJsonOpen, setExpertJsonOpen] = useState(uxMode === 'expert')
  const [jsonDraft, setJsonDraft] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  useEffect(() => {
    setExpertJsonOpen(uxMode === 'expert')
  }, [uxMode])

  // Live quote preview state
  const [previewTicker, setPreviewTicker] = useState('AAPL')
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)

  const fetchLiveQuote = useCallback(async (ticker: string) => {
    setQuoteLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/backtest/live?tickers=${ticker}`), { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const instruments: LiveQuote[] = json.instruments ?? []
      if (instruments.length > 0) {
        const inst = instruments[0]
        setLiveQuote({
          ticker: inst.ticker ?? ticker,
          price: inst.price ?? null,
          rsi14: inst.rsi14 ?? null,
          atrPct: inst.atrPct ?? null,
          deviationPct: inst.deviationPct ?? null,
          macdHistogram: inst.macdHistogram ?? null,
          bbPercent: inst.bbPercent ?? null,
          lastDate: inst.lastDate ?? null,
        })
      }
    } catch {
      setLiveQuote(null)
    } finally {
      setQuoteLoading(false)
    }
  }, [])

  useEffect(() => {
    if (previewTicker) void fetchLiveQuote(previewTicker)
  }, [previewTicker, fetchLiveQuote])

  const handlePreset = (presetName: PresetName) => {
    try {
      const presetConfig = applyStrategyPreset(presetName)
      setConfig(presetConfig)
      onPresetSelect?.(presetName)
    } catch (e) {
      console.error('Failed to apply preset:', e)
    }
  }

  const handleReset = () => {
    setConfig(mergeStrategyConfig())
    onReset?.()
  }

  const validation = validateStrategyConfig(config)
  const canRun = validation.valid

  const renderTab = () => {
    switch (activeTab) {
      case 'Regime & MA':
        return <RegimeTab config={config} onChange={setConfig} />
      case 'Entry Signals':
        return <EntryTab config={config} onChange={setConfig} />
      case 'Risk & Sizing':
        return <RiskTab config={config} onChange={setConfig} />
      case 'Advanced Filters':
        return <AdvancedTab config={config} onChange={setConfig} />
    }
  }

  return (
    <div className="bg-slate-900/40 rounded-2xl border border-slate-800 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-white">Strategy Builder</h2>
            <p className="text-xs text-slate-500 mt-0.5">Configure institutional-grade trading strategy parameters</p>
          </div>

          {/* Preset Buttons */}
          <div className="flex flex-wrap gap-2">
            {(['Conservative', 'Balanced', 'Aggressive', 'Momentum'] as PresetName[]).map(name => (
              <button
                key={name}
                onClick={() => handlePreset(name)}
                className="px-3 py-1.5 text-[11px] rounded-lg border transition-all duration-200 font-medium"
                style={{
                  backgroundColor: name === 'Conservative' ? 'rgba(239,68,68,0.1)' :
                    name === 'Balanced' ? 'rgba(6,182,212,0.1)' :
                    name === 'Aggressive' ? 'rgba(245,158,11,0.1)' :
                    'rgba(34,197,94,0.1)',
                  borderColor: name === 'Conservative' ? 'rgba(239,68,68,0.3)' :
                    name === 'Balanced' ? 'rgba(6,182,212,0.3)' :
                    name === 'Aggressive' ? 'rgba(245,158,11,0.3)' :
                    'rgba(34,197,94,0.3)',
                  color: name === 'Conservative' ? '#fca5a5' :
                    name === 'Balanced' ? '#67e8f9' :
                    name === 'Aggressive' ? '#fcd34d' :
                    '#86efac',
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex flex-wrap gap-1 bg-slate-800/60 rounded-lg p-1 border border-slate-700/50 w-fit">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-xs rounded-md transition-all duration-200 whitespace-nowrap ${
                activeTab === tab
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Body: tabs + live preview */}
      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tab Content */}
          <div className="lg:col-span-2">
            <div
              key={activeTab}
              className="bg-slate-900/40 rounded-xl border border-slate-800 p-4 animate-in fade-in duration-200"
            >
              {renderTab()}
            </div>

            {/* Validation Errors */}
            {!canRun && validation.errors.length > 0 && (
              <div className="mt-3 bg-red-950/30 border border-red-800/50 rounded-lg p-3">
                <div className="text-xs font-semibold text-red-400 mb-1">Configuration Errors</div>
                {validation.errors.map((err, i) => (
                  <div key={i} className="text-[11px] text-red-300/70">• {err.path}: {err.message}</div>
                ))}
              </div>
            )}
            {canRun && validation.warnings.length > 0 && (
              <div className="mt-3 bg-amber-950/20 border border-amber-800/40 rounded-lg p-3">
                <div className="text-xs font-semibold text-amber-400 mb-1">Warnings</div>
                {validation.warnings.map((w, i) => (
                  <div key={i} className="text-[11px] text-amber-300/60">• {w.path}: {w.message}</div>
                ))}
              </div>
            )}

            {/* Expert: Advanced JSON */}
            <div className="mt-4 border border-slate-800 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setExpertJsonOpen(o => {
                    const next = !o
                    if (next) {
                      setJsonDraft(JSON.stringify(config, null, 2))
                      setJsonError(null)
                    }
                    return next
                  })
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/60 hover:bg-slate-800 text-xs text-slate-300"
              >
                <span>Expert · Advanced JSON</span>
                <span className="text-slate-500">{expertJsonOpen ? '▲' : '▼'}</span>
              </button>
              {expertJsonOpen && (
                <div className="p-3 space-y-2 bg-slate-950/60 border-t border-slate-800">
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Paste a partial <span className="font-mono text-slate-400">StrategyConfig</span> object. It is merged with defaults and validated before applying.
                  </p>
                  <textarea
                    value={jsonDraft}
                    onChange={e => { setJsonDraft(e.target.value); setJsonError(null) }}
                    spellCheck={false}
                    className="w-full h-44 bg-slate-900 border border-slate-700 rounded-lg p-2 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-cyan-500/40"
                  />
                  {jsonError && (
                    <pre className="text-[10px] text-red-400 whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">{jsonError}</pre>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(jsonDraft) as Partial<StrategyConfig>
                          const merged = mergeStrategyConfig(parsed)
                          const v = validateStrategyConfig(merged)
                          if (!v.valid) {
                            setJsonError(v.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
                            return
                          }
                          setJsonError(null)
                          setConfig(merged)
                          onRun(merged)
                        } catch (e) {
                          setJsonError(e instanceof Error ? e.message : 'Invalid JSON')
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30"
                    >
                      Apply & validate
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setJsonDraft(JSON.stringify(config, null, 2))
                        setJsonError(null)
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs text-slate-400 border border-slate-700 hover:bg-slate-800"
                    >
                      Reset draft from form
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => onRun(config)}
                disabled={!canRun || isRunning}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  canRun && !isRunning
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-900 shadow-lg shadow-cyan-500/20'
                    : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                {isRunning ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin" />
                    Running Backtest…
                  </span>
                ) : (
                  '▶ Run Backtest'
                )}
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 text-slate-400 text-sm rounded-lg hover:bg-slate-700 hover:text-slate-300 transition-colors"
              >
                Reset to Defaults
              </button>
            </div>
          </div>

          {/* Live Quote Preview */}
          <div>
            <LiveQuotePreview
              ticker={previewTicker}
              onTickerChange={setPreviewTicker}
              quote={liveQuote}
              loading={quoteLoading}
            />

            {/* Quick Stats */}
            <div className="mt-3 bg-slate-900/40 rounded-xl border border-slate-800 p-4">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Config Summary</div>
              <div className="space-y-1.5 text-[11px]">
                {[
                  ['Mode', config.strategyMode.strategyMode],
                  ['SMA', `${config.regime.smaPeriod}`],
                  ['Min Confirms', `${config.confirmations.minConfirmations} of 4`],
                  ['Stop', `${config.stopLoss.stopLossMode} (${config.stopLoss.stopLossAtrMultiplier}× ATR)`],
                  ['Kelly', config.positionSizing.kellyMode],
                  ['Max Position', `${(config.stopLoss.positionCap * 100).toFixed(0)}%`],
                  ['Max DD', `${(config.stopLoss.maxDrawdownCap * 100).toFixed(0)}%`],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-slate-300 font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Kelly Scale */}
            <div className="mt-3 bg-slate-900/40 rounded-xl border border-slate-800 p-4">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Kelly Confidence Scale</div>
              <div className="space-y-1.5">
                {config.positionSizing.confidenceScales.map((scale, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">{scale.confidenceThreshold}%+ confidence</span>
                    <span className="text-cyan-400 font-mono font-bold">{(scale.kellyFraction * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Max fraction</span>
                <span className="text-amber-400 font-mono font-bold">{(config.positionSizing.maxKellyFraction * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
