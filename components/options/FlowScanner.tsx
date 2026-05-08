'use client'

import type { UnusualFlowItem, FlowSentimentLabel } from '@/lib/options/flow'
import { MetricTooltip } from '@/components/MetricTooltip'

const HEADER_TOOLTIPS: Record<string, string> = {
  Volume: 'volSma',
  OI: 'openInterest',
  'Vol/OI': 'volumeToOI',
  IV: 'iv',
  Sentiment: 'flowSentiment',
}

interface Props {
  items: UnusualFlowItem[]
  sentiment: FlowSentimentLabel
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}

function SentimentBadge({ label }: { label: FlowSentimentLabel }) {
  const cls =
    label === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
    label === 'BEARISH' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
    'bg-gray-500/20 text-gray-400 border-gray-500/30'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  )
}

export default function FlowScanner({ items, sentiment }: Props) {
  if (items.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500 text-sm">
        No unusual flow detected for this expiry.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Overall sentiment */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-400 inline-flex items-center">
          Overall flow sentiment:<MetricTooltip metricKey="flowSentiment" compact />
        </span>
        <SentimentBadge label={sentiment} />
        <span className="text-gray-500">({items.length} unusual contracts)</span>
      </div>

      {/* Flow table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          {/* F6.4 (Phase 13 S2): caption + scope for screen readers — WCAG 1.3.1. */}
          <caption className="sr-only">Unusual options flow — contract symbol, side (call or put), strike, expiry, volume, open interest, volume-over-OI ratio, implied volatility, last price, and aggregated sentiment.</caption>
          <thead>
            <tr className="border-b border-gray-700 text-gray-500">
              <th scope="col" className="text-left py-1 px-2">Contract</th>
              <th scope="col" className="text-center py-1 px-2">Type</th>
              <th scope="col" className="text-right py-1 px-2">Strike</th>
              <th scope="col" className="text-right py-1 px-2">Expiry</th>
              {(['Volume', 'OI', 'Vol/OI', 'IV'] as const).map((h) => (
                <th key={h} scope="col" className="text-right py-1 px-2">
                  <span className="inline-flex items-center justify-end">
                    {h}<MetricTooltip metricKey={HEADER_TOOLTIPS[h]} compact />
                  </span>
                </th>
              ))}
              <th scope="col" className="text-right py-1 px-2">Last</th>
              <th scope="col" className="text-center py-1 px-2">
                <span className="inline-flex items-center justify-center">
                  Sentiment<MetricTooltip metricKey="flowSentiment" compact />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 20).map((item) => (
              <tr key={item.contractSymbol} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-1 px-2 font-mono text-gray-400 text-xs">{item.contractSymbol}</td>
                <td className="py-1 px-2 text-center">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    item.side === 'CALL'
                      ? 'bg-emerald-900/40 text-emerald-400'
                      : 'bg-red-900/40 text-red-400'
                  }`}>
                    {item.side}
                  </span>
                </td>
                <td className="py-1 px-2 text-right font-mono text-gray-300">${item.strike}</td>
                <td className="py-1 px-2 text-right text-gray-400">
                  {item.expiration.toISOString().slice(0, 10)}
                </td>
                <td className="py-1 px-2 text-right font-mono text-gray-200">{fmtVol(item.volume)}</td>
                <td className="py-1 px-2 text-right font-mono text-gray-400">
                  {item.openInterest > 0 ? fmtVol(item.openInterest) : '—'}
                </td>
                <td className="py-1 px-2 text-right font-mono text-yellow-400">
                  {item.volumeToOI === Infinity ? '∞' : item.volumeToOI.toFixed(1)}x
                </td>
                <td className="py-1 px-2 text-right font-mono text-gray-400">
                  {(item.impliedVolatility * 100).toFixed(1)}%
                </td>
                <td className="py-1 px-2 text-right font-mono text-gray-300">
                  ${item.lastPrice.toFixed(2)}
                </td>
                <td className="py-1 px-2 text-center">
                  <SentimentBadge label={item.sentiment} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 20 && (
        <p className="text-xs text-gray-600">Showing top 20 of {items.length} unusual contracts.</p>
      )}
    </div>
  )
}
