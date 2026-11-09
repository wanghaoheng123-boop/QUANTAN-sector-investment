'use client'

import { memo, useEffect, useState } from 'react'
import Link from 'next/link'
import { priceFeedBadge, type BtcPriceFeed, type BtcPriceSnapshot, type FeedBadge } from '@/lib/btcSnapshot'

export interface BtcHeaderProps {
  btcPrice: BtcPriceSnapshot | null
  /** Which source delivered the price and when (useBtcPriceWs), not the candle socket. */
  feed: BtcPriceFeed | null
}

/** How often the badge re-reads the clock, so an age and a STALE state appear without a new price. */
const BADGE_TICK_MS = 5_000

const BADGE_STYLE: Record<FeedBadge['state'], { box: string; dot: string; text: string }> = {
  live: { box: 'bg-green-500/10 border-green-500/20', dot: 'bg-green-400 animate-pulse', text: 'text-green-400' },
  delayed: { box: 'bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-400', text: 'text-amber-300' },
  stale: { box: 'bg-red-500/10 border-red-500/30', dot: 'bg-red-400', text: 'text-red-300' },
  connecting: { box: 'bg-slate-800/50 border-slate-700', dot: 'bg-slate-500', text: 'text-slate-400' },
}

const fmtWhole = (v: number | null) => (v == null ? '—' : `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)

function BtcHeader({ btcPrice, feed }: BtcHeaderProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    setNowMs(Date.now())
    const id = setInterval(() => setNowMs(Date.now()), BADGE_TICK_MS)
    return () => clearInterval(id)
  }, [feed])
  const badge = priceFeedBadge(feed, nowMs)
  const style = BADGE_STYLE[badge.state]
  // Q-157: a missing 24h change is "—", never a measured "▲ 0.00%".
  const pct = btcPrice?.changePct24h ?? null

  return (
    <div
      className="border-b border-slate-800 py-6"
      style={{ background: 'linear-gradient(180deg, #f7931a08 0%, transparent 100%)' }}
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold text-white bg-[#f7931a20] border border-[#f7931a40]">
              ₿
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
                  Markets
                </Link>
                <span className="text-slate-700 text-xs" aria-hidden="true">/</span>
                <span className="text-xs text-slate-400">Crypto</span>
              </div>
              <h1 className="text-2xl font-bold text-white tracking-wide">Bitcoin (BTC)</h1>
              <p className="text-sm text-slate-400 mt-0.5">
                BTC/USD · OHLC: CoinGecko → Kraken → Coinbase · Live ticker: Coinbase · Candle stream: Kraken
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div role="status" title={badge.title} aria-label={`Price feed: ${badge.label}. ${badge.title}`} className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${style.box}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
              <span className={`text-[10px] font-medium ${style.text}`}>{badge.label}</span>
            </div>
          </div>

          <div className="flex items-start gap-4 flex-wrap">
            {btcPrice ? (
              <div className="text-right">
                <div className="text-2xl font-bold text-white font-mono">
                  ${btcPrice.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {pct == null ? (
                  <div className="text-sm font-mono text-slate-400">— (no change data)</div>
                ) : (
                  <div className={`text-sm font-mono ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
                  </div>
                )}
                <div className="text-[10px] text-slate-400 mt-1 font-mono">
                  H {fmtWhole(btcPrice.high24h)} · L {fmtWhole(btcPrice.low24h)}
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-right w-36">
                <div className="h-7 bg-slate-800 rounded animate-pulse" />
                <div className="h-5 bg-slate-800 rounded animate-pulse" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(BtcHeader)
