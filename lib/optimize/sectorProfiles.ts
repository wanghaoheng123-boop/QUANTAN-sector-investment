/**
 * Sector-specific signal parameter profiles.
 *
 * Each GICS sector has different market dynamics, volatility characteristics,
 * and macro sensitivities. One-size-fits-all parameters hurt sectors like
 * Technology (secular uptrend, signal fires too early in corrections) and
 * Real Estate (rate-sensitive, needs TLT confirmation).
 *
 * These profiles are used by enhanced signal functions and the optimization
 * framework to apply sector-appropriate thresholds and gates.
 *
 * ── Research basis ──────────────────────────────────────────────────────────
 * - Technology: Momentum-driven. Buy-dip works ONLY when 50EMA > 200EMA.
 *   Without golden cross gate: AAPL 16.7% win rate, MSFT 31.7%, NVDA 21.4%.
 * - Real Estate: Rate-sensitive. TLT direction must confirm before buying.
 *   Without TLT gate: PLD 3.8%, WELL 0 trades, AMT 37.5%.
 * - Financials: Yield-curve cycle drives NIM expansion. BAC 12.5% without gate.
 * - Materials: Commodity-cycle + high vol. NEM 36.4%, LIN 26.3% without fixes.
 * - Communication: Mixed — META/GOOGL are tech-like, T/DIS are value/cyclical.
 * - Consumer Staples: Defensive, works across regimes. Already strong performers.
 * - Healthcare: Most robust sector for dip-buying. JNJ/LLY/ABBV all strong.
 */

export interface SectorProfile {
  sector: string
  tickers: string[]
  /** Primary strategy bias for weight profile selection */
  strategyBias: 'trend_following' | 'mean_reversion' | 'hybrid'
  /**
   * Minimum weighted score to trigger BUY (overrides DEFAULT_CONFIG.confidenceThreshold logic).
   * Default: 0.25. Raise for trend-following sectors (e.g. 0.30 for tech) to reduce false signals.
   */
  buyWScoreThreshold: number
  /** Weighted score below which a SELL is triggered. Default: -0.30 */
  sellWScoreThreshold: number
  /**
   * Minimum 200SMA slope required for BUY (20-bar slope as fraction).
   * Default: 0.005 (0.5%). Rate-sensitive sectors use 0.003 (more sensitive).
   * Trend sectors use 0.008 (stronger trend required).
   */
  slopeThreshold: number
  /** Require EMA50 > EMA200 (golden cross) before BUY signal. Critical for tech. */
  goldenCrossGate: boolean
  /** Require 3-month (63d) return > 0 before BUY. Filters stocks in secular downtrends. */
  requirePositiveMomentum: boolean
  /** If true, check TLT intermarket correlation before buying (REITs/Utilities). */
  tlrGate: boolean
  /**
   * Max VIX level for BUY signals. Null = no gate.
   * Technology: 30 (don't buy panic in tech, wait for stabilization).
   */
  maxVixForBuy: number | null
  /** Default max holding period in trading days before forced exit */
  maxHoldDays: number
  /** Minimum confidence threshold for BUY signals */
  confidenceThreshold: number
  /** ATR stop-loss multiplier (default 1.5×ATR in engine) */
  atrStopMultiplier: number
  /** Notes for AI agents on what to optimize */
  optimizationNotes: string
}

export const SECTOR_PROFILES: Record<string, SectorProfile> = {

  Technology: {
    sector: 'Technology',
    tickers: ['NVDA', 'MSFT', 'AAPL', 'AVGO', 'AMD'],
    strategyBias: 'trend_following',
    buyWScoreThreshold: 0.22,          // relaxed: too few signals at 0.30
    sellWScoreThreshold: -0.25,        // aggressive sell
    slopeThreshold: 0.004,             // relaxed: 0.008 missed all entries in corrections
    goldenCrossGate: true,             // re-enabled: tech trends need EMA confirmation
    requirePositiveMomentum: false,    // disabled: too restrictive
    tlrGate: false,
    maxVixForBuy: 30,
    maxHoldDays: 30,
    confidenceThreshold: 55,           // lowered from 60
    atrStopMultiplier: 2.0,
    optimizationNotes: 'Golden cross gate disabled — was producing 1 signal across 5 stocks. Need sufficient signal frequency to evaluate quality. Relax thresholds and re-evaluate.',
  },

  Healthcare: {
    sector: 'Healthcare',
    tickers: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK'],
    strategyBias: 'hybrid',
    buyWScoreThreshold: 0.22,          // slightly more permissive
    sellWScoreThreshold: -0.30,
    slopeThreshold: 0.004,
    goldenCrossGate: false,            // healthcare holds up even below 50EMA
    requirePositiveMomentum: false,    // defensive sector, can buy dips in downtrends
    tlrGate: false,
    maxVixForBuy: null,                // healthcare works in high-vol environments
    maxHoldDays: 25,
    confidenceThreshold: 55,
    atrStopMultiplier: 1.5,
    optimizationNotes: 'Already strong performer (LLY 82%, ABBV 94%). Focus on maintaining performance and refining exit timing. Earnings surprises are the main risk.',
  },

  Financials: {
    sector: 'Financials',
    tickers: ['BRK.B', 'JPM', 'V', 'MA', 'BAC'],
    strategyBias: 'mean_reversion',
    buyWScoreThreshold: 0.25,
    sellWScoreThreshold: -0.28,
    slopeThreshold: 0.004,
    goldenCrossGate: false,
    requirePositiveMomentum: false,    // financials can mean-revert from distress
    tlrGate: false,
    maxVixForBuy: null,
    maxHoldDays: 20,
    confidenceThreshold: 55,
    atrStopMultiplier: 1.5,
    optimizationNotes: 'BAC and banks are rate-cycle sensitive (12.5% win rate). Key improvement: add yield curve slope proxy (10Y-2Y). BAC signals in rate-inversion environment should be suppressed. JPM/V/MA are more resilient.',
  },

  'Consumer Disc.': {
    sector: 'Consumer Disc.',
    tickers: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE'],
    strategyBias: 'trend_following',
    buyWScoreThreshold: 0.22,          // relaxed from 0.28 — too few signals
    sellWScoreThreshold: -0.28,
    slopeThreshold: 0.004,             // relaxed from 0.006
    goldenCrossGate: false,            // disabled: filtering too aggressively
    requirePositiveMomentum: false,
    tlrGate: false,
    maxVixForBuy: 35,
    maxHoldDays: 20,
    confidenceThreshold: 55,           // lowered from 58
    atrStopMultiplier: 2.0,
    optimizationNotes: 'TSLA is the most volatile (50% swings). HD (45% win rate) and NKE (33% win rate) are structural losers in current downturn. Separating TSLA/AMZN from HD/MCD/NKE with sub-profiles would further improve.',
  },

  Communication: {
    sector: 'Communication',
    tickers: ['META', 'GOOGL', 'NFLX', 'DIS', 'T'],
    strategyBias: 'hybrid',
    buyWScoreThreshold: 0.20,          // lowered from 0.25 — 28.7% WR needs more signals
    sellWScoreThreshold: -0.30,
    slopeThreshold: 0.003,             // lowered from 0.005
    goldenCrossGate: false,
    requirePositiveMomentum: false,
    tlrGate: false,
    maxVixForBuy: null,
    maxHoldDays: 20,
    confidenceThreshold: 50,           // lowered from 55
    atrStopMultiplier: 1.5,
    optimizationNotes: 'Bimodal sector: META (100% WR) and GOOGL (37.5% WR). DIS (-49% BnH) and T (+22% BnH) require value vs trend differentiation. Relaxed thresholds to generate sufficient signals for evaluation.',
  },

  Industrials: {
    sector: 'Industrials',
    tickers: ['GE', 'RTX', 'CAT', 'UNP', 'HON'],
    strategyBias: 'trend_following',
    buyWScoreThreshold: 0.22,          // relaxed from 0.26
    sellWScoreThreshold: -0.30,
    slopeThreshold: 0.004,             // relaxed from 0.005
    goldenCrossGate: false,            // disabled: too restrictive
    requirePositiveMomentum: false,
    tlrGate: false,
    maxVixForBuy: null,
    maxHoldDays: 20,
    confidenceThreshold: 55,
    atrStopMultiplier: 1.5,
    optimizationNotes: 'GE (100% WR) and CAT (87.5%) are stars. UNP (0% WR) needs separate handling — supply chain disruption years cause slope gate misfires.',
  },

  'Consumer Staples': {
    sector: 'Consumer Staples',
    tickers: ['PG', 'COST', 'WMT', 'PEP', 'KO'],
    strategyBias: 'mean_reversion',
    buyWScoreThreshold: 0.20,          // defensive sector — be more permissive
    sellWScoreThreshold: -0.35,        // hold longer, defensive stocks recover
    slopeThreshold: 0.003,             // lower slope threshold, staples are slow-movers
    goldenCrossGate: false,
    requirePositiveMomentum: false,    // defensive — buy dips even in downturns
    tlrGate: false,
    maxVixForBuy: null,
    maxHoldDays: 20,
    confidenceThreshold: 50,           // lower threshold, high signal quality in staples
    atrStopMultiplier: 1.5,
    optimizationNotes: 'Strong across board (PEP 80%, PG 71%, KO 64%). Main issue is KO — too many signals (36 buys) vs COST (25 buys). ATR% < 1 is an issue for slow-moving staples. Consider lowering ATR% bullish threshold from 2.0% to 1.5%.',
  },

  Energy: {
    sector: 'Energy',
    tickers: ['XOM', 'CVX', 'COP', 'EOG', 'SLB'],
    strategyBias: 'trend_following',
    buyWScoreThreshold: 0.25,
    sellWScoreThreshold: -0.28,
    slopeThreshold: 0.005,
    goldenCrossGate: false,
    requirePositiveMomentum: true,     // energy follows oil price momentum
    tlrGate: false,
    maxVixForBuy: null,
    maxHoldDays: 20,
    confidenceThreshold: 55,
    atrStopMultiplier: 1.8,            // energy is volatile (oil price swings)
    optimizationNotes: 'CVX (80%) and COP (71%) work well. XOM (69%) solid. EOG (70%) good. SLB (67%) good. Energy works when oil price is rising. Key: add oil price proxy (USO momentum) as confirmation. SLB most service-company like — needs GEX-of-oil filter.',
  },

  Materials: {
    sector: 'Materials',
    tickers: ['LIN', 'APD', 'FCX', 'NEM', 'DOW'],
    strategyBias: 'mean_reversion',
    buyWScoreThreshold: 0.22,          // relaxed from 0.28 — 46% WR needs more signals
    sellWScoreThreshold: -0.25,
    slopeThreshold: 0.003,             // relaxed from 0.004
    goldenCrossGate: false,
    requirePositiveMomentum: false,
    tlrGate: false,
    maxVixForBuy: null,
    maxHoldDays: 15,
    confidenceThreshold: 55,           // lowered from 60
    atrStopMultiplier: 2.0,
    optimizationNotes: 'NEM (36.4% WR) is the worst — gold miners are anti-correlated with dollar. FCX (42%) is copper-proxy, very cyclical. LIN (26.3%) is counter-intuitive: defensive chemical company but algorithm signals poorly. Fix: NEM needs dollar-index gate (buy NEM only when DXY falling).',
  },

  Utilities: {
    sector: 'Utilities',
    tickers: ['NEE', 'SO', 'DUK', 'AEP', 'PCG'],
    strategyBias: 'mean_reversion',
    buyWScoreThreshold: 0.22,
    sellWScoreThreshold: -0.32,
    slopeThreshold: 0.003,             // slow-moving sector, sensitive slope threshold
    goldenCrossGate: false,
    requirePositiveMomentum: false,    // defensive, buy dips
    tlrGate: true,                     // rate-sensitive: require TLT to be rising
    maxVixForBuy: null,
    maxHoldDays: 25,                   // utilities recover slowly
    confidenceThreshold: 52,
    atrStopMultiplier: 1.5,
    optimizationNotes: 'NEE (53.8%) and DUK (57.1%) are borderline. PCG (73.8%) and AEP (78.9%) are strong. Rate sensitivity is the key driver. When 10Y yield is falling (TLT rising), utilities buy signals are much more reliable. Add TLT confirmation gate.',
  },

  'Real Estate': {
    sector: 'Real Estate',
    tickers: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG'],
    strategyBias: 'mean_reversion',
    buyWScoreThreshold: 0.20,          // permissive — REITs have high yield buffer
    sellWScoreThreshold: -0.30,
    slopeThreshold: 0.003,             // very sensitive — WELL never triggers at 0.005
    goldenCrossGate: false,
    requirePositiveMomentum: false,    // REITs can recover even from below 50EMA
    tlrGate: true,                     // CRITICAL: only buy REITs when TLT rising
    maxVixForBuy: null,
    maxHoldDays: 20,
    confidenceThreshold: 50,           // low threshold: TLT gate is the primary filter
    atrStopMultiplier: 1.5,
    optimizationNotes: 'PLD (3.8% WR) and WELL (0 trades) are broken. Root cause: 200SMA slope threshold too high for rate-beaten REITs. Fix: (1) lower slopeThreshold to 0.003, (2) add TLT gate (buy only when TLT 20SMA > TLT 50SMA), (3) consider dividend yield support as additional buy signal.',
  },
}

/**
 * Look up the sector profile for a given ticker.
 * Falls back to a default profile if not found.
 */
export function getProfileForTicker(ticker: string): SectorProfile {
  for (const profile of Object.values(SECTOR_PROFILES)) {
    // Handle BRK.B vs BRK-B ticker variants
    if (profile.tickers.includes(ticker) || profile.tickers.includes(ticker.replace('-', '.'))) {
      return profile
    }
  }
  // Default profile for unknown tickers
  return {
    sector: 'Unknown',
    tickers: [],
    strategyBias: 'hybrid',
    buyWScoreThreshold: 0.15,
    sellWScoreThreshold: -0.30,
    slopeThreshold: 0.005,
    goldenCrossGate: false,
    requirePositiveMomentum: false,
    tlrGate: false,
    maxVixForBuy: null,
    maxHoldDays: 20,
    confidenceThreshold: 50,
    atrStopMultiplier: 1.5,
    optimizationNotes: 'No profile defined for this ticker.',
  }
}

/**
 * Get sector profile by sector name.
 */
export function getProfileForSector(sector: string): SectorProfile | null {
  return SECTOR_PROFILES[sector] ?? null
}
