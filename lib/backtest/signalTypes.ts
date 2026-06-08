/**
 * Backtest signal type definitions and default configuration — extracted from signals.ts.
 */

import type { OhlcBar, OhlcvBar } from '@/lib/quant/indicators'
import type { RegimeState as VolRegimeState } from '@/lib/quant/regimeDetection'
import type { PriceZone } from '@/lib/quant/volumeProfile'

export type { OhlcBar, OhlcvBar }

// ─── Regime classifier types ─────────────────────────────────────────────────

export type DipSignal =
  | 'STRONG_DIP' | 'WATCH_DIP' | 'FALLING_KNIFE'
  | 'OVERBOUGHT' | 'IN_TREND' | 'INSUFFICIENT_DATA'

export interface RegimeSignal {
  zone: string
  dipSignal: DipSignal
  deviationPct: number | null
  slopePct: number | null
  slopePositive: boolean | null
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  label: string
}

// ─── Combined signal types ─────────────────────────────────────────────────────

export interface BacktestConfig {
  initialCapital: number
  stopLossPct: number
  confidenceThreshold: number
  maxDrawdownCap: number
  halfKelly: boolean
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 100_000,
  // stopLossPct is now ATR-adaptive in the engine (1.5x ATR, capped 5-15%).
  // This config value serves as the floor for the ATR formula.
  stopLossPct: 0.10,
  confidenceThreshold: 50,  // Lowered from 55 — weighted scoring is inherently more selective
  maxDrawdownCap: 0.25,
  halfKelly: true,
}

export interface ConfirmSignal {
  name: string
  value: number | null
  bullish: boolean
}

export interface CombinedSignal {
  ticker: string
  date: string
  price: number
  regime: RegimeSignal
  confirms: ConfirmSignal[]
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  KellyFraction: number
  reason: string
}

// ─── Enhanced weighted confluence signal types ────────────────────────────────

export interface WeightedConfirm extends ConfirmSignal {
  weight: number         // 0.0-1.0
  score: number          // -1 to +1
  weightedScore: number  // weight * score
}

export interface EnhancedCombinedSignal extends CombinedSignal {
  weightedConfirms: WeightedConfirm[]
  volRegime: VolRegimeState
  multiTfScore: number
  volumeZone: PriceZone | null
  totalWeightedScore: number
}

// ─── Sector gate config ───────────────────────────────────────────────────────

/**
 * Optional sector-specific gates applied on top of the weighted signal.
 * These implement the Loop 1 fixes for problem sectors.
 */
export interface SectorGateConfig {
  /** Require EMA50 > EMA200 (golden cross) for BUY. Default: false. */
  goldenCrossGate?: boolean
  /** Require 3-month return > 0 for BUY. Default: false. */
  requirePositiveMomentum?: boolean
  /** Override the BUY weighted score threshold. */
  buyWScoreThreshold?: number
  /** Override the SELL weighted score threshold. */
  sellWScoreThreshold?: number
  /** Override the 200SMA slope threshold for regime signal. */
  slopeThreshold?: number
  /** If true, apply rate-sensitivity penalty for REITs/Utilities (TLT proxy). */
  tlrGate?: boolean
  /** If true, apply yield-curve penalty for Financials (rate-cycle proxy). */
  yieldCurveGate?: boolean
}
