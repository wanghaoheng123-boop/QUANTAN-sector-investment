'use client'

import { memo } from 'react'

const TIMEFRAMES = [
  ['1m', '1m'],
  ['5m', '5m'],
  ['15m', '15m'],
  ['1h', '1H'],
  ['4h', '4H'],
  ['1d', '1D'],
  ['1w', '1W'],
  ['1M', '1M'],
] as const

export interface BtcTabBarProps {
  activeTab: 'chart' | 'quant'
  onTabChange: (tab: 'chart' | 'quant') => void
  activeRange: string
  onRangeChange: (range: string) => void
}

function BtcTabBar({ activeTab, onTabChange, activeRange, onRangeChange }: BtcTabBarProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div role="tablist" className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
        {([['chart', 'Chart'], ['quant', 'Quant Lab']] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => onTabChange(tab)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'chart' && (
        <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
          {TIMEFRAMES.map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => onRangeChange(val)}
              aria-pressed={activeRange === val}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${
                activeRange === val ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(BtcTabBar)
