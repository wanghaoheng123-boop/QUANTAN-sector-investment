/**
 * Historical stress-test scenarios for portfolio risk analysis.
 *
 * Each scenario replays known market drawdown periods using historically
 * observed factor shocks. The engine applies percentage-based shocks to
 * each portfolio position based on the position's sector/asset class,
 * then computes PnL impact.
 *
 * Scenarios included:
 *   GFC 2008       — Global Financial Crisis (Sep 2008 – Mar 2009)
 *   COVID 2020     — Pandemic crash (Feb 2020 – Mar 2020)
 *   Rate Shock 2022 — Fed tightening cycle (Jan 2022 – Oct 2022)
 *   Dot-Com 2000   — Tech bubble burst (Mar 2000 – Oct 2002)
 *   Flash Crash 2010 — Single-day liquidity shock (May 6, 2010)
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type AssetClass =
  | 'equity_us'
  | 'equity_tech'
  | 'equity_finance'
  | 'equity_energy'
  | 'equity_healthcare'
  | 'equity_consumer'
  | 'equity_real_estate'
  | 'equity_utilities'
  | 'equity_materials'
  | 'equity_industrials'
  | 'equity_international'
  | 'equity_em'
  | 'bond_us_long'
  | 'bond_us_short'
  | 'bond_hy'
  | 'commodity'
  | 'commodity_gold'
  | 'commodity_oil'
  | 'crypto'
  | 'cash'
  | 'unknown'

export interface StressPosition {
  ticker: string
  marketValue: number   // current USD value (positive = long, negative = short)
  assetClass: AssetClass
}

export interface ScenarioShock {
  /** Human-readable scenario name. */
  name: string
  /** Start of the historical period this shock approximates. */
  periodStart: string
  /** End of the historical period. */
  periodEnd: string
  /** Duration label. */
  duration: string
  /** Brief description for UI display. */
  description: string
  /** Percentage shock per asset class (e.g. -0.50 = -50%). */
  shocks: Partial<Record<AssetClass, number>>
  /** Fallback shock for any asset class not explicitly listed. */
  defaultShock: number
}

export interface StressTestResult {
  scenario: string
  portfolioShock: number     // total PnL impact in USD
  portfolioShockPct: number  // as % of total portfolio value
  positionBreakdown: Array<{
    ticker: string
    assetClass: AssetClass
    marketValue: number
    shock: number         // applied shock percentage
    pnlImpact: number     // USD impact
  }>
}

export interface StressTestReport {
  totalValue: number
  scenarios: StressTestResult[]
  /** Worst-case scenario among all tested. */
  worstCase: StressTestResult
  /** Average scenario loss. */
  avgLoss: number
}

// ────────────────────────────────────────────────────────────────
// Scenario definitions (historically grounded, conservatively calibrated)
// ────────────────────────────────────────────────────────────────

export const SCENARIOS: ScenarioShock[] = [
  {
    name: 'GFC 2008',
    periodStart: '2008-09-15',
    periodEnd: '2009-03-09',
    duration: '~6 months',
    description: 'Lehman bankruptcy to S&P 500 trough. S&P −57%, financials −80%, commodities −55%.',
    defaultShock: -0.45,
    shocks: {
      equity_us:            -0.57,
      equity_tech:          -0.52,
      equity_finance:       -0.80,
      equity_energy:        -0.55,
      equity_healthcare:    -0.35,
      equity_consumer:      -0.40,
      equity_real_estate:   -0.70,
      equity_utilities:     -0.30,
      equity_materials:     -0.55,
      equity_industrials:   -0.55,
      equity_international: -0.55,
      equity_em:            -0.65,
      bond_us_long:         +0.25,   // flight to safety
      bond_us_short:        +0.08,
      bond_hy:              -0.35,
      commodity:            -0.45,
      commodity_gold:       +0.05,
      commodity_oil:        -0.70,
      crypto:               -0.70,   // hypothetical, BTC nascent
      cash:                  0.00,
    },
  },
  {
    name: 'COVID Crash 2020',
    periodStart: '2020-02-19',
    periodEnd: '2020-03-23',
    duration: '33 days',
    description: 'Fastest 30% drawdown in US history. S&P −34%, energy −55%, gold +5%.',
    defaultShock: -0.30,
    shocks: {
      equity_us:            -0.34,
      equity_tech:          -0.30,
      equity_finance:       -0.40,
      equity_energy:        -0.55,
      equity_healthcare:    -0.20,
      equity_consumer:      -0.35,
      equity_real_estate:   -0.40,
      equity_utilities:     -0.22,
      equity_materials:     -0.35,
      equity_industrials:   -0.40,
      equity_international: -0.32,
      equity_em:            -0.35,
      bond_us_long:         +0.10,
      bond_us_short:        +0.03,
      bond_hy:              -0.22,
      commodity:            -0.30,
      commodity_gold:       +0.05,
      commodity_oil:        -0.65,
      crypto:               -0.50,
      cash:                  0.00,
    },
  },
  {
    name: 'Rate Shock 2022',
    periodStart: '2022-01-03',
    periodEnd: '2022-10-13',
    duration: '~9 months',
    description: 'Fed tightening at historic pace. S&P −25%, Nasdaq −33%, bonds −16%, no safe haven except energy.',
    defaultShock: -0.22,
    shocks: {
      equity_us:            -0.25,
      equity_tech:          -0.33,
      equity_finance:       -0.18,
      equity_energy:        +0.40,   // commodity supercycle
      equity_healthcare:    -0.12,
      equity_consumer:      -0.20,
      equity_real_estate:   -0.28,
      equity_utilities:     -0.05,
      equity_materials:     -0.10,
      equity_industrials:   -0.18,
      equity_international: -0.20,
      equity_em:            -0.25,
      bond_us_long:         -0.28,   // duration destroyed
      bond_us_short:        -0.03,
      bond_hy:              -0.15,
      commodity:            +0.15,
      commodity_gold:       -0.08,
      commodity_oil:        +0.30,
      crypto:               -0.70,
      cash:                 +0.03,   // rising rates = better cash yield
    },
  },
  {
    name: 'Dot-Com Bust 2000',
    periodStart: '2000-03-10',
    periodEnd: '2002-10-09',
    duration: '~30 months',
    description: 'Nasdaq −78%, S&P −50%. Secular bear market in tech. Bonds and utilities outperformed.',
    defaultShock: -0.40,
    shocks: {
      equity_us:            -0.50,
      equity_tech:          -0.78,
      equity_finance:       -0.35,
      equity_energy:        +0.10,
      equity_healthcare:    -0.20,
      equity_consumer:      -0.35,
      equity_real_estate:   +0.05,
      equity_utilities:     -0.15,
      equity_materials:     -0.30,
      equity_industrials:   -0.40,
      equity_international: -0.45,
      equity_em:            -0.40,
      bond_us_long:         +0.30,
      bond_us_short:        +0.15,
      bond_hy:              -0.10,
      commodity:            +0.05,
      commodity_gold:       +0.10,
      commodity_oil:        -0.05,
      crypto:               -0.60,   // hypothetical
      cash:                  0.00,
    },
  },
  {
    name: 'Flash Crash 2010',
    periodStart: '2010-05-06',
    periodEnd: '2010-05-06',
    duration: 'Intraday',
    description: 'Intraday crash of −9.2%, then partial recovery. Illiquid small-caps worst affected.',
    defaultShock: -0.07,
    shocks: {
      equity_us:            -0.07,
      equity_tech:          -0.08,
      equity_finance:       -0.09,
      equity_energy:        -0.06,
      equity_healthcare:    -0.05,
      equity_consumer:      -0.06,
      equity_real_estate:   -0.08,
      equity_utilities:     -0.04,
      equity_materials:     -0.07,
      equity_industrials:   -0.07,
      equity_international: -0.05,
      equity_em:            -0.05,
      bond_us_long:         +0.02,
      bond_us_short:        +0.01,
      bond_hy:              -0.04,
      commodity:            -0.05,
      commodity_gold:       +0.01,
      commodity_oil:        -0.06,
      crypto:               -0.10,
      cash:                  0.00,
    },
  },
]

// ────────────────────────────────────────────────────────────────
// Ticker → asset class heuristics
// ────────────────────────────────────────────────────────────────

const TICKER_CLASS_MAP: Record<string, AssetClass> = {
  // US broad market ETFs
  SPY: 'equity_us', IVV: 'equity_us', VOO: 'equity_us', VTI: 'equity_us',
  QQQ: 'equity_tech', TQQQ: 'equity_tech', SQQQ: 'equity_tech',
  // Sector ETFs
  XLF: 'equity_finance', KBE: 'equity_finance', KRE: 'equity_finance',
  XLK: 'equity_tech', SMH: 'equity_tech', SOXX: 'equity_tech',
  XLE: 'equity_energy', XOP: 'equity_energy',
  XLV: 'equity_healthcare', IBB: 'equity_healthcare',
  XLY: 'equity_consumer', XLP: 'equity_consumer',
  XLRE: 'equity_real_estate', VNQ: 'equity_real_estate',
  XLU: 'equity_utilities',
  XLB: 'equity_materials',
  XLI: 'equity_industrials',
  // International
  EFA: 'equity_international', VEA: 'equity_international',
  EEM: 'equity_em', VWO: 'equity_em',
  // Bonds
  TLT: 'bond_us_long', EDV: 'bond_us_long', ZROZ: 'bond_us_long',
  IEF: 'bond_us_long', BND: 'bond_us_long',
  SHY: 'bond_us_short', SGOV: 'bond_us_short', BIL: 'cash',
  HYG: 'bond_hy', JNK: 'bond_hy',
  // Commodities
  GLD: 'commodity_gold', IAU: 'commodity_gold', GLDM: 'commodity_gold',
  USO: 'commodity_oil', UCO: 'commodity_oil',
  DJP: 'commodity', PDBC: 'commodity', GSG: 'commodity',
  // Crypto
  GBTC: 'crypto', IBIT: 'crypto', FBTC: 'crypto',
  // Individual stocks — best-effort sector
  AAPL: 'equity_tech', MSFT: 'equity_tech', NVDA: 'equity_tech',
  GOOGL: 'equity_tech', META: 'equity_tech', AMZN: 'equity_tech',
  JPM: 'equity_finance', GS: 'equity_finance', BAC: 'equity_finance',
  XOM: 'equity_energy', CVX: 'equity_energy',
  JNJ: 'equity_healthcare', UNH: 'equity_healthcare', PFE: 'equity_healthcare',
  BRK: 'equity_finance',
}

/**
 * Classify a ticker into an asset class. Falls back to `'unknown'`.
 */
export function classifyTicker(ticker: string): AssetClass {
  const upper = ticker.toUpperCase().replace(/\.[AB]$/, '')  // strip share class
  return TICKER_CLASS_MAP[upper] ?? 'unknown'
}

// ────────────────────────────────────────────────────────────────
// Stress test engine
// ────────────────────────────────────────────────────────────────

function applyScenario(
  positions: StressPosition[],
  scenario: ScenarioShock,
  totalValue: number,
): StressTestResult {
  let totalPnl = 0
  const breakdown = positions.map((pos) => {
    const shock = scenario.shocks[pos.assetClass] ?? scenario.defaultShock

    // For short positions the impact is reversed: a -50% shock benefits a short
    const signedMv  = pos.marketValue
    const pnlImpact = signedMv < 0
      ? -signedMv * (-shock)   // short: profit from decline
      : signedMv * shock        // long: loss from decline

    totalPnl += pnlImpact
    return {
      ticker: pos.ticker,
      assetClass: pos.assetClass,
      marketValue: pos.marketValue,
      shock,
      pnlImpact,
    }
  })

  return {
    scenario: scenario.name,
    portfolioShock: totalPnl,
    portfolioShockPct: totalValue > 0 ? totalPnl / totalValue : 0,
    positionBreakdown: breakdown,
  }
}

/**
 * Run all built-in scenarios against a set of portfolio positions.
 *
 * @param positions   Positions with market values and asset classes
 * @param totalValue  Total portfolio value (cash + investments) in USD
 * @param scenarios   Optional override list (defaults to SCENARIOS)
 */
export function runStressTests(
  positions: StressPosition[],
  totalValue: number,
  scenarios: ScenarioShock[] = SCENARIOS,
): StressTestReport {
  const results = scenarios.map((s) => applyScenario(positions, s, totalValue))

  const worstCase = results.reduce(
    (worst, r) => r.portfolioShockPct < worst.portfolioShockPct ? r : worst,
    results[0],
  )

  const avgLoss = results.length > 0
    ? results.reduce((s, r) => s + r.portfolioShock, 0) / results.length
    : 0

  return { totalValue, scenarios: results, worstCase, avgLoss }
}
