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

/**
 * Q-105: `stopLossPct` was removed from this contract. It was echoed into every
 * result and read by nothing — the engine's stops were retired in D2
 * (2026-07-11, `core.ts` time-exit block) — so `/api/backtest` shipped
 * `stopLossPct: 0.1` beside results that no stop had touched. Restoring a stop
 * is a different strategy and needs its own research package, not a knob.
 */
export interface BacktestConfig {
  initialCapital: number
  /**
   * Minimum confidence for a BUY. Read ONLY by `enhancedCombinedSignal`
   * (`signals.ts`). The regime-only path — the production default, see
   * `lib/featureFlags.ts` — ignores it, so varying it there changes nothing.
   */
  confidenceThreshold: number
  /** Equity drawdown from peak that forces an exit at the next open (`core.ts`). */
  maxDrawdownCap: number
  halfKelly: boolean
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 100_000,
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
