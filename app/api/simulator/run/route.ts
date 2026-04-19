/**
 * POST /api/simulator/run
 * Real-time configurable backtest simulator using Yahoo Finance data.
 *
 * Accepts a strategy config and list of tickers, fetches OHLCV data,
 * runs the backtest engine with config-driven parameters, and returns results.
 */

import { NextResponse } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import YahooFinance from 'yahoo-finance2'
import type { OhlcvRow, BacktestResult, Trade } from '@/lib/backtest/engine'
import { TX_COST_PCT_PER_SIDE } from '@/lib/backtest/engine'
import { sma, ema, rsi, macdFn, atr, bollinger } from '@/lib/backtest/signals'
import type {
  StrategyConfig,
  StrategyMode,
  RegimeConfig,
  ConfirmationConfig,
  StopLossConfig,
  PositionSizingConfig,
} from '@/lib/strategy/strategyConfig'
import { mergeStrategyConfig, validateStrategyConfig, toBacktestConfig } from '@/lib/strategy/strategyConfig'
import { walkForwardAnalysis, walkForwardSummary, type WalkForwardSummary } from '@/lib/backtest/engine'
import {
  fetchOptionsMetrics,
  applyOptionsFilter,
  applyOptionsSignalFusion,
  type OptionsMetrics,
} from '@/lib/strategy/optionsFilter'
import { deriveEntryExitZones, type EntryExitZonesPayload } from '@/lib/quant/entryExitZones'
import { paperShortPremiumMark } from '@/lib/options/income/paperIncome'
import type { OptionsIncomeLeg } from '@/lib/options/income/types'
import { buildRunAudit, newTraceId, configHashFromObject, logRunEvent } from '@/lib/infra/runAudit'
import { clientKeyFromRequest, rateLimitHit } from '@/lib/infra/rateLimit'

// ─── Request / Response types ──────────────────────────────────────────────────

interface SimulatorRequest {
  config: Partial<StrategyConfig>
  tickers: string[]
  lookbackDays?: number
  /** When true, fetches a daily options snapshot per ticker for logging (even if options filter is off). */
  includeOptionsFeatures?: boolean
}

interface LiveQuote {
  price: number
  changePct: number
  rsi14: number | null
  atrPct: number | null
  deviationPct: number | null
  macdHist: number | null
  bbPctB: number | null
  lastFetched: string
}

// ─── Yahoo Finance with rate limiting ──────────────────────────────────────────

const quoteCache = new Map<string, { data: LiveQuote; expires: number }>()
const QUOTE_CACHE_TTL_MS = 60_000
const MAX_CONCURRENT_REQUESTS = 2
const REQUEST_BATCH_DELAY_MS = 500

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface YahooOhlcvRow {
  time: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

async function fetchYahooOhlcv(
  ticker: string,
  lookbackDays: number,
): Promise<OhlcvRow[]> {
  const yahooFinance = new YahooFinance()
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000)

  const result = await yahooFinance.chart(ticker, {
    period1: startDate.toISOString().split('T')[0],
    period2: endDate.toISOString().split('T')[0],
    interval: '1d',
  })

  if (!result.quotes || result.quotes.length === 0) return []

  return result.quotes
    .filter((q): q is typeof q & { open: number; high: number; low: number; close: number; volume: number; date: Date } =>
      q.open != null && q.high != null && q.low != null && q.close != null && q.volume != null && q.date != null,
    )
    .map(q => ({
      time: Math.floor(q.date.getTime() / 1000),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    }))
    .sort((a, b) => a.time - b.time)
}

async function fetchLiveQuote(ticker: string): Promise<LiveQuote | null> {
  const cached = quoteCache.get(ticker)
  if (cached && Date.now() < cached.expires) return cached.data

  try {
    const yahooFinance = new YahooFinance()
    const quote = await yahooFinance.quote(ticker, {
      fields: ['regularMarketPrice', 'regularMarketChangePercent'],
    })

    const price = quote.regularMarketPrice ?? 0
    const changePct = quote.regularMarketChangePercent ?? 0

    const liveQuote: LiveQuote = {
      price,
      changePct,
      rsi14: null,
      atrPct: null,
      deviationPct: null,
      macdHist: null,
      bbPctB: null,
      lastFetched: new Date().toISOString(),
    }

    quoteCache.set(ticker, { data: liveQuote, expires: Date.now() + QUOTE_CACHE_TTL_MS })
    return liveQuote
  } catch {
    return null
  }
}

async function fetchWithRateLimit<T>(
  tickers: string[],
  fetchFn: (ticker: string) => Promise<T>,
): Promise<Array<{ ticker: string; result: T | null; error?: string }>> {
  const results: Array<{ ticker: string; result: T | null; error?: string }> = []

  for (let i = 0; i < tickers.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = tickers.slice(i, i + MAX_CONCURRENT_REQUESTS)

    const batchResults = await Promise.all(
      batch.map(async ticker => {
        try {
          const result = await fetchFn(ticker)
          return { ticker, result, error: undefined }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // Yahoo Finance rate limit error code
          if (msg.includes('429') || msg.toLowerCase().includes('rate')) {
            // Wait and retry once
            await sleep(2000)
            try {
              const result = await fetchFn(ticker)
              return { ticker, result, error: undefined }
            } catch {
              return { ticker, result: null, error: msg }
            }
          }
          return { ticker, result: null, error: msg }
        }
      }),
    )

    results.push(...batchResults)

    if (i + MAX_CONCURRENT_REQUESTS < tickers.length) {
      await sleep(REQUEST_BATCH_DELAY_MS)
    }
  }

  return results
}

// ─── Sector classification ──────────────────────────────────────────────────────

function getSector(ticker: string): string {
  for (const sector of SECTORS) {
    if (sector.topHoldings.includes(ticker.toUpperCase())) {
      return sector.name
    }
  }
  return 'Custom'
}

// ─── Config-driven signal generation ───────────────────────────────────────────

interface RegimeZoneResult {
  zone: string
  dipSignal: string
  deviationPct: number | null
  slopePct: number | null
  slopePositive: boolean | null
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  label: string
}

function customRegimeSignal(
  price: number,
  closes: number[],
  rsi14: number | undefined,
  cfg: RegimeConfig,
  confirmCfg: ConfirmationConfig,
): RegimeZoneResult {
  const smaPeriod = cfg.smaPeriod
  const smaSlopeLookback = cfg.smaSlopeLookback
  const slopeThreshold = cfg.smaSlopeThreshold
  const zones = cfg.deviationZones
  const proximityThreshold = cfg.priceProximityThreshold

  if (closes.length < smaPeriod) {
    return {
      zone: 'INSUFFICIENT_DATA',
      dipSignal: 'INSUFFICIENT_DATA',
      deviationPct: null,
      slopePct: null,
      slopePositive: null,
      action: 'HOLD',
      confidence: 0,
      label: 'Insufficient Data',
    }
  }

  const smaVal = sma(closes, smaPeriod)!
  const dev = smaVal > 0 ? ((price - smaVal) / smaVal) * 100 : null

  // SMA slope
  let slopePct: number | null = null
  let slopePositive: boolean | null = null
  if (closes.length >= smaPeriod + smaSlopeLookback) {
    const prevSma = sma(closes.slice(0, closes.length - smaSlopeLookback), smaPeriod)
    if (smaVal != null && prevSma != null && prevSma > 0) {
      slopePct = (smaVal - prevSma) / prevSma
      slopePositive = slopePct > slopeThreshold
    }
  }

  // Price proximity check
  const nearSma =
    closes.slice(-Math.min(20, closes.length - smaPeriod)).some(px => {
      const d = smaVal > 0 ? Math.abs((px - smaVal) / smaVal) * 100 : Infinity
      return d <= proximityThreshold
    })

  const canBuyDip = slopePositive === true && nearSma

  // Zone classification based on custom deviation zones
  if (dev != null && dev > zones.extremeBullThreshold) {
    return {
      zone: 'EXTREME_BULL',
      dipSignal: 'OVERBOUGHT',
      deviationPct: dev,
      slopePct,
      slopePositive,
      action: 'HOLD',
      confidence: 40,
      label: 'EXTREME_BULL',
    }
  }

  if (dev != null && dev > zones.extendedBullThreshold) {
    return {
      zone: 'EXTENDED_BULL',
      dipSignal: 'OVERBOUGHT',
      deviationPct: dev,
      slopePct,
      slopePositive,
      action: 'HOLD',
      confidence: 45,
      label: 'EXTENDED_BULL',
    }
  }

  if (dev != null && dev >= zones.healthyBullThreshold) {
    return {
      zone: 'HEALTHY_BULL',
      dipSignal: 'IN_TREND',
      deviationPct: dev,
      slopePct,
      slopePositive,
      action: 'HOLD',
      confidence: 55,
      label: 'HEALTHY_BULL',
    }
  }

  if (dev != null && dev >= zones.firstDipThreshold) {
    if (canBuyDip) {
      const conf = rsi14 != null && rsi14 < confirmCfg.rsiBullThreshold ? 90 : 75
      return {
        zone: 'FIRST_DIP',
        dipSignal: 'STRONG_DIP',
        deviationPct: dev,
        slopePct,
        slopePositive,
        action: 'BUY',
        confidence: conf,
        label: 'FIRST_DIP',
      }
    }
    return {
      zone: 'FIRST_DIP',
      dipSignal: 'WATCH_DIP',
      deviationPct: dev,
      slopePct,
      slopePositive,
      action: 'HOLD',
      confidence: 35,
      label: 'FIRST_DIP',
    }
  }

  if (dev != null && dev >= zones.deepDipThreshold) {
    if (canBuyDip) {
      return {
        zone: 'DEEP_DIP',
        dipSignal: 'STRONG_DIP',
        deviationPct: dev,
        slopePct,
        slopePositive,
        action: 'BUY',
        confidence: 88,
        label: 'DEEP_DIP',
      }
    }
    return {
      zone: 'DEEP_DIP',
      dipSignal: 'FALLING_KNIFE',
      deviationPct: dev,
      slopePct,
      slopePositive,
      action: 'SELL',
      confidence: 82,
      label: 'DEEP_DIP',
    }
  }

  if (dev != null && dev >= zones.bearAlertThreshold) {
    if (canBuyDip) {
      return {
        zone: 'BEAR_ALERT',
        dipSignal: 'STRONG_DIP',
        deviationPct: dev,
        slopePct,
        slopePositive,
        action: 'BUY',
        confidence: 80,
        label: 'BEAR_ALERT',
      }
    }
    return {
      zone: 'BEAR_ALERT',
      dipSignal: 'FALLING_KNIFE',
      deviationPct: dev,
      slopePct,
      slopePositive,
      action: 'SELL',
      confidence: 90,
      label: 'BEAR_ALERT',
    }
  }

  // Crash zone
  if (canBuyDip) {
    return {
      zone: 'CRASH_ZONE',
      dipSignal: 'STRONG_DIP',
      deviationPct: dev,
      slopePct,
      slopePositive,
      action: 'BUY',
      confidence: 78,
      label: 'CRASH_ZONE',
    }
  }
  return {
    zone: 'CRASH_ZONE',
    dipSignal: 'FALLING_KNIFE',
    deviationPct: dev,
    slopePct,
    slopePositive,
    action: 'SELL',
    confidence: 95,
    label: 'CRASH_ZONE',
  }
}

interface ConfigSignal {
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  KellyFraction: number
  reason: string
  regime: RegimeZoneResult
}

function momentumSignal(
  price: number,
  closes: number[],
  volumes: number[],
  cfg: StrategyConfig,
): ConfigSignal {
  const regimeCfg = cfg.regime
  const confirmCfg = cfg.confirmations
  const modeCfg = cfg.strategyMode.momentumConfig

  const smaVal = sma(closes, regimeCfg.smaPeriod)
  const rsiVals = rsi(closes, confirmCfg.rsiPeriod)
  const rsi14 = rsiVals[rsiVals.length - 1]
  const macdVals = macdFn(closes, confirmCfg.macdFast, confirmCfg.macdSlow, confirmCfg.macdSignal)
  const macdHist = macdVals.histogram[macdVals.histogram.length - 1]

  // Price above SMA
  const priceAboveSma = smaVal != null && price > smaVal
  // SMA is rising (using slope)
  const smaValPrev = sma(closes.slice(0, -1), regimeCfg.smaPeriod)
  const smaRising = smaVal != null && smaValPrev != null && smaVal > smaValPrev * (1 + regimeCfg.smaSlopeThreshold)
  // RSI not overbought
  const rsiNotOverbought = Number.isFinite(rsi14) && rsi14 < confirmCfg.rsiBearThreshold

  // Buy when: price > SMA AND SMA rising AND RSI not overbought
  const buySignal = priceAboveSma && smaRising && rsiNotOverbought
  // Sell when: price < SMA OR RSI > bear threshold
  const sellSignal = !priceAboveSma || (Number.isFinite(rsi14) && rsi14 > confirmCfg.rsiBearThreshold)

  let action: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
  if (buySignal) action = 'BUY'
  else if (sellSignal) action = 'SELL'

  const confidence = buySignal
    ? Math.min(100, 60 + (rsiNotOverbought ? 20 : 0) + (smaRising ? 10 : 0))
    : sellSignal
    ? 70
    : 50

  const kellyFrac = getKellyFraction(action, confidence, cfg.positionSizing)

  const reason = action === 'BUY'
    ? `Momentum: price > SMA(${regimeCfg.smaPeriod}), SMA rising, RSI(${rsi14?.toFixed(1)}) not overbought. Kelly ${(kellyFrac * 100).toFixed(0)}%.`
    : action === 'SELL'
    ? `Momentum exit: price < SMA or RSI overbought.`
    : `Momentum: conditions not met.`

  return {
    action,
    confidence,
    KellyFraction: kellyFrac,
    reason,
    regime: {
      zone: action === 'BUY' ? 'MOMENTUM_BUY' : action === 'SELL' ? 'MOMENTUM_SELL' : 'MOMENTUM_WAIT',
      dipSignal: 'NONE',
      deviationPct: smaVal != null ? ((price - smaVal) / smaVal) * 100 : null,
      slopePct: smaVal != null && smaValPrev != null ? (smaVal - smaValPrev) / smaValPrev : null,
      slopePositive: smaRising,
      action,
      confidence,
      label: `MOMENTUM_${action}`,
    },
  }
}

function meanRevSignal(
  price: number,
  closes: number[],
  cfg: StrategyConfig,
): ConfigSignal {
  const regimeCfg = cfg.regime
  const modeCfg = cfg.strategyMode.meanRevConfig

  const lookback = modeCfg.meanRevLookback
  if (closes.length < lookback) {
    return {
      action: 'HOLD',
      confidence: 0,
      KellyFraction: 0,
      reason: 'Mean Rev: insufficient data.',
      regime: {
        zone: 'INSUFFICIENT_DATA',
        dipSignal: 'INSUFFICIENT_DATA',
        deviationPct: null,
        slopePct: null,
        slopePositive: null,
        action: 'HOLD',
        confidence: 0,
        label: 'Insufficient Data',
      },
    }
  }

  const meanVal = sma(closes, lookback)!
  const diffs = closes.slice(-lookback).map(c => c - meanVal)
  const stdDev = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / (lookback - 1))
  const zScore = stdDev > 0 ? (price - meanVal) / stdDev : 0

  const entryZScore = modeCfg.meanRevEntryZScore

  // Buy when z-score < -entryZScore (oversold reversion)
  // Sell when z-score > entryZScore (overbought reversion)
  // Exit when z-score crosses 0
  let action: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
  let confidence = 50
  let reason = `Mean Rev: z-score ${zScore.toFixed(2)} near mean. Hold.`

  if (zScore < -entryZScore) {
    action = 'BUY'
    confidence = Math.min(95, 70 + Math.round(Math.abs(zScore) * 10))
    reason = `Mean Rev: z-score ${zScore.toFixed(2)} < -${entryZScore}. Oversold reversion. Kelly 15%.`
  } else if (zScore > entryZScore) {
    action = 'SELL'
    confidence = 75
    reason = `Mean Rev: z-score ${zScore.toFixed(2)} > ${entryZScore}. Overbought.`
  } else if (Math.abs(zScore) < 0.5) {
    // Near mean — exit if in position
    action = 'SELL'
    confidence = 60
    reason = `Mean Rev: z-score ${zScore.toFixed(2)} near 0. Exiting position.`
  }

  return {
    action,
    confidence,
    KellyFraction: 0.15,
    reason,
    regime: {
      zone: `MEAN_REV_${action}`,
      dipSignal: zScore < -entryZScore ? 'OVERSOld' : zScore > entryZScore ? 'OVERBOUGHT' : 'NEUTRAL',
      deviationPct: meanVal > 0 ? ((price - meanVal) / meanVal) * 100 : null,
      slopePct: null,
      slopePositive: null,
      action,
      confidence,
      label: `MEAN_REV_${action}`,
    },
  }
}

function breakoutSignal(
  price: number,
  closes: number[],
  volumes: number[],
  bars: Array<{ high: number; low: number }>,
  cfg: StrategyConfig,
): ConfigSignal {
  const regimeCfg = cfg.regime
  const modeCfg = cfg.strategyMode.breakoutConfig

  const lookback = modeCfg.breakoutLookback
  if (closes.length < lookback + 1) {
    return {
      action: 'HOLD',
      confidence: 0,
      KellyFraction: 0,
      reason: 'Breakout: insufficient data.',
      regime: {
        zone: 'INSUFFICIENT_DATA',
        dipSignal: 'INSUFFICIENT_DATA',
        deviationPct: null,
        slopePct: null,
        slopePositive: null,
        action: 'HOLD',
        confidence: 0,
        label: 'Insufficient Data',
      },
    }
  }

  const recentHighs = bars.slice(-lookback - 1, -1).map(b => b.high)
  const recentLows = bars.slice(-lookback - 1, -1).map(b => b.low)
  const highestHigh = Math.max(...recentHighs)
  const lowestLow = Math.min(...recentLows)

  const recentVolumes = volumes.slice(-lookback - 1, -1)
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / lookback
  const currentVolume = volumes[volumes.length - 1]

  // Buy when: price breaks above highest high AND volume > avg * multiplier
  const priceBreakout = price > highestHigh
  const volumeConfirm = currentVolume > avgVolume * modeCfg.breakoutVolumeMultiplier

  // Sell when: price breaks below lowest low
  const priceBreakdown = price < lowestLow

  let action: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
  let confidence = 50
  let reason = `Breakout: no signal. High ${highestHigh.toFixed(2)}, Low ${lowestLow.toFixed(2)}.`

  if (priceBreakout && volumeConfirm) {
    action = 'BUY'
    confidence = Math.min(90, 60 + (volumeConfirm ? 20 : 0))
    reason = `Breakout: price ${price.toFixed(2)} above high ${highestHigh.toFixed(2)} with volume ${(currentVolume / avgVolume).toFixed(1)}x avg.`
  } else if (priceBreakdown) {
    action = 'SELL'
    confidence = 75
    reason = `Breakout: price ${price.toFixed(2)} below low ${lowestLow.toFixed(2)}. Exit.`
  }

  const kellyFrac = getKellyFraction(action, confidence, cfg.positionSizing)

  return {
    action,
    confidence,
    KellyFraction: kellyFrac,
    reason,
    regime: {
      zone: `BREAKOUT_${action}`,
      dipSignal: priceBreakout ? 'BREAKOUT' : priceBreakdown ? 'BREAKDOWN' : 'WAIT',
      deviationPct: null,
      slopePct: null,
      slopePositive: null,
      action,
      confidence,
      label: `BREAKOUT_${action}`,
    },
  }
}

function getKellyFraction(
  action: 'BUY' | 'HOLD' | 'SELL',
  confidence: number,
  positionCfg: PositionSizingConfig,
): number {
  if (action !== 'BUY') return action === 'SELL' ? 1.0 : 0

  const maxKelly = positionCfg.maxKellyFraction

  if (positionCfg.kellyMode === 'fixed') {
    return Math.min(maxKelly, positionCfg.fixedPositionSize)
  }

  let kelly = 0.10 // default base

  const sortedScales = [...positionCfg.confidenceScales].sort(
    (a, b) => b.confidenceThreshold - a.confidenceThreshold,
  )
  for (const scale of sortedScales) {
    if (confidence >= scale.confidenceThreshold) {
      kelly = scale.kellyFraction
    }
  }

  if (positionCfg.kellyMode === 'half') kelly *= 0.5
  else if (positionCfg.kellyMode === 'quarter') kelly *= 0.25

  return Math.min(maxKelly, kelly)
}

// ─── Simulator backtest engine ────────────────────────────────────────────────

interface SimulatorPortfolioState {
  capital: number
  position: number
  avgCost: number
  peakEquity: number
  equityHistory: number[]
  dailyReturns: number[]
  closedTrades: Trade[]
  openTrade: Trade | null
  tradeWins: number
  tradeLosses: number
  grossProfit: number
  grossLoss: number
  confidenceSum: number
  confidenceCount: number
}

function newSimulatorPortfolio(initialCapital: number): SimulatorPortfolioState {
  return {
    capital: initialCapital,
    position: 0,
    avgCost: 0,
    peakEquity: initialCapital,
    equityHistory: [initialCapital],
    dailyReturns: [],
    closedTrades: [],
    openTrade: null,
    tradeWins: 0,
    tradeLosses: 0,
    grossProfit: 0,
    grossLoss: 0,
    confidenceSum: 0,
    confidenceCount: 0,
  }
}

function currentSimulatorEquity(state: SimulatorPortfolioState): number {
  return state.capital + state.position * state.avgCost
}

function runSimulator(
  ticker: string,
  sector: string,
  rows: OhlcvRow[],
  config: StrategyConfig,
  optionsMetrics: OptionsMetrics | null = null,
): BacktestResult {
  const initialCapital = config.display?.initialCapital ?? 100_000
  const stopCfg = config.stopLoss
  const btCfg = toBacktestConfig(config)
  const regimeWarmup = config.backtestPeriod?.warmupBars ?? config.regime.smaPeriod + 10

  if (rows.length < regimeWarmup + 2) {
    return {
      ticker,
      sector,
      initialPrice: rows[0]?.close ?? 0,
      finalPrice: rows[rows.length - 1]?.close ?? 0,
      totalReturn: 0,
      annualizedReturn: 0,
      sharpeRatio: null,
      sortinoRatio: null,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
      avgTradeReturn: 0,
      totalTrades: 0,
      closedTrades: [],
      openTrade: null,
      dailyReturns: [],
      equityCurve: [initialCapital],
      days: rows.length,
      confidenceAvg: 0,
      stopLossPct: stopCfg.stopLossFloor,
      bnhReturn: 0,
      excessReturn: 0,
    }
  }

  let state = newSimulatorPortfolio(initialCapital)
  const closes = rows.map(r => r.close)
  const volumes = rows.map(r => r.volume)
  const bars: Array<{ open: number; high: number; low: number; close: number }> = rows.map(
    ({ open, high, low, close }) => ({ open, high, low, close }),
  )
  const atrVals = atr(bars, stopCfg.stopLossAtrPeriod)
  const txCostPct = (config.transactionCosts?.txCostBpsPerSide ?? 11) / 10000
  const entrySlippageBps = config.transactionCosts?.entrySlippageBps ?? 2

  for (let i = regimeWarmup; i < rows.length - 1; i++) {
    const signalDate = new Date(rows[i].time * 1000).toISOString().split('T')[0]
    const signalPrice = rows[i].close
    const nextOpen = rows[i + 1].open
    const lookbackCloses = closes.slice(0, i + 1)
    const lookbackVolumes = volumes.slice(0, i + 1)
    const lookbackBars = bars.slice(0, i + 1)

    // ATR-adaptive stop
    if (state.openTrade) {
      const atrAtEntry = state.openTrade.atrAtrPctAtEntry ?? 0.10
      const atrStopPct = Math.max(
        stopCfg.stopLossFloor,
        Math.min(stopCfg.stopLossCeiling, stopCfg.stopLossAtrMultiplier * atrAtEntry),
      )
      const stopPx =
        state.openTrade.action === 'BUY'
          ? state.openTrade.entryPrice * (1 - atrStopPct)
          : state.openTrade.entryPrice * (1 + atrStopPct)

      // Trailing stop logic
      if (state.openTrade.action === 'BUY') {
        const peakPrice = state.openTrade.highestPriceAfterEntry ?? state.openTrade.entryPrice
        state.openTrade.highestPriceAfterEntry = Math.max(peakPrice, signalPrice)
        const profitFromEntry = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
        const atrAtEntryDollar = ((state.openTrade.atrAtrPctAtEntry ?? 10) / 100) * state.openTrade.entryPrice
        const twoAtrProfit = (2 * atrAtEntryDollar) / state.openTrade.entryPrice
        const fourAtrProfit = (4 * atrAtEntryDollar) / state.openTrade.entryPrice

        if (profitFromEntry >= twoAtrProfit) {
          const trailStopPx = state.openTrade.entryPrice * (1 + 0.005)
          if (signalPrice <= trailStopPx) {
            const proceeds = state.position * signalPrice
            const netProceeds = proceeds - proceeds * txCostPct
            const pnlPct = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.capital += netProceeds
            state.openTrade.exitPrice = signalPrice
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentSimulatorEquity(state))
            continue
          }
        }
        if (profitFromEntry >= fourAtrProfit) {
          const lockStopPx = state.openTrade.entryPrice + atrAtEntryDollar
          if (signalPrice <= lockStopPx) {
            const proceeds = state.position * signalPrice
            const netProceeds = proceeds - proceeds * txCostPct
            const pnlPct = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.capital += netProceeds
            state.openTrade.exitPrice = signalPrice
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentSimulatorEquity(state))
            continue
          }
        }
      }

      // Stop-loss trigger
      if (
        (state.openTrade.action === 'BUY' && signalPrice <= stopPx) ||
        (state.openTrade.action === 'SELL' && signalPrice >= stopPx)
      ) {
        const proceeds = state.position * signalPrice
        const netProceeds = proceeds - proceeds * txCostPct
        const pnlPct =
          state.openTrade.action === 'BUY'
            ? (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
            : (state.openTrade.entryPrice - signalPrice) / state.openTrade.entryPrice
        if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
        else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
        state.capital += netProceeds
        state.openTrade.exitPrice = signalPrice
        state.openTrade.pnlPct = pnlPct
        state.closedTrades.push({ ...state.openTrade })
        state.position = 0; state.avgCost = 0; state.openTrade = null
        state.equityHistory.push(currentSimulatorEquity(state))
        continue
      }
    }

    // Portfolio drawdown circuit breaker
    const eq = currentSimulatorEquity(state)
    if (eq > state.peakEquity) state.peakEquity = eq
    const dd = (state.peakEquity - eq) / state.peakEquity
    if (dd >= btCfg.maxDrawdownCap && state.openTrade) {
      const proceeds = state.position * signalPrice
      const netProceeds = proceeds - proceeds * txCostPct
      const pnlPct =
        state.openTrade.action === 'BUY'
          ? (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
          : (state.openTrade.entryPrice - signalPrice) / state.openTrade.entryPrice
      if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
      else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
      state.capital += netProceeds
      state.openTrade.exitPrice = signalPrice
      state.openTrade.pnlPct = pnlPct
      state.closedTrades.push({ ...state.openTrade })
      state.position = 0; state.avgCost = 0; state.openTrade = null
      state.equityHistory.push(currentSimulatorEquity(state))
      continue
    }

    // Signal generation based on strategy mode
    const strategyMode: StrategyMode = config.strategyMode?.strategyMode ?? 'regime'
    const confirmCfg = config.confirmations
    const rsiVals = rsi(lookbackCloses, confirmCfg.rsiPeriod)
    const rsi14 = rsiVals[rsiVals.length - 1]

    let sig: ConfigSignal

    if (strategyMode === 'momentum') {
      sig = momentumSignal(signalPrice, lookbackCloses, lookbackVolumes, config)
    } else if (strategyMode === 'mean_reversion') {
      sig = meanRevSignal(signalPrice, lookbackCloses, config)
    } else if (strategyMode === 'breakout') {
      sig = breakoutSignal(signalPrice, lookbackCloses, lookbackVolumes, lookbackBars, config)
    } else {
      // regime mode — use custom regime signal
      const regime = customRegimeSignal(signalPrice, lookbackCloses, rsi14, config.regime, config.confirmations)

      // Confirmation signals
      const macdVals = macdFn(lookbackCloses, confirmCfg.macdFast, confirmCfg.macdSlow, confirmCfg.macdSignal)
      const macdHist = macdVals.histogram[macdVals.histogram.length - 1]
      const atrLast = atrVals[i]
      const atrPct = Number.isFinite(atrLast) && signalPrice > 0 ? (atrLast / signalPrice) * 100 : NaN
      const bbVals = bollinger(lookbackCloses, confirmCfg.bbPeriod, confirmCfg.bbStdDev)
      const bbPctB = bbVals.pctB[bbVals.pctB.length - 1]

      const rsiBullish = Number.isFinite(rsi14) && rsi14 < confirmCfg.rsiBullThreshold
      const macdBullish = Number.isFinite(macdHist) && macdHist > 0
      const atrBullish = Number.isFinite(atrPct) && atrPct > confirmCfg.atrBullThreshold
      const bbBullish = Number.isFinite(bbPctB) && bbPctB < confirmCfg.bbBullThreshold

      const bullishCount =
        (rsiBullish ? 1 : 0) +
        (macdBullish ? 1 : 0) +
        (atrBullish ? 1 : 0) +
        (bbBullish ? 1 : 0)

      let action: 'BUY' | 'HOLD' | 'SELL' = regime.action
      if (action === 'BUY' && bullishCount < confirmCfg.minConfirmations) {
        action = 'HOLD'
      }
      if (action === 'HOLD' && regime.zone === 'HEALTHY_BULL' && Number.isFinite(rsi14) && rsi14 > confirmCfg.rsiBearThreshold) {
        action = 'SELL'
      }

      const confidence = Math.min(100, regime.confidence + Math.round((bullishCount / 4) * 25))
      const kellyFrac = getKellyFraction(action, confidence, config.positionSizing)

      sig = {
        action,
        confidence,
        KellyFraction: kellyFrac,
        reason: `${regime.label}: ${regime.dipSignal}. Confidence ${confidence}%. Kelly ${(kellyFrac * 100).toFixed(0)}%.`,
        regime,
      }
    }

    if (sig.action === 'BUY' && !state.openTrade) {
      // Apply options filter before entering position
      const optionsFilterResult = applyOptionsFilter(
        config.optionsFilter,
        optionsMetrics,
        signalPrice,
      )
      if (!optionsFilterResult.pass) {
        state.equityHistory.push(currentSimulatorEquity(state))
        continue
      }

      const fusionResult = applyOptionsSignalFusion(
        config.optionsSignalFusion,
        optionsMetrics,
        signalPrice,
      )
      if (!fusionResult.pass) {
        state.equityHistory.push(currentSimulatorEquity(state))
        continue
      }

      const posCap = stopCfg.positionCap ?? 0.25
      const rbCap = config.riskBudget?.maxPositionCap
      const effCap = rbCap != null && Number.isFinite(rbCap) ? Math.min(posCap, rbCap) : posCap
      const kellyFrac = Math.min(sig.KellyFraction, effCap)
      const allocation = state.capital * kellyFrac
      const entryPrice = nextOpen * (1 + entrySlippageBps / 10000)
      const shares = Math.floor(allocation / entryPrice)
      if (shares <= 0) {
        state.equityHistory.push(currentSimulatorEquity(state))
        continue
      }
      const costBasis = shares * entryPrice
      const txCost = costBasis * txCostPct
      state.capital -= costBasis + txCost
      state.position += shares
      state.avgCost = entryPrice
      state.openTrade = {
        date: signalDate,
        ticker,
        sector,
        action: 'BUY',
        entryPrice: entryPrice,
        exitPrice: 0,
        shares,
        value: costBasis,
        regime: sig.regime.label,
        dipSignal: sig.regime.dipSignal,
        confidence: sig.confidence,
        pnlPct: null,
        reason: sig.reason,
        atrAtrPctAtEntry: Number.isFinite(atrVals[i]) ? (atrVals[i] / signalPrice) * 100 : 0.10,
        highestPriceAfterEntry: entryPrice,
      }
      state.confidenceSum += sig.confidence
      state.confidenceCount++
      state.equityHistory.push(currentSimulatorEquity(state))

    } else if (sig.action === 'SELL' && state.openTrade) {
      const proceeds = state.position * signalPrice
      const netProceeds = proceeds - proceeds * txCostPct
      const pnlPct = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
      if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
      else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
      state.capital += netProceeds
      state.openTrade.exitPrice = signalPrice
      state.openTrade.pnlPct = pnlPct
      state.closedTrades.push({ ...state.openTrade })
      state.position = 0; state.avgCost = 0; state.openTrade = null
      state.equityHistory.push(currentSimulatorEquity(state))

    } else {
      state.equityHistory.push(currentSimulatorEquity(state))
    }
  }

  // Close final position
  const finalPrice = rows[rows.length - 1].close
  if (state.openTrade) {
    const proceeds = state.position * finalPrice
    const netProceeds = proceeds - proceeds * txCostPct
    const pnlPct = (finalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
    if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
    else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
    state.capital += netProceeds
    state.openTrade.exitPrice = finalPrice
    state.openTrade.pnlPct = pnlPct
    state.closedTrades.push({ ...state.openTrade })
    state.position = 0
  }

  const finalEquity = state.capital
  const days = rows.length
  const years = days / 252
  const totalReturn = (finalEquity - initialCapital) / initialCapital
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0
  const bnhReturn = (finalPrice - rows[0].close) / rows[0].close

  // Max drawdown
  let peak = initialCapital, maxDd = 0
  for (const eq of state.equityHistory) {
    if (eq > peak) peak = eq
    const d = (peak - eq) / peak
    if (d > maxDd) maxDd = d
  }

  // Daily returns
  const dailyReturns: number[] = []
  for (let i = 1; i < state.equityHistory.length; i++) {
    const ret = (state.equityHistory[i] - state.equityHistory[i - 1]) / state.equityHistory[i - 1]
    if (Number.isFinite(ret)) dailyReturns.push(ret)
  }

  const closed = state.closedTrades
  const winRate = closed.length > 0 ? state.tradeWins / closed.length : 0
  const profitFactor = state.grossLoss > 0 ? state.grossProfit / state.grossLoss : state.grossProfit > 0 ? Infinity : 0
  const avgTradeReturn = closed.length > 0 ? closed.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / closed.length : 0

  // Sharpe
  let sharpe: number | null = null
  if (dailyReturns.length > 30) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const v = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(v, 0))
    if (sd > 1e-10) {
      const rfD = 0.04 / 252
      sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
    }
  }

  // Sortino
  let sortino: number | null = null
  if (dailyReturns.length > 30) {
    const rfD = 0.04 / 252
    const negDevs = dailyReturns.map(r => Math.min(0, r - rfD)).filter(x => x < 0)
    if (negDevs.length > 0) {
      const n = dailyReturns.length
      const downsideVariance = negDevs.reduce((s, x) => s + x * x, 0) / n
      const dsd = Math.sqrt(downsideVariance)
      if (dsd > 1e-10) {
        const mean = dailyReturns.reduce((a, b) => a + b, 0) / n
        sortino = ((mean - rfD) / dsd) * Math.sqrt(252)
      }
    }
  }

  return {
    ticker,
    sector,
    initialPrice: rows[0].close,
    finalPrice,
    totalReturn,
    annualizedReturn,
    sharpeRatio: Number.isFinite(sharpe) ? sharpe : null,
    sortinoRatio: Number.isFinite(sortino) ? sortino : null,
    maxDrawdown: maxDd,
    winRate,
    profitFactor,
    avgTradeReturn,
    totalTrades: closed.length,
    closedTrades: closed,
    openTrade: null,
    dailyReturns,
    equityCurve: state.equityHistory,
    days,
    confidenceAvg: state.confidenceCount > 0 ? state.confidenceSum / state.confidenceCount : 0,
    stopLossPct: stopCfg.stopLossFloor,
    bnhReturn,
    excessReturn: totalReturn - bnhReturn,
  }
}

// ─── Portfolio aggregator ──────────────────────────────────────────────────────

function aggregateSimulatorPortfolio(
  results: BacktestResult[],
  initialCapital: number,
) {
  const allTrades = results.flatMap(r => r.closedTrades)
  const winningTrades = allTrades.filter(t => (t.pnlPct ?? 0) > 0)
  const winRate = allTrades.length > 0 ? winningTrades.length / allTrades.length : 0
  const grossProfit = winningTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0)
  const grossLoss = Math.abs(
    allTrades.filter(t => (t.pnlPct ?? 0) < 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0),
  )
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const avgTradeReturn =
    allTrades.length > 0
      ? allTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / allTrades.length
      : 0

  const maxLen =
    results.length > 0 ? Math.max(...results.map(r => r.equityCurve.length)) : 0

  let sharpe: number | null = null
  let sortino: number | null = null
  let combinedFinalEquity = 0
  let combinedInitialEquity = 0

  if (maxLen > 30 && results.length > 0) {
    const combinedEquity: number[] = new Array(maxLen).fill(0)
    for (const r of results) {
      const curve = r.equityCurve
      if (curve.length === 0) continue
      const lastVal = curve[curve.length - 1]
      for (let i = 0; i < maxLen; i++) {
        combinedEquity[i] += i < curve.length ? curve[i] : lastVal
      }
    }

    const firstValid = combinedEquity.findIndex(v => v > 0)
    const lastValid = combinedEquity.length - 1 - [...combinedEquity].reverse().findIndex(v => v > 0)
    if (firstValid >= 0 && lastValid >= firstValid) {
      combinedInitialEquity = combinedEquity[firstValid]
      combinedFinalEquity = combinedEquity[lastValid]
      const totalReturn = (combinedFinalEquity - combinedInitialEquity) / combinedInitialEquity
      const years = (lastValid - firstValid) / 252
      const annReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0

      const portfolioDailyReturns: number[] = []
      for (let i = firstValid + 1; i <= lastValid; i++) {
        if (combinedEquity[i - 1] > 0) {
          const ret = (combinedEquity[i] - combinedEquity[i - 1]) / combinedEquity[i - 1]
          if (Number.isFinite(ret)) portfolioDailyReturns.push(ret)
        }
      }

      if (portfolioDailyReturns.length > 30) {
        const n = portfolioDailyReturns.length
        const mean = portfolioDailyReturns.reduce((a, b) => a + b, 0) / n
        const variance = portfolioDailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1)
        const sd = Math.sqrt(Math.max(variance, 0))
        const rfD = 0.04 / 252
        if (sd > 1e-10) sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
        const negDevs = portfolioDailyReturns.map(r => Math.min(0, r - rfD)).filter(x => x < 0)
        if (negDevs.length > 0) {
          const downsideVariance = negDevs.reduce((s, x) => s + x * x, 0) / n
          const dsd = Math.sqrt(downsideVariance)
          if (dsd > 1e-10) sortino = ((mean - rfD) / dsd) * Math.sqrt(252)
        }
      }
    }
  }

  const maxDrawdown = Math.max(...results.map(r => r.maxDrawdown), 0)
  const bnhAvg = results.reduce((s, r) => s + r.bnhReturn, 0) / Math.max(results.length, 1)
  const portfolioReturn = combinedInitialEquity > 0
    ? (combinedFinalEquity - combinedInitialEquity) / combinedInitialEquity
    : 0
  const alpha = portfolioReturn - bnhAvg

  return {
    avgReturn: portfolioReturn,
    avgAnnReturn: results.reduce((s, r) => s + r.annualizedReturn, 0) / Math.max(results.length, 1),
    bnhAvg,
    alpha,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    maxPortfolioDd: maxDrawdown,
    winRate,
    profitFactor,
    avgTradeReturn,
    totalTrades: allTrades.length,
    totalInstruments: results.length,
    initialCapital: combinedInitialEquity || initialCapital,
    finalCapital: combinedFinalEquity || initialCapital,
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      supportedModes: ['regime', 'momentum', 'mean_reversion', 'breakout'] as const,
      defaultLookbackDays: 1260,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}

export async function POST(request: Request) {
  if (rateLimitHit(`simulator:${clientKeyFromRequest(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many simulator requests — try again shortly.' }, { status: 429 })
  }

  let body: SimulatorRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { config: partialConfig, tickers, lookbackDays, includeOptionsFeatures } = body

  if (!Array.isArray(tickers) || tickers.length === 0) {
    return NextResponse.json({ error: 'tickers must be a non-empty array' }, { status: 400 })
  }

  const config: StrategyConfig = mergeStrategyConfig(partialConfig)

  // Validate config
  const validation = validateStrategyConfig(config)
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Invalid strategy config', validation },
      { status: 400 },
    )
  }

  const days = lookbackDays ?? config.backtestPeriod.lookbackYears * 252
  const traceId = newTraceId('sim')
  const runId = traceId

  // Fetch OHLCV data for all tickers
  const ohlcvResults = await fetchWithRateLimit(tickers, t => fetchYahooOhlcv(t, days))

  const tickerInfos: Array<{ ticker: string; sector: string; candles: number; success: boolean; error?: string }> = []
  const results: BacktestResult[] = []
  const tickersWithData: string[] = []
  const walkForwardByTicker: Record<string, WalkForwardSummary | null> = {}
  const paperAdvisory: Record<string, { csp: string; cc: string }> = {}
  const optionsFeaturesByTicker: Record<string, Record<string, number | string | null>> = {}
  const entryExitZonesByTicker: Record<string, EntryExitZonesPayload> = {}
  const paperIncomePreview: Record<string, { pnl: string; detail: string }> = {}

  const useOptionsFilter = config.optionsFilter?.useOptionsFilter ?? false
  const includeFeatures = includeOptionsFeatures === true
  const needOptionsData =
    useOptionsFilter || config.optionsSignalFusion.enabled || includeFeatures
  let optionsMetricsMap: Record<string, OptionsMetrics | null> = {}

  if (needOptionsData) {
    const optionsResults = await fetchWithRateLimit(tickers, t => fetchOptionsMetrics(t))
    for (const { ticker, result } of optionsResults) {
      optionsMetricsMap[ticker] = result
    }
  }

  const btCfg = toBacktestConfig(config)
  const MIN_WF = 315

  for (const { ticker, result: rows, error } of ohlcvResults) {
    const sector = getSector(ticker)
    if (!rows || rows.length === 0) {
      tickerInfos.push({ ticker, sector, candles: 0, success: false, error: error ?? 'No data' })
      continue
    }
    tickerInfos.push({ ticker, sector, candles: rows.length, success: true })
    tickersWithData.push(ticker)

    try {
      const optionsMetrics = optionsMetricsMap[ticker] ?? null
      const result = runSimulator(ticker, sector, rows, config, optionsMetrics)
      results.push(result)
      walkForwardByTicker[ticker] =
        rows.length >= MIN_WF
          ? walkForwardSummary(walkForwardAnalysis(ticker, sector, rows, 252, 63, btCfg))
          : null
      if (optionsMetrics) {
        optionsFeaturesByTicker[ticker] = {
          asOf: new Date().toISOString(),
          spotPrice: optionsMetrics.spotPrice,
          gammaFlipStrike: optionsMetrics.gammaFlipStrike,
          callWallStrike: optionsMetrics.callWallStrike,
          putWallStrike: optionsMetrics.putWallStrike,
          maxPainStrike: optionsMetrics.maxPainStrike,
          totalGammaExposure: optionsMetrics.totalGammaExposure,
          putCallRatio: optionsMetrics.putCallRatio,
        }
      }

      const closes = rows.map(r => r.close)
      const barsForAtr = rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
      const regimeSmaVal = sma(closes, config.regime.smaPeriod)
      const atrSeries = atr(barsForAtr, config.stopLoss.stopLossAtrPeriod)
      const lastAtr = atrSeries[atrSeries.length - 1]
      const lastClose = rows[rows.length - 1].close
      const atrPct =
        Number.isFinite(lastAtr) && lastClose > 0 ? (lastAtr / lastClose) * 100 : null
      entryExitZonesByTicker[ticker] = deriveEntryExitZones({
        spot: lastClose,
        regimeSma: regimeSmaVal,
        atrPct,
        putWallStrike: optionsMetrics?.putWallStrike ?? null,
        callWallStrike: optionsMetrics?.callWallStrike ?? null,
      })

      if (useOptionsFilter && optionsMetrics) {
        paperAdvisory[ticker] = {
          csp:
            `Paper cash-secured put (advisory only, not in equity PnL): spot ~${optionsMetrics.spotPrice.toFixed(2)}; put wall ~${optionsMetrics.putWallStrike ?? 'n/a'}. IV may be stale; no assignment model.`,
          cc: `Paper covered call (advisory only): max pain ~${optionsMetrics.maxPainStrike ?? 'n/a'}; call wall ~${optionsMetrics.callWallStrike ?? 'n/a'}.`,
        }
      }

      if (optionsMetrics?.putWallStrike != null && Number.isFinite(optionsMetrics.putWallStrike)) {
        const leg: OptionsIncomeLeg = {
          id: `${ticker}_csp_preview`,
          kind: 'csp',
          underlying: ticker,
          premiumPerShare: Math.max(0.01, optionsMetrics.spotPrice * 0.008),
          shortStrike: optionsMetrics.putWallStrike,
          longStrike: null,
          expiryIso: new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0],
          contracts: 1,
          collateralCash: optionsMetrics.putWallStrike * 100,
        }
        paperIncomePreview[ticker] = paperShortPremiumMark(leg, lastClose, { allowAssignment: false })
      }
    } catch (e) {
      console.error(`[simulator/run] Error running ${ticker}:`, e)
      tickerInfos.push({ ticker, sector, candles: rows.length, success: false, error: String(e) })
    }
  }

  const portfolio = aggregateSimulatorPortfolio(results, config.display?.initialCapital ?? 100_000)

  // Fetch live quotes for display
  const liveQuotes: Record<string, LiveQuote> = {}
  const quoteResults = await fetchWithRateLimit(tickersWithData, t => fetchLiveQuote(t))
  for (const { ticker, result: quote } of quoteResults) {
    if (quote) liveQuotes[ticker] = quote
  }

  let firstBarUnix: number | undefined
  let lastBarUnix: number | undefined
  for (const row of ohlcvResults) {
    if (row.result && row.result.length > 1) {
      firstBarUnix = row.result[0].time
      lastBarUnix = row.result[row.result.length - 1].time
      break
    }
  }

  const audit = buildRunAudit({
    runId: traceId,
    traceId,
    configHash: configHashFromObject(config),
    dataWindow:
      firstBarUnix != null && lastBarUnix != null ? { firstBarUnix, lastBarUnix } : undefined,
    iterationsRun: results.length,
    dataSource: 'yahoo_finance',
  })

  logRunEvent('info', 'simulator_complete', {
    traceId,
    runId: traceId,
    iterationsRun: results.length,
    dataSource: 'yahoo_finance',
  })

  return NextResponse.json(
    {
      runId,
      traceId,
      computedAt: new Date().toISOString(),
      dataSource: 'yahoo_finance',
      audit,
      config,
      tickers: tickerInfos,
      results,
      portfolio,
      validation: validation.valid
        ? undefined
        : { valid: false, errors: validation.errors, warnings: validation.warnings },
      liveQuotes,
      walkForwardByTicker,
      paperAdvisory: Object.keys(paperAdvisory).length > 0 ? paperAdvisory : undefined,
      optionsFeaturesByTicker:
        Object.keys(optionsFeaturesByTicker).length > 0 ? optionsFeaturesByTicker : undefined,
      entryExitZonesByTicker:
        Object.keys(entryExitZonesByTicker).length > 0 ? entryExitZonesByTicker : undefined,
      paperIncomePreview:
        Object.keys(paperIncomePreview).length > 0 ? paperIncomePreview : undefined,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
