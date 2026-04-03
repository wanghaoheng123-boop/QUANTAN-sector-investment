'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import GammaWallChart from '@/components/options/GammaWallChart'

// ─── Types ─────────────────────────────────────────────────────────────────

interface GammaStrikeLevel {
  strike: number
  callGamma: number
  putGamma: number
  netGamma: number
  callOi: number
  putOi: number
  callVolume: number
  putVolume: number
}

interface OptionsChainData {
  ticker: string
  spotPrice: number
  quoteTime: string
  quoteChange: number
  quoteChangePct: number
  fiftyTwoWeekHigh: number
  fiftyTwoWeekLow: number
  expiryCount: number
  nearTermExpiry: { date: string; daysToExpiry: number; atmStrike: number } | null
  putCallRatio: number
  putCallVolumeRatio: number
  gamma: {
    totalGammaExposure: number
    netDelta: number
    totalVega: number
    totalTheta: number
    gammaFlipStrike: number
    maxPainStrike: number
    callWallStrike: number
    callWallStrength: number
    putWallStrike: number
    putWallStrength: number
    vannaExposure: number
    charmExposure: number
    zeroGammaLower: number
    zeroGammaUpper: number
    highestCallOiStrike: number
    highestPutOiStrike: number
  }
  interpretation: {
    dealerPosture: string
    hedgingBias: string
    volSignal: string
    marketImplication: string
    confidence: string
  }
  gammaLadder: GammaStrikeLevel[]
  dataVerification: {
    source: string
    timestamp: string
    confidence: number
    methodology: string
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTs(ts: string): string {
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(d)
}

function formatLargeNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(2)
}

function pctDistance(a: number, b: number): string {
  const pct = ((a - b) / b) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function ivRegime(gamma: OptionsChainData['gamma']): { label: string; color: string; note: string } {
  const gexNormalized = gamma.totalGammaExposure / Math.max(1, gamma.netDelta)
  if (gexNormalized > 10) return { label: 'LOW VOL REGIME', color: 'text-green-400', note: 'GEX elevated vs delta — dealers stabilized, low vol environment' }
  if (gexNormalized < 2 && Math.abs(gamma.netDelta) > gamma.totalGammaExposure) return { label: 'ELEVATED / CRUSH RISK', color: 'text-red-400', note: 'High theta burn relative to gamma — IV crush risk on expiry' }
  if (Math.abs(gamma.vannaExposure) > 0.5) return { label: 'HIGH VANNA', color: 'text-amber-400', note: 'Delta sensitive to vol changes — watch vol moves carefully' }
  return { label: 'NORMAL', color: 'text-cyan-400', note: 'Balanced greeks — standard options environment' }
}

// ─── Tab Components ─────────────────────────────────────────────────────────

function GaugeMeter({ value, max, label, unit, positiveLabel, negativeLabel, color }: {
  value: number
  max: number
  label: string
  unit: string
  positiveLabel: string
  negativeLabel: string
  color: string
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const isPositive = value >= 0

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{label}</div>
      <div className={`text-3xl font-black font-mono ${color}`}>
        {isPositive ? '+' : ''}{value.toFixed(4)}
        <span className="text-xs text-slate-500 ml-1">{unit}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-slate-400 leading-relaxed">
        {isPositive ? positiveLabel : negativeLabel}
      </div>
    </div>
  )
}

interface GreeksTabProps { gamma: OptionsChainData['gamma']; nearTermExpiry: OptionsChainData['nearTermExpiry'] }
function GreeksTab({ gamma, nearTermExpiry }: GreeksTabProps) {
  const regime = ivRegime(gamma)
  const atmStrike = nearTermExpiry?.atmStrike ?? 0

  return (
    <div className="space-y-6">
      {/* IV Regime Banner */}
      <div className={`rounded-xl border p-4 ${regime.color.replace('text-', 'border-').replace('-400', '-500/30')} ${regime.color.replace('text-', 'bg-').replace('-400', '-400/5')}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-lg font-bold ${regime.color}`}>{regime.label}</div>
            <div className="text-xs text-slate-400 mt-1">{regime.note}</div>
          </div>
          {nearTermExpiry && (
            <div className="text-right">
              <div className="text-[10px] text-slate-500">ATM Strike</div>
              <div className="text-lg font-bold font-mono text-white">${atmStrike.toFixed(2)}</div>
              <div className="text-[10px] text-slate-500">{nearTermExpiry.daysToExpiry}D to expiry</div>
            </div>
          )}
        </div>
      </div>

      {/* Greeks Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Delta', value: gamma.netDelta, unit: 'shares equiv', note: 'Net delta exposure', color: 'text-cyan-400', accent: gamma.netDelta >= 0 ? 'border-cyan-500/30' : 'border-red-500/30' },
          { label: 'Gamma', value: gamma.totalGammaExposure, unit: 'shares equiv', note: 'Total gamma exposure', color: 'text-purple-400', accent: 'border-purple-500/30' },
          { label: 'Theta', value: gamma.totalTheta, unit: '/day burn', note: 'Daily time decay', color: 'text-amber-400', accent: 'border-amber-500/30' },
          { label: 'Vega', value: gamma.totalVega, unit: '/1% vol', note: 'Vol sensitivity', color: 'text-blue-400', accent: 'border-blue-500/30' },
          { label: 'Rho', value: 0, unit: '/1% rate', note: 'Interest rate sensitivity', color: 'text-slate-400', accent: 'border-slate-500/30' },
        ].map(item => (
          <div key={item.label} className={`rounded-xl border bg-slate-900/60 p-4 ${item.accent}`}>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">{item.label}</div>
            <div className={`text-xl font-black font-mono mt-1 ${item.color}`}>
              {item.label === 'Delta' || item.label === 'Gamma' || item.label === 'Vega'
                ? formatLargeNumber(item.value)
                : item.label === 'Theta'
                ? `${(item.value / 1_000_000).toFixed(1)}M`
                : '—'}
            </div>
            <div className="text-[9px] text-slate-600 mt-0.5">{item.unit}</div>
            <div className="text-[9px] text-slate-500 mt-1">{item.note}</div>
          </div>
        ))}
      </div>

      {/* Interpretation */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-xs font-bold text-white mb-2">Greeks Interpretation</div>
        <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
          <p>
            <span className="text-cyan-400 font-mono">{formatLargeNumber(gamma.netDelta)}</span> net delta means dealers are {' '}
            {gamma.netDelta >= 0 ? 'long the underlying (hedging buys support on dips)' : 'short the underlying (hedging sells into rips)'}.
          </p>
          <p>
            <span className="text-amber-400 font-mono">{(gamma.totalTheta / 1_000_000).toFixed(1)}M</span> in daily theta means option premium sellers collect
            this much per day — providing a gravitational pull toward max pain.
          </p>
          <p>
            {nearTermExpiry && nearTermExpiry.daysToExpiry <= 7
              ? `⚡ Near-term expiry (${nearTermExpiry.daysToExpiry}D) amplifies gamma effects — strikes near ATM have maximum hedging impact.`
              : `Expiry in ${nearTermExpiry?.daysToExpiry ?? '—'} days — gamma exposure is spread across the chain.`}
          </p>
        </div>
      </div>
    </div>
  )
}

interface GammaWallTabProps { data: OptionsChainData }
function GammaWallTab({ data }: GammaWallTabProps) {
  const { gamma, spotPrice } = data
  const dealersLong = gamma.totalGammaExposure > Math.abs(gamma.netDelta * 2)
  const flipDist = pctDistance(gamma.gammaFlipStrike, spotPrice)
  const callWallDist = pctDistance(gamma.callWallStrike, spotPrice)
  const putWallDist = pctDistance(gamma.putWallStrike, spotPrice)
  const maxPainDist = pctDistance(gamma.maxPainStrike, spotPrice)

  const gexLabel = dealersLong ? 'DEALERS LONG GAMMA — STABILIZING' : 'DEALERS SHORT GAMMA — DESTABILIZING'
  const gexColor = dealersLong ? 'text-cyan-400' : 'text-orange-400'

  return (
    <div className="space-y-6">
      {/* Gamma Wall Chart */}
      <GammaWallChart
        analysis={{
          gammaLadder: data.gammaLadder,
          spotPrice: spotPrice,
          callWallStrike: gamma.callWallStrike,
          putWallStrike: gamma.putWallStrike,
          gammaFlipStrike: gamma.gammaFlipStrike,
          maxPainStrike: gamma.maxPainStrike,
          totalGammaExposure: gamma.totalGammaExposure,
        }}
        currentPrice={spotPrice}
      />

      {/* Key Gamma Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total GEX', value: `${(gamma.totalGammaExposure / 1_000_000).toFixed(1)}M`, note: 'shares equiv', color: 'text-white', accent: 'border-slate-600' },
          { label: 'Gamma Flip', value: `$${gamma.gammaFlipStrike.toFixed(2)}`, note: flipDist, color: 'text-purple-400', accent: 'border-purple-500/30' },
          { label: 'Call Wall', value: `$${gamma.callWallStrike.toFixed(2)}`, note: callWallDist, color: 'text-red-400', accent: 'border-red-500/30' },
          { label: 'Put Wall', value: `$${gamma.putWallStrike.toFixed(2)}`, note: putWallDist, color: 'text-green-400', accent: 'border-green-500/30' },
          { label: 'Max Pain', value: `$${gamma.maxPainStrike.toFixed(2)}`, note: maxPainDist, color: 'text-amber-400', accent: 'border-amber-500/30' },
        ].map(item => (
          <div key={item.label} className={`rounded-xl border bg-slate-900/60 p-3 text-center ${item.accent}`}>
            <div className="text-[9px] text-slate-500">{item.label}</div>
            <div className={`text-lg font-bold font-mono mt-1 ${item.color}`}>{item.value}</div>
            <div className="text-[9px] text-slate-600 mt-0.5">{item.note}</div>
          </div>
        ))}
      </div>

      {/* What Does This Mean Panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-xs font-bold text-white mb-3">What Does This Mean for Trading?</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs leading-relaxed">
          <div className="space-y-1">
            <div className="text-slate-400 font-medium">Call Wall (Ceiling)</div>
            <p className="text-slate-500">
              Dealers sold calls above <span className="text-red-400 font-mono">${gamma.callWallStrike.toFixed(2)}</span>.
              If price rallies here, dealers must <span className="text-red-400">sell stock</span> to hedge — capping upside.
            </p>
          </div>
          <div className="space-y-1">
            <div className="text-slate-400 font-medium">Put Wall (Floor)</div>
            <p className="text-slate-500">
              Dealers sold puts below <span className="text-green-400 font-mono">${gamma.putWallStrike.toFixed(2)}</span>.
              If price drops here, dealers must <span className="text-green-400">buy stock</span> to hedge — supporting dips.
            </p>
          </div>
          <div className="space-y-1">
            <div className={`font-medium ${gexColor}`}>{gexLabel}</div>
            <p className="text-slate-500">
              {dealersLong
                ? 'High GEX near spot creates stabilizing feedback — dealers hedge against moves, reducing volatility.'
                : 'Low GEX relative to delta creates destabilizing feedback — dealers amplify moves. Watch for squeeze potential.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

interface VannaCharmTabProps { gamma: OptionsChainData['gamma']; spotPrice: number }
function VannaCharmTab({ gamma, spotPrice }: VannaCharmTabProps) {
  const vannaPos = gamma.vannaExposure >= 0

  const vannaInterpretation = vannaPos
    ? 'Positive Vanna: Rising vol increases upside pressure. Delta becomes more positive as vol rises — dealers buy more on vol up-moves, amplifying rallies.'
    : 'Negative Vanna: Rising vol increases downside pressure. Delta becomes more negative as vol rises — dealers sell more on vol up-moves, amplifying sell-offs.'

  const charmPos = gamma.charmExposure >= 0
  const charmInterpretation = charmPos
    ? 'Positive Charm: Delta accelerates toward ATM as expiry approaches — near-term options delta drift favors the direction of the trend.'
    : 'Negative Charm: Delta accelerates away from ATM as expiry approaches — near-term options delta drift may reverse trend into expiry.'

  const vannaMax = Math.max(Math.abs(gamma.vannaExposure), 0.001)
  const charmMax = Math.max(Math.abs(gamma.charmExposure), 0.001)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GaugeMeter
          value={gamma.vannaExposure}
          max={vannaMax}
          label="Vanna Exposure"
          unit="dΔ/dσ"
          positiveLabel={vannaInterpretation}
          negativeLabel={vannaInterpretation}
          color={vannaPos ? 'text-emerald-400' : 'text-red-400'}
        />
        <GaugeMeter
          value={gamma.charmExposure}
          max={charmMax}
          label="Charm Exposure"
          unit="dΔ/dt"
          positiveLabel={charmInterpretation}
          negativeLabel={charmInterpretation}
          color={charmPos ? 'text-amber-400' : 'text-blue-400'}
        />
      </div>

      {/* Detailed explanation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-xs font-bold text-white mb-2">Vanna Deep Dive</div>
          <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
            <p><span className="text-cyan-400 font-mono">dΔ/dVol</span> measures how your delta changes when implied volatility changes by 1%.</p>
            <p>When Vanna is positive: <span className="text-emerald-400">if IV rises, your position becomes more long delta</span> — accelerating gains in a rally, but also accelerating losses if IV falls.</p>
            <p>Key insight: Vanna is why a vol spike can sometimes cause a short-gamma position to get crushed even if the spot price barely moves.</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-xs font-bold text-white mb-2">Charm Deep Dive</div>
          <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
            <p><span className="text-amber-400 font-mono">dΔ/dTime</span> measures how your delta changes as time passes toward expiry, holding IV constant.</p>
            <p>Near expiry, ATM options have maximum charm — their delta bleeds toward 0.5 regardless of price action.</p>
            <p>Key insight: A position with high charm near expiry may experience delta drift even if you&apos;re right on direction — the passage of time reshapes your exposure automatically.</p>
          </div>
        </div>
      </div>

      {/* ATM Context */}
      <div className="rounded-xl border border-purple-500/30 bg-purple-400/5 p-4">
        <div className="text-xs font-bold text-white mb-2">ATM Options Context</div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Vanna and Charm effects are most pronounced for at-the-money options with 5-30 days to expiry.
          Monitor these greeks closely in the week before major expiry events — the combined delta-vol-time interaction
          can create unexpected hedging pressure from dealers.
        </p>
      </div>
    </div>
  )
}

interface PutCallRatioTabProps { putCallRatio: number; putCallVolumeRatio: number; spotPrice: number }
function PutCallRatioTab({ putCallRatio, putCallVolumeRatio, spotPrice }: PutCallRatioTabProps) {
  const ratio30DayAvg = 0.8 // illustrative — in production this would come from historical data
  const isHigh = putCallRatio > ratio30DayAvg * 1.2
  const isLow = putCallRatio < ratio30DayAvg * 0.8

  let sentiment: { label: string; color: string; emoji: string; description: string }
  if (putCallRatio > 1.2) {
    sentiment = { label: 'BEARISH BIAS', color: 'text-red-400', emoji: '🔴', description: 'P/C ratio elevated — traders are hedging downside or positioning for a correction.' }
  } else if (putCallRatio < 0.6) {
    sentiment = { label: 'BULLISH BIAS', color: 'text-green-400', emoji: '🟢', description: 'P/C ratio low — call buying dominates, bullish speculative positioning.' }
  } else {
    sentiment = { label: 'NEUTRAL', color: 'text-slate-400', emoji: '⚖️', description: 'P/C ratio near average — no strong directional conviction from options traders.' }
  }

  return (
    <div className="space-y-6">
      {/* Main ratio display */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center justify-between flex-wrap gap-6">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Put / Call Ratio (OI)</div>
            <div className={`text-5xl font-black font-mono ${sentiment.color}`}>
              {putCallRatio.toFixed(2)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              30-day avg: <span className="text-slate-400 font-mono">{ratio30DayAvg.toFixed(2)}</span>
              {isHigh ? ' — elevated vs avg' : isLow ? ' — suppressed vs avg' : ' — near avg'}
            </div>
          </div>
          <div className="text-center px-6 border-l border-slate-800">
            <div className="text-4xl">{sentiment.emoji}</div>
            <div className={`text-lg font-bold mt-1 ${sentiment.color}`}>{sentiment.label}</div>
            <div className="text-xs text-slate-500 mt-1">Based on open interest</div>
          </div>
        </div>
        <div className="mt-4 p-3 rounded-lg bg-slate-900/80 border border-slate-800">
          <p className="text-sm text-slate-300 leading-relaxed">{sentiment.description}</p>
        </div>
      </div>

      {/* Volume ratio + comparison */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center">
          <div className="text-[9px] text-slate-500">P/C Volume Ratio</div>
          <div className={`text-2xl font-bold font-mono mt-1 ${putCallVolumeRatio > 1 ? 'text-red-400' : 'text-green-400'}`}>
            {putCallVolumeRatio.toFixed(2)}
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">today&apos;s trading</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center">
          <div className="text-[9px] text-slate-500">OI vs Avg</div>
          <div className={`text-2xl font-bold font-mono mt-1 ${isHigh ? 'text-red-400' : isLow ? 'text-green-400' : 'text-cyan-400'}`}>
            {isHigh ? '+' : isLow ? '-' : ''}{Math.abs(((putCallRatio - ratio30DayAvg) / ratio30DayAvg) * 100).toFixed(0)}%
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">vs 30-day avg</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center">
          <div className="text-[9px] text-slate-500">Signal Strength</div>
          <div className={`text-2xl font-bold font-mono mt-1 ${Math.abs(putCallRatio - ratio30DayAvg) / ratio30DayAvg > 0.3 ? 'text-amber-400' : 'text-slate-300'}`}>
            {Math.abs(putCallRatio - ratio30DayAvg) / ratio30DayAvg > 0.3 ? 'STRONG' : Math.abs(putCallRatio - ratio30DayAvg) / ratio30DayAvg > 0.15 ? 'MODERATE' : 'WEAK'}
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">directional conviction</div>
        </div>
      </div>

      {/* Interpretation */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-xs font-bold text-white mb-2">Interpreting Put/Call Ratio</div>
        <div className="text-xs text-slate-400 leading-relaxed space-y-2">
          <p>
            <span className="text-slate-300 font-medium">High P/C (&gt;1.0):</span> Typically seen as bearish — traders are buying more puts (protection) than calls (speculation).
            However, it can also indicate smart money hedging large long positions.
          </p>
          <p>
            <span className="text-slate-300 font-medium">Low P/C (&lt;0.7):</span> Call buying dominates. Often seen in bull markets or before earnings.
            Watch for extreme low readings as contrarian warning signs.
          </p>
          <p>
            <span className="text-slate-300 font-medium">Volume vs OI:</span> Volume ratio shows today&apos;s trading bias; OI ratio shows strategic positioning.
            Divergence between them (volume elevated, OI suppressed) suggests speculative day-trading rather than conviction positioning.
          </p>
        </div>
      </div>
    </div>
  )
}

interface StrategyTabProps { data: OptionsChainData }
function StrategyTab({ data }: StrategyTabProps) {
  const { gamma, spotPrice, putCallRatio } = data
  const dealersLong = gamma.totalGammaExposure > Math.abs(gamma.netDelta * 2)

  const aboveCallWall = spotPrice >= gamma.callWallStrike * 0.98
  const belowPutWall = spotPrice <= gamma.putWallStrike * 1.02

  const trades = []

  if (aboveCallWall) {
    trades.push({
      type: 'CAUTION',
      color: 'text-red-400',
      bg: 'border-red-500/30 bg-red-400/5',
      title: 'Price Near Call Wall — Dealers Sold Calls Above',
      description: `Spot is within 2% of the call wall at $${gamma.callWallStrike.toFixed(2)}. Dealers wrote calls here and must sell stock if price rallies through. This acts as a ceiling.`,
      implication: 'Bullish momentum may stall. Watch for reversal signals near this level. Covered call writing may be attractive here.',
    })
  } else if (belowPutWall) {
    trades.push({
      type: 'CAUTION',
      color: 'text-green-400',
      bg: 'border-green-500/30 bg-green-400/5',
      title: 'Price Near Put Wall — Dealers Sold Puts Below',
      description: `Spot is within 2% of the put wall at $${gamma.putWallStrike.toFixed(2)}. Dealers wrote puts here and must buy stock if price drops through. This acts as a floor.`,
      implication: 'Downside may be supported. Buying puts for protection may be expensive (IV elevated). Watch for bounce setups.',
    })
  }

  if (!dealersLong) {
    trades.push({
      type: 'OPPORTUNITY',
      color: 'text-amber-400',
      bg: 'border-amber-500/30 bg-amber-400/5',
      title: 'Short Gamma Environment — Volatility Squeeze Potential',
      description: `GEX of ${(gamma.totalGammaExposure / 1_000_000).toFixed(1)}M vs net delta of ${(gamma.netDelta / 1_000_000).toFixed(1)}M indicates dealers are short gamma.`,
      implication: 'In short gamma, dealers amplify moves rather than absorb them. A catalyst could trigger a fast move in either direction. Consider straddle/strangle strategies to capture vol expansion.',
    })
  } else {
    trades.push({
      type: 'OPPORTUNITY',
      color: 'text-cyan-400',
      bg: 'border-cyan-500/30 bg-cyan-400/5',
      title: 'Long Gamma — Stability Zone',
      description: `Dealers are long gamma — they hedge in a way that dampens volatility.`,
      implication: 'Range-bound behavior likely. Selling straddles at the boundaries (call wall / put wall) may be profitable. Watch for mean reversion into max pain.',
    })
  }

  // Max pain trade
  const maxPainDistPct = ((gamma.maxPainStrike - spotPrice) / spotPrice) * 100
  trades.push({
    type: 'MECHANICS',
    color: 'text-purple-400',
    bg: 'border-purple-500/30 bg-purple-400/5',
    title: 'Max Pain Trade',
    description: `Max pain strike at $${gamma.maxPainStrike.toFixed(2)} (${maxPainDistPct >= 0 ? '+' : ''}${maxPainDistPct.toFixed(1)}% from spot).`,
    implication: Math.abs(maxPainDistPct) < 2
      ? `Price near max pain — dealers benefit most here. Options sellers have structural edge. Avoid naked directional positions near expiry.`
      : `Max pain is ${Math.abs(maxPainDistPct).toFixed(1)}% away — a rally toward max pain would pressure call buyers and put sellers. Watch for pinning risk.`,
  })

  // P/C ratio trade
  trades.push({
    type: 'SENTIMENT',
    color: putCallRatio > 1 ? 'text-red-400' : 'text-green-400',
    bg: putCallRatio > 1 ? 'border-red-500/30 bg-red-400/5' : 'border-green-500/30 bg-green-400/5',
    title: `P/C Ratio: ${putCallRatio.toFixed(2)} — ${putCallRatio > 1 ? 'Bearish Bias' : 'Bullish Bias'}`,
    description: `P/C ratio ${putCallRatio > 1 ? 'elevated — hedging dominates' : 'suppressed — speculative call buying'}.`,
    implication: putCallRatio > 1
      ? 'Elevated put buying suggests either protective hedging or bearish speculation. Confirm with price action before acting on this signal alone.'
      : 'Call buying dominates — bullish speculative positioning. Extreme readings (P/C < 0.4) are contrarian warning signs.',
  })

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/20 bg-amber-400/5 p-4">
        <div className="text-xs font-bold text-white mb-2">Options-Based Trade Ideas</div>
        <div className="text-xs text-slate-400 leading-relaxed">
          These are structural observations from the options market. Always confirm with price action, fundamentals, and your own risk management before entering positions.
        </div>
      </div>

      {trades.map((trade, i) => (
        <div key={i} className={`rounded-xl border p-4 ${trade.bg}`}>
          <div className="flex items-start gap-3">
            <div className={`text-2xl font-black font-mono shrink-0 ${trade.color}`}>
              {trade.type === 'OPPORTUNITY' ? '💡' : trade.type === 'CAUTION' ? '⚠️' : '⚙️'}
            </div>
            <div className="flex-1">
              <div className={`text-sm font-bold ${trade.color}`}>{trade.title}</div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{trade.description}</p>
              <div className="mt-2 p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Implication: </span>
                <span className="text-xs text-slate-300">{trade.implication}</span>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Specific setups */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-xs font-bold text-white mb-3">Specific Trade Setups</div>
        <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
          {dealersLong && Math.abs(spotPrice - gamma.gammaFlipStrike) / spotPrice < 0.03 ? (
            <div className="p-2 rounded bg-cyan-400/5 border border-cyan-500/20">
              <span className="text-cyan-400 font-medium">Near Gamma Flip Strike:</span> When price is near the gamma flip (${gamma.gammaFlipStrike.toFixed(2)}), hedging direction is unclear. Avoid directional spread bets until price breaks above/below clearly.
            </div>
          ) : null}
          {gamma.totalTheta < -Math.abs(gamma.netDelta) * 0.05 ? (
            <div className="p-2 rounded bg-amber-400/5 border border-amber-500/20">
              <span className="text-amber-400 font-medium">High Theta Burn:</span> Daily theta of ${(Math.abs(gamma.totalTheta) / 1_000_000).toFixed(1)}M pressures the market. Consider selling premium at the wings (call wall / put wall) rather than buying.
            </div>
          ) : null}
          <div className="p-2 rounded bg-slate-800/60 border border-slate-700/50">
            <span className="text-slate-300 font-medium">Entry/Exit Logic:</span> If taking a position based on this analysis, set stops beyond the call wall (for longs) or put wall (for shorts) by 2-3%. Target max pain strike for expiry-based strategies. Exit or adjust before expiration week when gamma effects amplify.
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Loading / Error States ─────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <div className="text-slate-400 text-sm">Loading options chain...</div>
        <div className="text-slate-600 text-xs">Fetching {`{ticker}`} options data</div>
      </div>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4">📊</div>
        <div className="text-red-400 text-lg font-bold mb-2">Options Data Unavailable</div>
        <div className="text-slate-500 text-sm mb-4 leading-relaxed">{error}</div>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-lg text-sm transition-colors"
        >
          ↻ Retry
        </button>
        <div className="mt-4 text-xs text-slate-600">
          Some securities (ETFs, indices) may not have listed options available.
        </div>
      </div>
    </div>
  )
}

// ─── Main Page Component ────────────────────────────────────────────────────

export default function OptionsPage({ params }: { params: { ticker: string } }) {
  const { ticker } = params
  const [data, setData] = useState<OptionsChainData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'greeks' | 'gamma' | 'vanna' | 'pc' | 'strategy'>('greeks')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/options/chain/${encodeURIComponent(ticker)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || body.details || `HTTP ${res.status}`)
      }
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [ticker])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <LoadingState />
  if (error || !data) return <ErrorState error={error ?? 'No data returned'} onRetry={fetchData} />

  const { gamma, spotPrice, quoteChange, quoteChangePct, quoteTime, putCallRatio, putCallVolumeRatio, expiryCount } = data

  // Compute total OI from gammaLadder
  const totalCallOi = data.gammaLadder.reduce((s, l) => s + l.callOi, 0)
  const totalPutOi = data.gammaLadder.reduce((s, l) => s + l.putOi, 0)

  const changeColor = quoteChange >= 0 ? 'text-emerald-400' : 'text-red-400'
  const changeSign = quoteChange >= 0 ? '+' : ''

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'greeks', label: 'Greeks' },
    { key: 'gamma', label: 'Gamma Wall' },
    { key: 'vanna', label: 'Vanna & Charm' },
    { key: 'pc', label: 'Put/Call Ratio' },
    { key: 'strategy', label: 'Strategy' },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top nav */}
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">← Markets</Link>
            <div className="text-xl font-black font-mono text-white">{ticker}</div>
            <div className="text-sm font-mono">
              <span className="text-white">${spotPrice.toFixed(2)}</span>
              <span className={`ml-1 text-xs ${changeColor}`}>
                {changeSign}{quoteChange.toFixed(2)} ({quoteChangePct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <div className="hidden sm:block">
                <span className="text-slate-600">Exp:</span> <span className="text-slate-400">{expiryCount}</span>
                <span className="text-slate-600 ml-2">Calls OI:</span> <span className="text-cyan-400">{formatLargeNumber(totalCallOi)}</span>
                <span className="text-slate-600 ml-2">Puts OI:</span> <span className="text-amber-400">{formatLargeNumber(totalPutOi)}</span>
              </div>
            </div>
            <span>{formatTs(quoteTime)}</span>
            <button onClick={fetchData} className="hover:text-white transition-colors">↻ Refresh</button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Mobile stats bar */}
        <div className="sm:hidden grid grid-cols-3 gap-2">
          <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-center">
            <div className="text-[9px] text-slate-500">Exp</div>
            <div className="text-sm font-bold text-slate-300">{expiryCount}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-center">
            <div className="text-[9px] text-slate-500">Call OI</div>
            <div className="text-sm font-bold text-cyan-400">{formatLargeNumber(totalCallOi)}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-center">
            <div className="text-[9px] text-slate-500">Put OI</div>
            <div className="text-sm font-bold text-amber-400">{formatLargeNumber(totalPutOi)}</div>
          </div>
        </div>

        {/* 52-week context */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-slate-500">52W Range: </span>
              <span className="text-slate-400 font-mono">${data.fiftyTwoWeekLow.toFixed(2)}</span>
              <span className="text-slate-600 mx-1">—</span>
              <span className="text-slate-400 font-mono">${data.fiftyTwoWeekHigh.toFixed(2)}</span>
            </div>
            <div className="flex-1 relative h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-cyan-500 rounded-full"
                style={{ width: `${((spotPrice - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow)) * 100}%` }}
              />
              <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${((spotPrice - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow)) * 100}%` }} />
            </div>
            <div>
              <span className="text-slate-500"> </span>
              <span className={`font-mono font-bold ${changeColor}`}>{((spotPrice - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow) * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="animate-in fade-in duration-200">
          {activeTab === 'greeks' && <GreeksTab gamma={gamma} nearTermExpiry={data.nearTermExpiry} />}
          {activeTab === 'gamma' && <GammaWallTab data={data} />}
          {activeTab === 'vanna' && <VannaCharmTab gamma={gamma} spotPrice={spotPrice} />}
          {activeTab === 'pc' && <PutCallRatioTab putCallRatio={putCallRatio} putCallVolumeRatio={putCallVolumeRatio} spotPrice={spotPrice} />}
          {activeTab === 'strategy' && <StrategyTab data={data} />}
        </div>

        {/* Data attribution */}
        <div className="border-t border-slate-800 pt-4 flex items-center justify-between flex-wrap gap-2">
          <div className="text-[10px] text-slate-600">
            Source: {data.dataVerification.source} · Confidence: {(data.dataVerification.confidence * 100).toFixed(0)}% · {data.dataVerification.methodology}
          </div>
          <div className="text-[10px] text-slate-600">
            Updated: {formatTs(data.dataVerification.timestamp)}
          </div>
        </div>
      </div>
    </div>
  )
}
