'use client'

import { memo } from 'react'
import Link from 'next/link'
import type { BtcPriceSnapshot } from '@/components/crypto/hooks/useBtcPriceWs'

export interface BtcHeaderProps {
  btcPrice: BtcPriceSnapshot | null
  wsConnected: boolean
}

function BtcHeader({ btcPrice, wsConnected }: BtcHeaderProps) {
  const isUp = (btcPrice?.changePct24h ?? 0) >= 0

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
                <Link href="/" className="text-xs text-slate-500 hover:text-slate-400">
                  Markets
                </Link>
                <span className="text-slate-700 text-xs">/</span>
                <span className="text-xs text-slate-400">Crypto</span>
              </div>
              <h1 className="text-2xl font-bold text-white tracking-wide">Bitcoin (BTC)</h1>
              <p className="text-sm text-slate-400 mt-0.5">
                BTC/USD · OHLC: CoinGecko → Kraken → Coinbase · Live ticker: Coinbase · Candle stream: Kraken
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {wsConnected && (
              <div className="flex items-center gap-1.5 bg-green-500/10 px-2 py-1 rounded-md border border-green-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] text-green-400 font-medium">LIVE</span>
              </div>
            )}
            {!wsConnected && (
              <div className="flex items-center gap-1.5 bg-slate-800/50 px-2 py-1 rounded-md border border-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                <span className="text-[10px] text-slate-400 font-medium">RECONNECTING</span>
              </div>
            )}
          </div>

          <div className="flex items-start gap-4 flex-wrap">
            {btcPrice ? (
              <div className="text-right">
                <div className="text-2xl font-bold text-white font-mono">
                  ${btcPrice.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-sm font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                  {isUp ? '▲' : '▼'} {Math.abs(btcPrice.changePct24h).toFixed(2)}%
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">
                  H${btcPrice.high24h.toLocaleString('en-US', { maximumFractionDigits: 0 })} · L$
                  {btcPrice.low24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}
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
