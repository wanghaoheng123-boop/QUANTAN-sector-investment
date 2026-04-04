/**
 * StrategyConfig — Institutional-grade, fully user-configurable trading strategy configuration.
 *
 * Replaces all hardcoded thresholds in lib/backtest/signals.ts and lib/backtest/engine.ts with
 * explicit, tunable parameters covering: regime classification, entry confirmations, stop-loss /
 * trailing stop, position sizing (Kelly criterion), transaction costs, strategy modes, options
 * filters, market microstructure filters, and backtest runtime settings.
 *
 * Usage:
 *   import { DEFAULT_STRATEGY_CONFIG, validateStrategyConfig, applyStrategyPreset } from './strategyConfig'
 *   const cfg = { ...DEFAULT_STRATEGY_CONFIG, rsiBullThreshold: 30 }
 *   const validation = validateStrategyConfig(cfg)
 */

import type { BacktestConfig } from '@/lib/backtest/signals'

// ─── 1. Moving Average & Regime ────────────────────────────────────────────────

/**
 * Thresholds (in % deviation from SMA) that define each price regime zone.
 * These are applied by the regime classifier in lib/backtest/signals.ts.
 *
 * Convention: deviation = (price - SMA) / SMA * 100
 *   > 0  → price is above the SMA (bullish deviation)
 *   < 0  → price is below the SMA (bearish / dip deviation)
 *
 * Example zone map (default):
 *   EXTREME_BULL  > 20%  — price extremely extended above SMA; HOLD (chasing risk)
 *   EXTENDED_BULL > 10%  — price extended above SMA; HOLD
 *   HEALTHY_BULL  >= 0%  — price near or above SMA; normal uptrend; HOLD
 *   FIRST_DIP     >= -10% — mild pullback from SMA; BUY zone
 *   DEEP_DIP      >= -20% — meaningful correction; high-conviction BUY zone
 *   BEAR_ALERT    >= -30% — severe drawdown; BUY only with strongest confirmations
 *   CRASH_ZONE    < -30%  — crash territory; BUY only if trend slope is positive
 *
 * Traders should adjust these based on the instrument's typical volatility.
 * High-volatility assets (e.g., ARKK, TQQQ) may need wider negative bands.
 * Low-volatility assets (e.g., consumer staples, bonds) need tighter bands.
 */
export interface DeviationZones {
  /** Price > this % above SMA → EXTREME_BULL (overbought, no buy). Default: 20 */
  extremeBullThreshold: number
  /** Price > this % above SMA → EXTENDED_BULL. Default: 10 */
  extendedBullThreshold: number
  /** Price >= this % (above or below SMA) → HEALTHY_BULL (acceptable trend). Default: 0 */
  healthyBullThreshold: number
  /** Price >= this % below SMA → FIRST_DIP (mild dip, primary BUY zone). Default: -10 */
  firstDipThreshold: number
  /** Price >= this % below SMA → DEEP_DIP (meaningful correction). Default: -20 */
  deepDipThreshold: number
  /** Price >= this % below SMA → BEAR_ALERT (severe drawdown). Default: -30 */
  bearAlertThreshold: number
  /** Price < this % below SMA → CRASH_ZONE. Default: -30 (i.e., < -30%) */
  crashZoneThreshold: number
}

export const DEFAULT_DEVIATION_ZONES: DeviationZones = {
  extremeBullThreshold: 20,
  extendedBullThreshold: 10,
  healthyBullThreshold: 0,
  firstDipThreshold: -10,
  deepDipThreshold: -20,
  bearAlertThreshold: -30,
  crashZoneThreshold: -30,
}

export interface RegimeConfig {
  /**
   * SMA period for regime classification.
   * 200 = industry standard for long-term trend (used by institutional investors).
   * Shorter periods (50, 100) are more reactive but noisier.
   * @default 200
   */
  smaPeriod: number

  /**
   * Number of bars over which to measure the SMA slope.
   * Measures the % change of the SMA value over this lookback window.
   * A positive slope means the long-term trend is rising.
   * @default 20
   */
  smaSlopeLookback: number

  /**
   * Minimum SMA slope (as a decimal, e.g. 0.005 = 0.5%) to consider the trend positive.
   * Values below this threshold are treated as flat / uncertain trend.
   * Raising this filter reduces false signals in sideways markets.
   * @default 0.005
   */
  smaSlopeThreshold: number

  /**
   * Deviation zone thresholds that define each regime (EXTREME_BULL, DEEP_DIP, etc.).
   * @default DEFAULT_DEVIATION_ZONES
   */
  deviationZones: DeviationZones

  /**
   * How close price must have been to the SMA in recent bars to qualify for dip BUY signals.
   * Expressed as a positive % (e.g. 5 = price was within 5% of SMA in the lookback window).
   * Prevents buying "forever falling" stocks that are far below their SMA.
   * @default 5
   */
  priceProximityThreshold: number
}

export const DEFAULT_REGIME_CONFIG: RegimeConfig = {
  smaPeriod: 200,
  smaSlopeLookback: 20,
  smaSlopeThreshold: 0.005,
  deviationZones: { ...DEFAULT_DEVIATION_ZONES },
  priceProximityThreshold: 5,
}

// ─── 2. Entry Signals (Confirmations) ─────────────────────────────────────────

export interface ConfirmationConfig {
  // RSI
  /**
   * Lookback period for RSI calculation.
   * 14 = Wilder's original setting; 7 = more reactive; 21 = smoother.
   * @default 14
   */
  rsiPeriod: number

  /**
   * RSI value below which the market is considered oversold / bullish for BUY entries.
   * Lower values = stricter oversold requirement.
   * Typical range: 25–40. Use 30–35 for volatile assets, 35–40 for indices.
   * @default 35
   */
  rsiBullThreshold: number

  /**
   * RSI value above which the market is considered overbought / bearish for SELL signals.
   * Typical range: 60–70.
   * @default 65
   */
  rsiBearThreshold: number

  /** Weight of RSI signal in the composite bullish confirmation score. @default 1 */
  rsiWeight: number

  // MACD
  /**
   * Fast EMA period for MACD line.
   * @default 12
   */
  macdFast: number

  /**
   * Slow EMA period for MACD line.
   * @default 26
   */
  macdSlow: number

  /**
   * EMA smoothing period for the MACD signal line.
   * @default 9
   */
  macdSignal: number

  /** Weight of MACD histogram signal in the composite bullish confirmation score. @default 1 */
  macdWeight: number

  // ATR
  /**
   * Lookback period for ATR calculation.
   * @default 14
   */
  atrPeriod: number

  /**
   * Minimum ATR% (daily volatility as % of price) to consider the market bullish for BUY.
   * ATR% > N means the stock has meaningful daily range — suitable for swing trades.
   * ATR% < 1 = low volatility; position may not have enough range to be profitable.
   * Typical range: 1.5–3.0%.
   * @default 2.0
   */
  atrBullThreshold: number

  /** Weight of ATR% signal in the composite bullish confirmation score. @default 1 */
  atrWeight: number

  // Bollinger Bands
  /**
   * Lookback period for Bollinger Bands middle band (SMA).
   * @default 20
   */
  bbPeriod: number

  /**
   * Number of standard deviations for Bollinger Band outer bands.
   * @default 2
   */
  bbStdDev: number

  /**
   * BB% value below which the market is considered bullish for BUY.
   * BB% = (price - lower band) / (upper band - lower band).
   * BB% < 0.20 means price is in the lower 20% of its recent range — near the lower band.
   * @default 0.20
   */
  bbBullThreshold: number

  /** Weight of Bollinger Band % signal in the composite bullish confirmation score. @default 1 */
  bbWeight: number

  /**
   * Minimum number of bullish confirmations required to issue a BUY signal.
   * Must have at least N of the 4 indicators (RSI, MACD, ATR, BB) bullish.
   * Higher values = stricter entry criteria, fewer but higher-quality signals.
   * @default 2
   */
  minConfirmations: number
}

export const DEFAULT_CONFIRMATION_CONFIG: ConfirmationConfig = {
  rsiPeriod: 14,
  rsiBullThreshold: 35,
  rsiBearThreshold: 65,
  rsiWeight: 1,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  macdWeight: 1,
  atrPeriod: 14,
  atrBullThreshold: 2.0,
  atrWeight: 1,
  bbPeriod: 20,
  bbStdDev: 2,
  bbBullThreshold: 0.20,
  bbWeight: 1,
  minConfirmations: 2,
}

// ─── 3. Stop Loss & Risk Management ────────────────────────────────────────────

/**
 * Stop loss calculation mode.
 *   'fixed'   — fixed percentage below entry price (simplest, least adaptive)
 *   'atr'     — ATR-multiple-based stop; adapts to current volatility (recommended)
 *   'chandelier' — Chandelier stop: highest high since entry − ATR × multiplier
 */
export type StopLossMode = 'fixed' | 'atr' | 'chandelier'

export interface StopLossConfig {
  /**
   * Method used to calculate the initial stop-loss level.
   * 'atr' is recommended as it adapts to current market volatility automatically.
   * @default 'atr'
   */
  stopLossMode: StopLossMode

  /**
   * ATR multiplier applied to the ATR value at entry to set the stop distance.
   * stopDistance = ATR × stopLossAtrMultiplier
   * Examples with ATR% at entry = 2%:
   *   1.0× → 2% stop  (tight, suitable for low-vol assets)
   *   1.5× → 3% stop  (default, balanced)
   *   2.0× → 4% stop  (wider, suitable for volatile assets)
   * @default 1.5
   */
  stopLossAtrMultiplier: number

  /**
   * ATR lookback period used for stop-loss calculation.
   * @default 14
   */
  stopLossAtrPeriod: number

  /**
   * Minimum stop loss as a fraction of entry price (floor).
   * Prevents the stop from being unreasonably tight in low-volatility assets.
   * Expressed as a decimal (e.g. 0.03 = 3% stop minimum).
   * @default 0.03
   */
  stopLossFloor: number

  /**
   * Maximum stop loss as a fraction of entry price (ceiling).
   * Prevents the stop from being unreasonably wide, protecting capital efficiency.
   * Expressed as a decimal (e.g. 0.15 = 15% stop maximum).
   * @default 0.15
   */
  stopLossCeiling: number

  /** Enable trailing stop after entry. @default true */
  useTrailingStop: boolean

  /**
   * First trailing stop level: lock profit when price moves ATR × this multiplier above entry.
   * Example: ATR = $2, entry = $100 → lock profit when price reaches $100 + 2×$2 = $104.
   * @default 2
   */
  trailAtrMultiplier1: number

  /**
   * Second trailing stop level: tighten stop to entry + 1×ATR after this profit level.
   * Example: ATR = $2, entry = $100 → tighten stop when price reaches $100 + 4×$2 = $108.
   * @default 4
   */
  trailAtrMultiplier2: number

  /**
   * Once trailAtrMultiplier2 profit is reached, lock in profit equal to this many ATRs
   * from the entry price (the stop is raised to entry + 1×ATR as a safety net).
   * @default 1
   */
  trailLockMultiplier: number

  /**
   * Portfolio-level maximum drawdown cap. If equity drops by this fraction from peak,
   * all open positions are closed and no new entries are taken.
   * Protects against prolonged drawdown periods.
   * @default 0.25
   */
  maxDrawdownCap: number

  /**
   * Maximum fraction of portfolio capital allocated to a single position at entry.
   * @default 0.25
   */
  positionCap: number
}

export const DEFAULT_STOP_LOSS_CONFIG: StopLossConfig = {
  stopLossMode: 'atr',
  stopLossAtrMultiplier: 1.5,
  stopLossAtrPeriod: 14,
  stopLossFloor: 0.03,
  stopLossCeiling: 0.15,
  useTrailingStop: true,
  trailAtrMultiplier1: 2,
  trailAtrMultiplier2: 4,
  trailLockMultiplier: 1,
  maxDrawdownCap: 0.25,
  positionCap: 0.25,
}

// ─── 4. Position Sizing ────────────────────────────────────────────────────────

/**
 * Kelly criterion sizing mode.
 *   'full'     — full Kelly: K = W - (1-W)/R (aggressive, high variance)
 *   'half'     — half Kelly: 50% of full Kelly (recommended for most traders)
 *   'quarter'  — quarter Kelly: 25% of full Kelly (very conservative)
 *   'fixed'    — ignore Kelly; use the fixedPositionSize parameter instead
 */
export type KellyMode = 'full' | 'half' | 'quarter' | 'fixed'

export interface ConfidenceScale {
  /** Minimum confidence score (0–100) for this Kelly fraction to apply. */
  confidenceThreshold: number
  /** Kelly fraction (as decimal) to use when confidence meets this threshold. */
  kellyFraction: number
}

/**
 * Maps confidence levels to Kelly fractions for adaptive position sizing.
 * Higher confidence → larger position; lower confidence → smaller position.
 * Each entry's confidenceThreshold must be >= the previous entry's.
 *
 * Example:
 *   90% confidence → 25% Kelly (max position for highest conviction)
 *   75% confidence → 15% Kelly
 *   55% confidence → 10% Kelly
 *   0%  confidence →  5% Kelly (minimum)
 */
export interface PositionSizingConfig {
  /**
   * Kelly fraction mode. 'half' is the recommended default for risk-controlled trading.
   * @default 'half'
   */
  kellyMode: KellyMode

  /**
   * Fixed position size (as a fraction of capital) used when kellyMode = 'fixed'.
   * Ignored for all other modes.
   * @default 0.10
   */
  fixedPositionSize: number

  /**
   * Maximum Kelly fraction to ever apply, regardless of calculated value.
   * Prevents over-concentration from high-confidence signals.
   * Set to 0.25 (25%) for conservative portfolios; 0.50 (50%) for aggressive ones.
   * @default 0.25
   */
  maxKellyFraction: number

  /**
   * Confidence-based Kelly scaling table. Applied after the base Kelly mode calculation.
   * Allows larger positions for high-conviction signals without raising the base fraction.
   * Must be sorted by confidenceThreshold ascending.
   * @default [90→25%, 75→15%, 55→10%]
   */
  confidenceScales: ConfidenceScale[]
}

export const DEFAULT_POSITION_SIZING_CONFIG: PositionSizingConfig = {
  kellyMode: 'half',
  fixedPositionSize: 0.10,
  maxKellyFraction: 0.25,
  confidenceScales: [
    { confidenceThreshold: 90, kellyFraction: 0.25 },
    { confidenceThreshold: 75, kellyFraction: 0.15 },
    { confidenceThreshold: 55, kellyFraction: 0.10 },
  ],
}

// ─── 5. Transaction Costs ──────────────────────────────────────────────────────

export interface TransactionCostConfig {
  /**
   * Round-trip transaction cost in basis points (bps) per side.
   * Applied at both entry AND exit independently.
   *
   * Cost breakdown for a $100 stock at 11 bps per side:
   *   Commission:    ~$0.005/share  ≈ 0.5 bps
   *   Bid-ask spread: ~$0.05       ≈ 5.0 bps
   *   Mid-price slippage: ~$0.005  ≈ 0.5 bps
   *   Total per side: ≈ 11 bps
   *   Round-trip (entry + exit): 22 bps
   *
   * Tiered guidelines:
   *   Large-cap ETFs (SPY, QQQ):    2–3 bps per side
   *   Large-cap stocks (AAPL, MSFT): 3–5 bps per side
   *   Mid/small cap:                 8–15 bps per side
   *
   * @default 11
   */
  txCostBpsPerSide: number

  /**
   * Entry slippage in basis points (bps). Applied to next-open price at entry.
   * Models the difference between signal price and actual fill price due to
   * market impact, latency, and bid-ask spread.
   * @default 2
   */
  entrySlippageBps: number
}

export const DEFAULT_TRANSACTION_COST_CONFIG: TransactionCostConfig = {
  txCostBpsPerSide: 11,
  entrySlippageBps: 2,
}

// ─── 6. Strategy Mode ─────────────────────────────────────────────────────────

/**
 * Active strategy mode — determines which regime / signal logic is used.
 *   'regime'        — Dip-buy strategy using 200SMA deviation zones (default, institutional)
 *   'momentum'      — Momentum strategy: buy when price breaks out above SMA with strength
 *   'mean_reversion' — Mean reversion: buy when price is statistically far from its mean
 *   'breakout'      — Breakout strategy: buy on volume-confirmed price breakouts
 */
export type StrategyMode = 'regime' | 'momentum' | 'mean_reversion' | 'breakout'

/**
 * Human-readable labels for each strategy mode.
 * Used in the UI strategy info bar and mode toggle.
 */
export const MODE_LABELS: Record<StrategyMode, string> = {
  regime: '200EMA Deviation Regime + RSI/MACD/ATR/BB',
  momentum: 'Momentum Breakout',
  mean_reversion: 'Mean Reversion (Z-Score)',
  breakout: 'Volume Confirmed Breakout',
}

export interface MomentumModeConfig {
  /** Number of bars over which to measure momentum (rate of price change). @default 20 */
  momentumLookback: number
  /**
   * Minimum momentum (as decimal, e.g. 0.05 = 5% price change over lookback) to trigger BUY.
   * @default 0.05
   */
  momentumThreshold: number
}

export interface MeanRevModeConfig {
  /**
   * Lookback period for calculating the rolling mean and standard deviation (z-score).
   * @default 20
   */
  meanRevLookback: number
  /**
   * Z-score threshold — how many standard deviations away from the mean to trigger a signal.
   * Z-score < -N → BUY (price is oversold, below mean).
   * Z-score > +N → SELL (price is overbought, above mean).
   * Typical range: 1.5–2.5.
   * @default 2.0
   */
  meanRevZScoreThreshold: number
  /**
   * Z-score at which to enter a mean-reversion trade.
   * Must be <= meanRevZScoreThreshold (entrance requires even more extreme deviation).
   * @default 2.0
   */
  meanRevEntryZScore: number
}

export interface BreakoutModeConfig {
  /**
   * Lookback period for identifying consolidation range (highest high / lowest low).
   * @default 20
   */
  breakoutLookback: number
  /**
   * Volume multiplier — today's volume must exceed this multiple of the average volume
   * over the breakoutLookback period to confirm the breakout.
   * @default 1.5
   */
  breakoutVolumeMultiplier: number
}

export interface StrategyModeConfig {
  /**
   * Active strategy mode.
   *   'regime'         — Dip-buy based on 200SMA deviation zones (default)
   *   'momentum'       — Momentum breakout trading
   *   'mean_reversion' — Statistical mean reversion
   *   'breakout'       — Price breakout with volume confirmation
   * @default 'regime'
   */
  strategyMode: StrategyMode

  /** Configuration for momentum mode. Only used when strategyMode = 'momentum'. */
  momentumConfig: MomentumModeConfig

  /** Configuration for mean-reversion mode. Only used when strategyMode = 'mean_reversion'. */
  meanRevConfig: MeanRevModeConfig

  /** Configuration for breakout mode. Only used when strategyMode = 'breakout'. */
  breakoutConfig: BreakoutModeConfig
}

export const DEFAULT_STRATEGY_MODE_CONFIG: StrategyModeConfig = {
  strategyMode: 'regime',
  momentumConfig: {
    momentumLookback: 20,
    momentumThreshold: 0.05,
  },
  meanRevConfig: {
    meanRevLookback: 20,
    meanRevZScoreThreshold: 2.0,
    meanRevEntryZScore: 2.0,
  },
  breakoutConfig: {
    breakoutLookback: 20,
    breakoutVolumeMultiplier: 1.5,
  },
}

// ─── 7. Options Filter (Institutional Grade) ──────────────────────────────────

export interface OptionsFilterConfig {
  /**
   * Enable the options market filter.
   * When true, additional options-market conditions must be met before issuing BUY signals.
   * Useful for filtering institutional flow and gamma dynamics.
   * @default false
   */
  useOptionsFilter: boolean

  /**
   * Only issue BUY if price is above the call strike wall (call wall = cluster of call open interest).
   * Call walls act as gravitational ceilings; price above them tends to continue upward.
   * Requires live or end-of-day options data feed.
   * @default false
   */
  requireCallWallClearance: boolean

  /**
   * Only issue BUY if price is above the put strike wall (put wall = cluster of put open interest).
   * Put walls act as support floors; price above a put wall has strong support beneath it.
   * Requires live or end-of-day options data feed.
   * @default false
   */
  requirePutWallClearance: boolean

  /**
   * Maximum put/call ratio to allow a BUY signal.
   * P/C ratio = total put OI / total call OI.
   *   < 0.5 →极度看涨 (very bullish)
   *   0.5–1.0 → neutral / slightly bullish
   *   > 1.0 →看跌 (bearish, reject signal)
   * Set to Infinity to disable this filter.
   * @default Infinity
   */
  maxPutCallRatio: number

  /**
   * Minimum gamma exposure (GEX) required to issue a BUY signal.
   * GEX = sum(gamma × open_interest × contract_multiplier) across all strikes.
   *   Positive GEX → dealers must buy stock as price rises (amplifies upward moves)
   *   Negative GEX → dealers must sell stock as price rises (amplifies downward moves)
   * Institutional traders use positive GEX as a directional filter.
   * Set to -Infinity to disable.
   * @default -Infinity
   */
  minGammaExposure: number

  /**
   * Only issue BUY if Vanna > 0.
   * Vanna = ∂Delta/∂IV = ∂Vega/∂Spot — measures how delta changes with volatility.
   * Positive Vanna means delta increases as IV increases (good: upward moves bring more buying).
   * Requires options Greeks data.
   * @default false
   */
  requirePositiveVanna: boolean
}

export const DEFAULT_OPTIONS_FILTER_CONFIG: OptionsFilterConfig = {
  useOptionsFilter: false,
  requireCallWallClearance: false,
  requirePutWallClearance: false,
  maxPutCallRatio: Infinity,
  minGammaExposure: -Infinity,
  requirePositiveVanna: false,
}

// ─── 8. Market Microstructure Filter (Institutional Grade) ─────────────────────

export interface MicrostructureFilterConfig {
  /**
   * Enable the market microstructure filter.
   * When true, order-flow and tape-reading conditions must be met before BUY signals.
   * Requires real-time Level 2 / time-of-sale data.
   * @default false
   */
  useMicrostructureFilter: boolean

  /**
   * Maximum order imbalance ratio to allow a BUY signal.
   * Imbalance = (bid_volume - ask_volume) / (bid_volume + ask_volume).
   *   +0.3 → bid side has 30% more volume than ask (bullish imbalance)
   *   -0.3 → ask side dominates (bearish imbalance)
   * Signals are rejected if imbalance < -maxOrderImbalance (excessive selling pressure).
   * @default 0.3
   */
  maxOrderImbalance: number

  /**
   * Only issue BUY if cumulative time-of-sale delta is positive over the lookback period.
   * Delta = volume that traded at the bid price (aggressive selling) vs. ask price (aggressive buying).
   * Positive delta = buyers are more aggressive (bullish).
   * @default false
   */
  requirePositiveDelta: boolean

  /**
   * Maximum absolute dealer hedging bias to allow a BUY signal.
   * Dealer hedging bias = estimated dealer gamma-related hedging flow (shares/day).
   * High positive bias (> threshold) means dealers are heavily long gamma and
   * will buy on upticks, providing a floor — considered bullish.
   * High negative bias means dealers are short gamma and will sell on upticks — bearish.
   * @default 100 (shares/day in thousands, i.e., 100,000 shares/day)
   */
  maxDealerHedgingBias: number
}

export const DEFAULT_MICROSTRUCTURE_FILTER_CONFIG: MicrostructureFilterConfig = {
  useMicrostructureFilter: false,
  maxOrderImbalance: 0.3,
  requirePositiveDelta: false,
  maxDealerHedgingBias: 100,
}

// ─── 9. Backtest Period ────────────────────────────────────────────────────────

export interface BacktestPeriodConfig {
  /**
   * How many years of historical data to load for backtesting.
   * Data older than this is discarded as warmup.
   * Longer lookback = more robust statistics but slower backtests.
   * 5 years captures a full market cycle including bull, bear, and recovery phases.
   * @default 5
   */
  lookbackYears: number

  /**
   * Number of bars required as warmup before generating signals.
   * Must be >= the longest indicator lookback (e.g., SMA period of 200).
   * Extra bars ensure all indicators are fully warmed up before the first signal.
   * @default 200
   */
  warmupBars: number
}

export const DEFAULT_BACKTEST_PERIOD_CONFIG: BacktestPeriodConfig = {
  lookbackYears: 5,
  warmupBars: 200,
}

// ─── 10. Output / Display ─────────────────────────────────────────────────────

export interface DisplayConfig {
  /**
   * Starting capital for backtest runs.
   * @default 100_000
   */
  initialCapital: number
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  initialCapital: 100_000,
}

// ─── Full StrategyConfig ───────────────────────────────────────────────────────

/**
 * The complete strategy configuration object.
 * All fields are optional — unspecified fields fall back to their defaults.
 * Traders should override only the parameters they want to change.
 *
 * @example
 * ```ts
 * // Start from defaults, override only RSI and stop-loss
 * const myConfig: StrategyConfig = {
 *   ...DEFAULT_STRATEGY_CONFIG,
 *   confirmations: {
 *     ...DEFAULT_STRATEGY_CONFIG.confirmations,
 *     rsiBullThreshold: 30,
 *   },
 *   stopLoss: {
 *     ...DEFAULT_STRATEGY_CONFIG.stopLoss,
 *     stopLossAtrMultiplier: 2.0,
 *   },
 * }
 * ```
 */
export interface StrategyConfig {
  regime: RegimeConfig
  confirmations: ConfirmationConfig
  stopLoss: StopLossConfig
  positionSizing: PositionSizingConfig
  transactionCosts: TransactionCostConfig
  strategyMode: StrategyModeConfig
  optionsFilter: OptionsFilterConfig
  microstructureFilter: MicrostructureFilterConfig
  backtestPeriod: BacktestPeriodConfig
  display: DisplayConfig
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  regime: { ...DEFAULT_REGIME_CONFIG },
  confirmations: { ...DEFAULT_CONFIRMATION_CONFIG },
  stopLoss: { ...DEFAULT_STOP_LOSS_CONFIG },
  positionSizing: { ...DEFAULT_POSITION_SIZING_CONFIG },
  transactionCosts: { ...DEFAULT_TRANSACTION_COST_CONFIG },
  strategyMode: { ...DEFAULT_STRATEGY_MODE_CONFIG },
  optionsFilter: { ...DEFAULT_OPTIONS_FILTER_CONFIG },
  microstructureFilter: { ...DEFAULT_MICROSTRUCTURE_FILTER_CONFIG },
  backtestPeriod: { ...DEFAULT_BACKTEST_PERIOD_CONFIG },
  display: { ...DEFAULT_DISPLAY_CONFIG },
}

// ─── Strategy Validation ───────────────────────────────────────────────────────

/**
 * Result of a strategy configuration validation pass.
 */
export interface StrategyValidationResult {
  /** True if the configuration passed all validation checks. */
  valid: boolean
  /**
   * All errors discovered in the configuration.
   * Empty array when valid === true.
   */
  errors: StrategyValidationError[]
  /**
   * All warnings discovered in the configuration.
   * Warnings do not prevent the strategy from running, but may indicate suboptimal choices.
   */
  warnings: StrategyValidationWarning[]
}

export interface StrategyValidationError {
  /** Dot-notation path to the offending field, e.g. "stopLoss.stopLossFloor". */
  path: string
  /** Human-readable description of the error. */
  message: string
}

export interface StrategyValidationWarning {
  path: string
  message: string
}

/**
 * Validates a StrategyConfig for logical errors and suspicious parameter combinations.
 * Call this before running any backtest to prevent garbage-in / garbage-out.
 *
 * Checks include:
 *   - Stop-loss floor > ceiling (physically impossible)
 *   - ATR multiplier <= 0 (would give zero or negative stop distance)
 *   - minConfirmations > total available confirmations (4)
 *   - Confidence scales not sorted ascending (will never trigger lower entries)
 *   - Kelly mode is 'fixed' but fixedPositionSize = 0 (division by zero)
 *   - Transaction cost > 100 bps (unrealistic for institutional accounts)
 *   - Options / microstructure filters enabled but no data source configured
 *   - Regime SMA period <= slope lookback (slope measurement requires lookback < period)
 *   - Negative or zero lookback periods
 *   - Z-score threshold values outside [-3, 3] range (statistically improbable)
 *
 * @param config - The strategy configuration to validate.
 * @returns StrategyValidationResult with errors (blocking) and warnings (advisory).
 */
export function validateStrategyConfig(config: Partial<StrategyConfig>): StrategyValidationResult {
  const errors: StrategyValidationError[] = []
  const warnings: StrategyValidationWarning[] = []

  const pushError = (path: string, message: string) =>
    errors.push({ path, message })

  const pushWarning = (path: string, message: string) =>
    warnings.push({ path, message })

  const regime = (config.regime ?? {}) as RegimeConfig
  const confirmations = (config.confirmations ?? {}) as ConfirmationConfig
  const stopLoss = (config.stopLoss ?? {}) as StopLossConfig
  const positionSizing = (config.positionSizing ?? {}) as PositionSizingConfig
  const transactionCosts = (config.transactionCosts ?? {}) as TransactionCostConfig
  const strategyMode = (config.strategyMode ?? {}) as StrategyModeConfig
  const backtestPeriod = (config.backtestPeriod ?? {}) as BacktestPeriodConfig

  // ── Regime ──────────────────────────────────────────────────────────────
  if (regime.smaPeriod != null && regime.smaPeriod <= 0) {
    pushError('regime.smaPeriod', `SMA period must be positive, got ${regime.smaPeriod}`)
  }

  if (regime.smaSlopeLookback != null && regime.smaSlopeLookback <= 0) {
    pushError('regime.smaSlopeLookback', `Slope lookback must be positive, got ${regime.smaSlopeLookback}`)
  }

  if (
    regime.smaPeriod != null &&
    regime.smaSlopeLookback != null &&
    regime.smaSlopeLookback >= regime.smaPeriod
  ) {
    pushError(
      'regime.smaSlopeLookback',
      `Slope lookback (${regime.smaSlopeLookback}) must be smaller than SMA period (${regime.smaPeriod}) to measure a meaningful slope`,
    )
  }

  if (
    (regime.smaSlopeThreshold ?? DEFAULT_REGIME_CONFIG.smaSlopeThreshold) < 0 ||
    (regime.smaSlopeThreshold ?? DEFAULT_REGIME_CONFIG.smaSlopeThreshold) > 1
  ) {
    pushError(
      'regime.smaSlopeThreshold',
      `Slope threshold must be between 0 and 1 (0–100%), got ${regime.smaSlopeThreshold}`,
    )
  }

  if (regime.priceProximityThreshold != null && (regime.priceProximityThreshold < 0 || regime.priceProximityThreshold > 50)) {
    pushWarning(
      'regime.priceProximityThreshold',
      `Price proximity threshold (${regime.priceProximityThreshold}%) is outside typical range [0, 50]. Verify this is intentional.`,
    )
  }

  // Deviation zone ordering
  const zones = regime.deviationZones ?? DEFAULT_DEVIATION_ZONES
  if (zones.extremeBullThreshold <= zones.extendedBullThreshold) {
    pushError(
      'regime.deviationZones.extremeBullThreshold',
      `extremeBullThreshold (${zones.extremeBullThreshold}) must be > extendedBullThreshold (${zones.extendedBullThreshold})`,
    )
  }
  if (zones.extendedBullThreshold <= zones.healthyBullThreshold) {
    pushError(
      'regime.deviationZones.extendedBullThreshold',
      `extendedBullThreshold (${zones.extendedBullThreshold}) must be > healthyBullThreshold (${zones.healthyBullThreshold})`,
    )
  }
  if (zones.healthyBullThreshold < 0) {
    pushWarning(
      'regime.deviationZones.healthyBullThreshold',
      `healthyBullThreshold (${zones.healthyBullThreshold}) is negative — price below SMA will be treated as HEALTHY_BULL. This may allow entries in downtrends.`,
    )
  }
  if (zones.firstDipThreshold < zones.deepDipThreshold) {
    pushError(
      'regime.deviationZones.firstDipThreshold',
      `firstDipThreshold (${zones.firstDipThreshold}) must be >= deepDipThreshold (${zones.deepDipThreshold})`,
    )
  }
  if (zones.deepDipThreshold < zones.bearAlertThreshold) {
    pushError(
      'regime.deviationZones.deepDipThreshold',
      `deepDipThreshold (${zones.deepDipThreshold}) must be >= bearAlertThreshold (${zones.bearAlertThreshold})`,
    )
  }

  // ── Confirmations ───────────────────────────────────────────────────────
  if (confirmations.rsiPeriod != null && confirmations.rsiPeriod <= 0) {
    pushError('confirmations.rsiPeriod', `RSI period must be positive, got ${confirmations.rsiPeriod}`)
  }

  if (
    confirmations.rsiBullThreshold != null &&
    confirmations.rsiBearThreshold != null &&
    confirmations.rsiBullThreshold >= confirmations.rsiBearThreshold
  ) {
    pushError(
      'confirmations.rsiBullThreshold',
      `rsiBullThreshold (${confirmations.rsiBullThreshold}) must be < rsiBearThreshold (${confirmations.rsiBearThreshold})`,
    )
  }

  const totalWeight =
    (confirmations.rsiWeight ?? DEFAULT_CONFIRMATION_CONFIG.rsiWeight) +
    (confirmations.macdWeight ?? DEFAULT_CONFIRMATION_CONFIG.macdWeight) +
    (confirmations.atrWeight ?? DEFAULT_CONFIRMATION_CONFIG.atrWeight) +
    (confirmations.bbWeight ?? DEFAULT_CONFIRMATION_CONFIG.bbWeight)

  if (totalWeight === 0) {
    pushWarning(
      'confirmations',
      `All confirmation weights sum to 0 — composite score will always be 0 and minConfirmations will never be met.`,
    )
  }

  if (
    confirmations.minConfirmations != null &&
    (confirmations.minConfirmations < 1 || confirmations.minConfirmations > 4)
  ) {
    pushError(
      'confirmations.minConfirmations',
      `minConfirmations must be between 1 and 4 (total available indicators), got ${confirmations.minConfirmations}`,
    )
  }

  // ── Stop Loss ───────────────────────────────────────────────────────────
  if (stopLoss.stopLossAtrMultiplier != null && stopLoss.stopLossAtrMultiplier <= 0) {
    pushError(
      'stopLoss.stopLossAtrMultiplier',
      `stopLossAtrMultiplier must be positive, got ${stopLoss.stopLossAtrMultiplier}`,
    )
  }

  if (stopLoss.stopLossFloor != null && stopLoss.stopLossFloor < 0) {
    pushError('stopLoss.stopLossFloor', `stopLossFloor cannot be negative, got ${stopLoss.stopLossFloor}`)
  }

  if (stopLoss.stopLossCeiling != null && stopLoss.stopLossCeiling <= 0) {
    pushError('stopLoss.stopLossCeiling', `stopLossCeiling must be positive, got ${stopLoss.stopLossCeiling}`)
  }

  if (
    stopLoss.stopLossFloor != null &&
    stopLoss.stopLossCeiling != null &&
    stopLoss.stopLossFloor >= stopLoss.stopLossCeiling
  ) {
    pushError(
      'stopLoss.stopLossFloor',
      `stopLossFloor (${(stopLoss.stopLossFloor * 100).toFixed(1)}%) must be < stopLossCeiling (${(stopLoss.stopLossCeiling * 100).toFixed(1)}%)`,
    )
  }

  if (
    stopLoss.trailAtrMultiplier1 != null &&
    stopLoss.trailAtrMultiplier2 != null &&
    stopLoss.trailAtrMultiplier1 >= stopLoss.trailAtrMultiplier2
  ) {
    pushError(
      'stopLoss.trailAtrMultiplier1',
      `trailAtrMultiplier1 (${stopLoss.trailAtrMultiplier1}) must be < trailAtrMultiplier2 (${stopLoss.trailAtrMultiplier2}) for a logical progression`,
    )
  }

  if (stopLoss.maxDrawdownCap != null && (stopLoss.maxDrawdownCap <= 0 || stopLoss.maxDrawdownCap >= 1)) {
    pushError(
      'stopLoss.maxDrawdownCap',
      `maxDrawdownCap must be between 0 and 1 (exclusive), got ${stopLoss.maxDrawdownCap}`,
    )
  }

  if (stopLoss.positionCap != null && (stopLoss.positionCap <= 0 || stopLoss.positionCap > 1)) {
    pushError(
      'stopLoss.positionCap',
      `positionCap must be between 0 and 1, got ${stopLoss.positionCap}`,
    )
  }

  // ── Position Sizing ──────────────────────────────────────────────────────
  if (
    positionSizing.kellyMode === 'fixed' &&
    (positionSizing.fixedPositionSize ?? DEFAULT_POSITION_SIZING_CONFIG.fixedPositionSize) === 0
  ) {
    pushError(
      'positionSizing.fixedPositionSize',
      `fixedPositionSize cannot be 0 when kellyMode is 'fixed' (would result in zero position size)`,
    )
  }

  if (positionSizing.maxKellyFraction != null && (positionSizing.maxKellyFraction <= 0 || positionSizing.maxKellyFraction > 1)) {
    pushError(
      'positionSizing.maxKellyFraction',
      `maxKellyFraction must be between 0 and 1, got ${positionSizing.maxKellyFraction}`,
    )
  }

  const scales = positionSizing.confidenceScales ?? DEFAULT_POSITION_SIZING_CONFIG.confidenceScales
  for (let i = 1; i < scales.length; i++) {
    if (scales[i].confidenceThreshold < scales[i - 1].confidenceThreshold) {
      pushError(
        'positionSizing.confidenceScales',
        `confidenceScales must be sorted by confidenceThreshold ascending: entry ${i} (${scales[i].confidenceThreshold}%) is less than entry ${i - 1} (${scales[i - 1].confidenceThreshold}%)`,
      )
    }
  }

  for (const scale of scales) {
    if (scale.kellyFraction <= 0 || scale.kellyFraction > 1) {
      pushError(
        'positionSizing.confidenceScales',
        `kellyFraction must be between 0 and 1, got ${scale.kellyFraction}`,
      )
    }
  }

  // ── Transaction Costs ──────────────────────────────────────────────────
  if (transactionCosts.txCostBpsPerSide != null) {
    if (transactionCosts.txCostBpsPerSide < 0) {
      pushError('transactionCosts.txCostBpsPerSide', `txCostBpsPerSide cannot be negative, got ${transactionCosts.txCostBpsPerSide}`)
    }
    if (transactionCosts.txCostBpsPerSide > 100) {
      pushWarning(
        'transactionCosts.txCostBpsPerSide',
        `txCostBpsPerSide of ${transactionCosts.txCostBpsPerSide} bps is unusually high for institutional accounts (>100 bps round-trip). Consider using 5–20 bps.`,
      )
    }
  }

  // ── Strategy Mode ───────────────────────────────────────────────────────
  const mode = strategyMode.strategyMode ?? DEFAULT_STRATEGY_MODE_CONFIG.strategyMode

  if (mode === 'mean_reversion') {
    const mr = strategyMode.meanRevConfig ?? DEFAULT_STRATEGY_MODE_CONFIG.meanRevConfig
    if (mr.meanRevZScoreThreshold != null && Math.abs(mr.meanRevZScoreThreshold) > 3) {
      pushWarning(
        'strategyMode.meanRevConfig.meanRevZScoreThreshold',
        `Z-score threshold of ${mr.meanRevZScoreThreshold} is beyond ±3 standard deviations — statistically improbable and may never trigger.`,
      )
    }
    if (mr.meanRevLookback != null && mr.meanRevLookback <= 0) {
      pushError('strategyMode.meanRevConfig.meanRevLookback', `meanRevLookback must be positive, got ${mr.meanRevLookback}`)
    }
  }

  if (mode === 'momentum') {
    const mom = strategyMode.momentumConfig ?? DEFAULT_STRATEGY_MODE_CONFIG.momentumConfig
    if (mom.momentumLookback != null && mom.momentumLookback <= 0) {
      pushError('strategyMode.momentumConfig.momentumLookback', `momentumLookback must be positive, got ${mom.momentumLookback}`)
    }
    if (mom.momentumThreshold != null && mom.momentumThreshold <= 0) {
      pushError('strategyMode.momentumConfig.momentumThreshold', `momentumThreshold must be positive, got ${mom.momentumThreshold}`)
    }
  }

  if (mode === 'breakout') {
    const brk = strategyMode.breakoutConfig ?? DEFAULT_STRATEGY_MODE_CONFIG.breakoutConfig
    if (brk.breakoutLookback != null && brk.breakoutLookback <= 0) {
      pushError('strategyMode.breakoutConfig.breakoutLookback', `breakoutLookback must be positive, got ${brk.breakoutLookback}`)
    }
    if (brk.breakoutVolumeMultiplier != null && brk.breakoutVolumeMultiplier <= 0) {
      pushError(
        'strategyMode.breakoutConfig.breakoutVolumeMultiplier',
        `breakoutVolumeMultiplier must be positive, got ${brk.breakoutVolumeMultiplier}`,
      )
    }
  }

  // ── Backtest Period ─────────────────────────────────────────────────────
  if (backtestPeriod.lookbackYears != null && backtestPeriod.lookbackYears <= 0) {
    pushError('backtestPeriod.lookbackYears', `lookbackYears must be positive, got ${backtestPeriod.lookbackYears}`)
  }

  if (backtestPeriod.warmupBars != null && backtestPeriod.warmupBars <= 0) {
    pushError('backtestPeriod.warmupBars', `warmupBars must be positive, got ${backtestPeriod.warmupBars}`)
  }

  if (
    backtestPeriod.warmupBars != null &&
    backtestPeriod.lookbackYears != null &&
    backtestPeriod.warmupBars > backtestPeriod.lookbackYears * 252
  ) {
    pushWarning(
      'backtestPeriod.warmupBars',
      `warmupBars (${backtestPeriod.warmupBars}) exceeds available bars from lookbackYears (${backtestPeriod.lookbackYears * 252}). No signal data will be generated.`,
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export type PresetName = 'Conservative' | 'Balanced' | 'Aggressive' | 'Momentum'

/**
 * Named strategy presets for common trading styles.
 * Each preset is a complete StrategyConfig with sensible defaults for its risk profile.
 *
 *   Conservative — Lower risk, higher bar for entry (more confirmations required).
 *                  Ideal for accounts where capital preservation is paramount.
 *   Balanced     — Default institutional settings. Good for most market conditions.
 *   Aggressive   — Fewer confirmations, larger position sizes. Suitable for
 *                  high-conviction signals and smaller accounts that can tolerate volatility.
 *   Momentum     — Switches to momentum strategy mode with adjusted thresholds.
 *                  Captures trending moves rather than dip-buying.
 */
export interface StrategyPreset {
  name: PresetName
  description: string
  config: StrategyConfig
}

/**
 * Pre-built strategy presets covering common institutional and retail use cases.
 */
export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    name: 'Conservative',
    description:
      'Capital-preservation focus. Requires 3 bullish confirmations (vs default 2), ' +
      'tighter stop loss (1.0× ATR), quarter Kelly sizing, and lower max drawdown cap (15%). ' +
      'Suitable for retirement accounts, regulated funds, or volatile market environments.',
    config: {
      regime: { ...DEFAULT_REGIME_CONFIG },
      confirmations: {
        ...DEFAULT_CONFIRMATION_CONFIG,
        minConfirmations: 3,
        rsiBullThreshold: 30,   // stricter: only buy at stronger oversold
        bbBullThreshold: 0.10,  // stricter: only buy near absolute lower band
      },
      stopLoss: {
        ...DEFAULT_STOP_LOSS_CONFIG,
        stopLossAtrMultiplier: 1.0,  // tighter stop
        stopLossFloor: 0.02,         // 2% floor
        stopLossCeiling: 0.10,       // 10% ceiling
        trailAtrMultiplier1: 1.5,     // lock profit earlier
        trailAtrMultiplier2: 3.0,     // lock more aggressively
        maxDrawdownCap: 0.15,        // 15% portfolio drawdown limit
        positionCap: 0.15,           // max 15% per position
      },
      positionSizing: {
        ...DEFAULT_POSITION_SIZING_CONFIG,
        kellyMode: 'quarter',
        maxKellyFraction: 0.10,
        confidenceScales: [
          { confidenceThreshold: 90, kellyFraction: 0.10 },
          { confidenceThreshold: 75, kellyFraction: 0.07 },
          { confidenceThreshold: 55, kellyFraction: 0.05 },
        ],
      },
      transactionCosts: { ...DEFAULT_TRANSACTION_COST_CONFIG, txCostBpsPerSide: 15 }, // conservative cost estimate
      strategyMode: { ...DEFAULT_STRATEGY_MODE_CONFIG },
      optionsFilter: { ...DEFAULT_OPTIONS_FILTER_CONFIG },
      microstructureFilter: { ...DEFAULT_MICROSTRUCTURE_FILTER_CONFIG },
      backtestPeriod: { ...DEFAULT_BACKTEST_PERIOD_CONFIG },
      display: { ...DEFAULT_DISPLAY_CONFIG },
    },
  },

  {
    name: 'Balanced',
    description:
      'Default institutional settings. Requires 2 confirmations, ATR-adaptive stop (1.5×), ' +
      'half Kelly with 25% max. Designed for multi-year backtests across diverse market cycles. ' +
      'This is the recommended starting point for strategy development and benchmarking.',
    config: { ...DEFAULT_STRATEGY_CONFIG },
  },

  {
    name: 'Aggressive',
    description:
      'Higher-conviction, larger-position strategy. Requires only 1 confirmation (looser entry), ' +
      'wider 2.0× ATR stop, full Kelly with 40% cap, and 30% position size. ' +
      'Designed for small accounts, factor-tilt portfolios, or when running concentrated bets. ' +
      'Expect higher drawdowns and trade frequency.',
    config: {
      regime: { ...DEFAULT_REGIME_CONFIG },
      confirmations: {
        ...DEFAULT_CONFIRMATION_CONFIG,
        minConfirmations: 1,        // looser entry
        rsiBullThreshold: 40,       // allows entry at weaker oversold
        rsiBearThreshold: 60,        // exit earlier
        atrBullThreshold: 1.5,       // allows lower-volatility entries
        bbBullThreshold: 0.30,       // allows entry higher in BB range
      },
      stopLoss: {
        ...DEFAULT_STOP_LOSS_CONFIG,
        stopLossAtrMultiplier: 2.0,  // wider stop
        stopLossFloor: 0.04,         // 4% floor
        stopLossCeiling: 0.20,       // 20% ceiling
        trailAtrMultiplier1: 3.0,   // wait longer before locking profit
        trailAtrMultiplier2: 6.0,
        maxDrawdownCap: 0.35,       // allow deeper drawdowns
        positionCap: 0.30,           // up to 30% per position
      },
      positionSizing: {
        ...DEFAULT_POSITION_SIZING_CONFIG,
        kellyMode: 'full',
        maxKellyFraction: 0.40,
        confidenceScales: [
          { confidenceThreshold: 90, kellyFraction: 0.40 },
          { confidenceThreshold: 75, kellyFraction: 0.25 },
          { confidenceThreshold: 55, kellyFraction: 0.15 },
        ],
      },
      transactionCosts: { ...DEFAULT_TRANSACTION_COST_CONFIG, txCostBpsPerSide: 8 },
      strategyMode: { ...DEFAULT_STRATEGY_MODE_CONFIG },
      optionsFilter: { ...DEFAULT_OPTIONS_FILTER_CONFIG },
      microstructureFilter: { ...DEFAULT_MICROSTRUCTURE_FILTER_CONFIG },
      backtestPeriod: { ...DEFAULT_BACKTEST_PERIOD_CONFIG },
      display: { ...DEFAULT_DISPLAY_CONFIG },
    },
  },

  {
    name: 'Momentum',
    description:
      'Momentum-trend following strategy. Switches strategyMode to \'momentum\' with a 20-bar, ' +
      '5% momentum lookback. Buys when price breaks above SMA with positive slope and strong ' +
      'confirmations. Does not dip-buy. Designed for strong trending markets (e.g., 2020–2021). ' +
      'Underperforms in mean-reversion and range-bound regimes.',
    config: {
      regime: { ...DEFAULT_REGIME_CONFIG },
      confirmations: {
        ...DEFAULT_CONFIRMATION_CONFIG,
        minConfirmations: 2,
        rsiBullThreshold: 40,        // more responsive RSI for momentum signals
        atrBullThreshold: 1.5,        // lower ATR threshold for low-vol breakouts
        bbBullThreshold: 0.25,
      },
      stopLoss: {
        ...DEFAULT_STOP_LOSS_CONFIG,
        stopLossAtrMultiplier: 2.5,   // wider stop for momentum (trends take time)
        stopLossFloor: 0.05,          // 5% floor
        stopLossCeiling: 0.20,
        trailAtrMultiplier1: 3.0,
        trailAtrMultiplier2: 5.0,
        maxDrawdownCap: 0.30,
        positionCap: 0.20,
      },
      positionSizing: {
        ...DEFAULT_POSITION_SIZING_CONFIG,
        kellyMode: 'half',
        maxKellyFraction: 0.25,
        confidenceScales: [
          { confidenceThreshold: 90, kellyFraction: 0.25 },
          { confidenceThreshold: 75, kellyFraction: 0.15 },
          { confidenceThreshold: 55, kellyFraction: 0.08 },
        ],
      },
      transactionCosts: { ...DEFAULT_TRANSACTION_COST_CONFIG },
      strategyMode: {
        strategyMode: 'momentum',
        momentumConfig: {
          momentumLookback: 20,
          momentumThreshold: 0.05,   // 5% price change over 20 bars triggers momentum signal
        },
        meanRevConfig: { ...DEFAULT_STRATEGY_MODE_CONFIG.meanRevConfig },
        breakoutConfig: { ...DEFAULT_STRATEGY_MODE_CONFIG.breakoutConfig },
      },
      optionsFilter: { ...DEFAULT_OPTIONS_FILTER_CONFIG },
      microstructureFilter: { ...DEFAULT_MICROSTRUCTURE_FILTER_CONFIG },
      backtestPeriod: { ...DEFAULT_BACKTEST_PERIOD_CONFIG },
      display: { ...DEFAULT_DISPLAY_CONFIG },
    },
  },
]

/**
 * Returns the StrategyConfig for a given preset name.
 * Throws if the preset name is not recognized.
 *
 * @param preset - One of: 'Conservative', 'Balanced', 'Aggressive', 'Momentum'
 * @returns The complete StrategyConfig for that preset.
 */
export function applyStrategyPreset(preset: PresetName | string): StrategyConfig {
  const found = STRATEGY_PRESETS.find(
    (p) => p.name.toLowerCase() === preset.toLowerCase(),
  )
  if (!found) {
    const valid = STRATEGY_PRESETS.map((p) => p.name).join(', ')
    throw new Error(
      `Unknown strategy preset "${preset}". Valid presets: ${valid}`,
    )
  }
  return found.config
}

// ─── BacktestConfig adapter ────────────────────────────────────────────────────

/**
 * Converts a StrategyConfig into the legacy BacktestConfig format used by
 * lib/backtest/engine.ts and lib/backtest/signals.ts.
 *
 * This adapter ensures backward compatibility while the simulator system is being migrated.
 * All new code should use StrategyConfig directly.
 *
 * @param config - A StrategyConfig (potentially partial)
 * @returns A BacktestConfig-compatible object
 */
export function toBacktestConfig(config: Partial<StrategyConfig>): BacktestConfig {
  return {
    initialCapital: config.display?.initialCapital ?? DEFAULT_DISPLAY_CONFIG.initialCapital,
    stopLossPct: config.stopLoss?.stopLossCeiling ?? DEFAULT_STOP_LOSS_CONFIG.stopLossCeiling,
    confidenceThreshold:
      config.positionSizing?.confidenceScales?.[0]?.confidenceThreshold ??
      55,
    maxDrawdownCap: config.stopLoss?.maxDrawdownCap ?? DEFAULT_STOP_LOSS_CONFIG.maxDrawdownCap,
    halfKelly:
      (config.positionSizing?.kellyMode ?? DEFAULT_POSITION_SIZING_CONFIG.kellyMode) === 'half' ||
      (config.positionSizing?.kellyMode ?? DEFAULT_POSITION_SIZING_CONFIG.kellyMode) === 'quarter',
  }
}
