/**
 * Parameter sets for the 3-round optimization loops.
 *
 * Loop 1 — Baseline calibration: Find the global parameter set that maximizes
 *   OOS win rate across all 56 instruments. Grid: 768 combinations.
 *
 * Loop 2 — Sector tuning: Refine per-sector parameters using sector profiles.
 *   Grid: narrower search around best Loop 1 results.
 *
 * Loop 3 — Portfolio optimization: Exit rules and position sizing.
 *   Grid: exit timing, profit-taking levels, stop multipliers.
 */

type ParamGrid = Record<string, number[]>

/**
 * Loop 1: Wide grid search to find baseline best parameters.
 * Tests 4 × 4 × 4 × 3 × 4 = 768 combinations per instrument.
 */
export const LOOP1_GRID: ParamGrid = {
  slopeThreshold:       [0.003, 0.005, 0.008, 0.010],
  buyWScoreThreshold:   [0.20, 0.25, 0.30, 0.35],
  sellWScoreThreshold:  [-0.25, -0.30, -0.35, -0.40],
  confidenceThreshold:  [50, 55, 60, 65],
  atrStopMultiplier:    [1.2, 1.5, 2.0, 2.5],
}

/**
 * Loop 2: Narrowed search around Loop 1 best results.
 * Focus on sector-specific refinement. 4 × 4 × 3 × 2 × 3 = 288 combinations.
 */
export const LOOP2_GRID: ParamGrid = {
  slopeThreshold:       [0.003, 0.005, 0.007, 0.010],
  buyWScoreThreshold:   [0.20, 0.25, 0.28, 0.32],
  sellWScoreThreshold:  [-0.25, -0.30, -0.35],
  confidenceThreshold:  [55, 60],
  atrStopMultiplier:    [1.5, 2.0, 2.5],
}

/**
 * Loop 3: Portfolio-level exit rule optimization.
 * Focus on profit-taking and dynamic stops.
 */
export interface ExitParamGrid {
  maxHoldDays: number[]
  profitTakePct: number[]        // exit 50% at this gain level
  trailingStopPct: number[]      // trailing stop after profit-take
  panicExitAtrMultiple: number[] // exit if ATR% spikes > this × entry ATR%
}

export const LOOP3_EXIT_GRID: ExitParamGrid = {
  maxHoldDays:          [15, 20, 25, 30],
  profitTakePct:        [0.06, 0.08, 0.10, 0.12],
  trailingStopPct:      [0.04, 0.06, 0.08],
  panicExitAtrMultiple: [2.5, 3.0, 4.0],
}

/**
 * Known best parameters from existing benchmark analysis.
 * Used as starting point for Loop 1 grid search.
 */
export const CURRENT_BASELINE = {
  slopeThreshold: 0.005,
  buyWScoreThreshold: 0.25,
  sellWScoreThreshold: -0.30,
  confidenceThreshold: 55,
  atrStopMultiplier: 1.5,
}

/**
 * Expected improvement targets for each optimization loop.
 */
export const OPTIMIZATION_TARGETS = {
  loop1: {
    minAggregateWinRate: 0.60,     // 60% aggregate win rate (up from 56.35%)
    maxInstrumentsBelow40pct: 3,   // max 3 instruments below 40% (down from 7)
    minProfitFactor: 1.3,
    maxOSISGap: 0.08,              // IS-OOS gap must be < 8pp (overfitting guard)
  },
  loop2: {
    minSectorWinRate: 0.58,        // all 11 sectors above 58%
    minSectorSharpe: 0.8,
    maxSectorOSISGap: 0.10,
  },
  loop3: {
    minPortfolioSharpe: 1.0,       // portfolio-level Sharpe ≥ 1.0
    maxPortfolioDrawdown: 0.20,    // max drawdown ≤ 20%
    minOOSWinRate: 0.62,           // OOS win rate ≥ 62%
    maxVaR99_10d: 0.08,            // VaR 99% 10-day ≤ 8%
  },
}

/**
 * Parameter interpretation guide (for AI agents).
 *
 * slopeThreshold:
 *   0.003 = very sensitive to trend, fires early in dip recoveries
 *   0.005 = current default, balanced
 *   0.008 = requires strong established uptrend (good for tech/momentum)
 *   0.010 = only fires in confirmed bull markets
 *
 * buyWScoreThreshold:
 *   0.20 = many signals, some noise (good for defensive sectors)
 *   0.25 = current default
 *   0.30 = selective, fewer but higher-quality signals
 *   0.35 = very selective, may miss good entries
 *
 * sellWScoreThreshold:
 *   -0.25 = aggressive exits, limits losses but may exit prematurely
 *   -0.30 = current default
 *   -0.35 = patient exits, holds through normal volatility
 *   -0.40 = very patient, risk of large losses in trending down markets
 *
 * atrStopMultiplier:
 *   1.2 = tight stops, many stop-outs but limits losses
 *   1.5 = current default
 *   2.0 = wider stops, appropriate for volatile tech/energy
 *   2.5 = very wide, only for high-conviction positions
 */
export const PARAM_INTERPRETATION: Record<string, Record<number, string>> = {
  slopeThreshold: {
    0.003: 'Very sensitive — fires in shallow recoveries',
    0.005: 'Default — balanced trend filter',
    0.008: 'Momentum-grade — requires strong uptrend',
    0.010: 'Bull-market only — very selective',
  },
  buyWScoreThreshold: {
    0.20: 'Permissive — defensive sector grade',
    0.25: 'Default — multi-sector baseline',
    0.30: 'Selective — high conviction requirement',
    0.35: 'Very selective — institutional grade',
  },
}
