export type QuantLabPayload = {
  symbol: string
  fetchedAt: string
  narrative: {
    name: string
    sector?: string
    industry?: string
    summary: string
    employees?: number | null
    website?: string
  }
  market: Record<string, number | null | undefined>
  health: Record<string, number | null | undefined>
  balances: {
    endDate: string | null
    totalAssets: number | null
    totalLiab: number | null
    equity: number | null
    cash: number | null
    longTermDebt: number | null
    currentAssets: number | null
    currentLiab: number | null
  }[]
  incomes: {
    endDate: string | null
    revenue: number | null
    netIncome: number | null
    grossProfit: number | null
  }[]
  dcf: {
    inputs: Record<string, unknown>
    scenarios: {
      bear: { valuePerShare: number } | null
      base: { valuePerShare: number } | null
      bull: { valuePerShare: number } | null
    }
  }
  anchors: Record<string, number | null>
  volatility: { annualized: number; sampleDays: number }
  bands: {
    fairValueMid: number | null
    buyZoneHigh: number | null
    sellZoneLow: number | null
    methodology: string
  } | null
  price: number | null
  signal: { label: string; detail: string } | null
  technicals?: {
    sma20: number | null
    sma50: number | null
    sma200: number | null
    rsi14: number | null
    macd: { line: number | null; signal: number | null; histogram: number | null }
    bollinger: { mid: number | null; upper: number | null; lower: number | null; pctB: number | null }
    atr14: number | null
    atrStopLong: number | null
    atrStopShort: number | null
    trendLabel: string
    maxDrawdownPct: number | null
    sharpe: number | null
    sortino: number | null
    vol20dAnnualized?: number | null
    vol60dAnnualized?: number | null
    volRegime20over60?: number | null
  }
  relative?: {
    correlationVsSpy: number | null
    excessReturn20dVsSpy: number | null
    excessReturn60dVsSpy: number | null
    alignedSessions: number
  }
  researchScore?: {
    total: number
    weights: string
    pillars: { name: string; score: number; detail: string }[]
    rubricLines?: string[]
    benchmarkNote?: string
  }
  dataLineage?: {
    sources: string[]
    refresh: string
    statementNote: string
  }
  earnings?: {
    nextEarningsDate: string | null
    lastQuarterEnd: string | null
    lastEPSActual: number | null
    lastEPSEstimate: number | null
    lastSurprisePct: number | null
  }
  pivots?: { pivot: number; r1: number; s1: number; r2: number; s2: number; r3: number; s3: number } | null
  ma200Regime?: {
    zone: string
    deviationPct: number | null
    slopePositive: boolean | null
    slopePct: number | null
    label: string
    color: string
    riskLevel: 'low' | 'medium' | 'high' | 'extreme'
    interpretation: string
    forwardReturnContext: string
    dipSignal: 'STRONG_DIP' | 'WATCH_DIP' | 'FALLING_KNIFE' | 'OVERBOUGHT' | 'IN_TREND' | 'INSUFFICIENT_DATA'
    dipSignalExplained: string
  } | null
  range52w?: { high: number | null; low: number | null; position: number | null }
  fibRetracement?: { fib382: number; fib500: number; fib618: number } | null
  priceSources?: {
    display: number | null
    yahoo: number | null
    bloomberg: number | null
  }
}

export type LlmBackendHealth =
  | { checked: false; status: 'unknown'; message: string }
  | {
      checked: true
      status: 'ready' | 'config_error' | 'unreachable'
      message: string
      source?: string
      base?: string
    }

export type QuantLabSubTab = 'summary' | 'technicals' | 'financials' | 'valuation' | 'frameworks' | 'llm'
