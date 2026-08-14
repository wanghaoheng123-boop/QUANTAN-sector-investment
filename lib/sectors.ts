// Core sector data and types for QUANTAN Market Intelligence

export interface Sector {
  slug: string
  name: string
  etf: string
  description: string
  color: string
  bgGradient: string
  borderColor: string
  icon: string
  topHoldings: string[]
  theme: string
}

export const SECTORS: Sector[] = [
  {
    slug: 'technology',
    name: 'Technology',
    etf: 'XLK',
    description: 'Software, semiconductors, hardware, and IT services leading innovation cycles',
    color: '#3b82f6',
    bgGradient: 'from-blue-900/20 to-blue-950/10',
    borderColor: 'border-blue-500/30',
    icon: '⚡',
    topHoldings: ['NVDA', 'MSFT', 'AAPL', 'AVGO', 'AMD'],
    theme: 'blue'
  },
  {
    slug: 'energy',
    name: 'Energy',
    etf: 'XLE',
    description: 'Oil & gas majors, refiners, and energy services amid geopolitical flux',
    color: '#f59e0b',
    bgGradient: 'from-amber-900/20 to-amber-950/10',
    borderColor: 'border-amber-500/30',
    icon: '🛢️',
    topHoldings: ['XOM', 'CVX', 'COP', 'EOG', 'SLB'],
    theme: 'amber'
  },
  {
    slug: 'financials',
    name: 'Financials',
    etf: 'XLF',
    description: 'Banks, insurers, and asset managers navigating rate cycle inflection',
    color: '#10b981',
    bgGradient: 'from-emerald-900/20 to-emerald-950/10',
    borderColor: 'border-emerald-500/30',
    icon: '🏦',
    topHoldings: ['BRK.B', 'JPM', 'V', 'MA', 'BAC'],
    theme: 'emerald'
  },
  {
    slug: 'healthcare',
    name: 'Healthcare',
    etf: 'XLV',
    description: 'Pharma, biotech, medtech, and healthcare services in a reform-era market',
    color: '#ec4899',
    bgGradient: 'from-pink-900/20 to-pink-950/10',
    borderColor: 'border-pink-500/30',
    icon: '🧬',
    topHoldings: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK'],
    theme: 'pink'
  },
  {
    slug: 'consumer-discretionary',
    name: 'Consumer Disc.',
    etf: 'XLY',
    description: 'Retail, autos, and leisure sectors tied to consumer spending cycles',
    color: '#f97316',
    bgGradient: 'from-orange-900/20 to-orange-950/10',
    borderColor: 'border-orange-500/30',
    icon: '🛒',
    topHoldings: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE'],
    theme: 'orange'
  },
  {
    slug: 'industrials',
    name: 'Industrials',
    etf: 'XLI',
    description: 'Aerospace, defense, machinery, and logistics in a reshoring supercycle',
    color: '#7c7ff5',
    bgGradient: 'from-indigo-900/20 to-indigo-950/10',
    borderColor: 'border-indigo-500/30',
    icon: '⚙️',
    topHoldings: ['GE', 'RTX', 'CAT', 'UNP', 'HON'],
    theme: 'indigo'
  },
  {
    slug: 'communication',
    name: 'Communication',
    etf: 'XLC',
    description: 'Social media, streaming, and telecom at the intersection of AI and media',
    // 2026-08-14: violet-500 #8b5cf6 rendered at 4.05:1 on the session-up signal
    // card (composite bg #0c1f18), under the 4.5:1 AA floor for the text-xs
    // confidence figure in components/SignalCard.tsx — the one contrast failure
    // axe still found after the interface wave. Same class of defect already
    // fixed for industrials (#6366f1 -> #7c7ff5). #b57bff measures 5.91:1 and
    // stays in the violet theme; it is also further from its two neighbours
    // (dE 19.0 from industrials, 14.9 from real-estate #a78bfa) than those two
    // already are from each other (11.3), so sector identity does not blur.
    color: '#b57bff',
    bgGradient: 'from-violet-900/20 to-violet-950/10',
    borderColor: 'border-violet-500/30',
    icon: '📡',
    topHoldings: ['META', 'GOOGL', 'NFLX', 'DIS', 'T'],
    theme: 'violet'
  },
  {
    slug: 'materials',
    name: 'Materials',
    etf: 'XLB',
    description: 'Metals, mining, chemicals, and packaging in a commodity supercycle',
    color: '#84cc16',
    bgGradient: 'from-lime-900/20 to-lime-950/10',
    borderColor: 'border-lime-500/30',
    icon: '⛏️',
    topHoldings: ['LIN', 'APD', 'FCX', 'NEM', 'DOW'],
    theme: 'lime'
  },
  {
    slug: 'utilities',
    name: 'Utilities',
    etf: 'XLU',
    description: 'Power generation and distribution benefiting from AI data center demand',
    color: '#06b6d4',
    bgGradient: 'from-cyan-900/20 to-cyan-950/10',
    borderColor: 'border-cyan-500/30',
    icon: '⚡',
    topHoldings: ['NEE', 'SO', 'DUK', 'AEP', 'PCG'],
    theme: 'cyan'
  },
  {
    slug: 'real-estate',
    name: 'Real Estate',
    etf: 'XLRE',
    description: 'REITs and real estate operators sensitive to rate trajectory and AI capex',
    color: '#a78bfa',
    bgGradient: 'from-purple-900/20 to-purple-950/10',
    borderColor: 'border-purple-500/30',
    icon: '🏢',
    topHoldings: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG'],
    theme: 'purple'
  },
  {
    slug: 'consumer-staples',
    name: 'Consumer Staples',
    etf: 'XLP',
    description: 'Defensive consumer brands, food, and beverages in a tariff-impacted market',
    color: '#34d399',
    bgGradient: 'from-teal-900/20 to-teal-950/10',
    borderColor: 'border-teal-500/30',
    icon: '🛍️',
    topHoldings: ['PG', 'COST', 'WMT', 'PEP', 'KO'],
    theme: 'teal'
  }
]

export const SECTOR_ETFS = SECTORS.map(s => s.etf)

export function getSectorBySlug(slug: string): Sector | undefined {
  return SECTORS.find(s => s.slug === slug)
}

export function getSectorByEtf(etf: string): Sector | undefined {
  return SECTORS.find(s => s.etf === etf)
}

// Signal types
export type SignalDirection = 'BUY' | 'SELL' | 'HOLD' | 'WATCH'
export type Timeframe = '1D' | '1W' | '1M' | '3M'

export type PriceSignalSource = 'yahoo-session' | 'demo'

export interface PriceSignal {
  sector: string
  etf: string
  direction: SignalDirection
  confidence: number // 0-100
  entry: number
  stopLoss: number
  target: number
  timeframe: Timeframe
  rationale: string
  timestamp: string
  /** When set, card explains that direction is session up/down/flat, not a trade call. */
  source?: PriceSignalSource
  /** Yahoo regularMarketTime when available. */
  quoteTime?: string | null
  /** Raw session change % used for stats (Yahoo-normalized). */
  sessionChangePct?: number
}

// Dark pool print type
export interface DarkPoolPrint {
  time: string
  ticker: string
  size: number // shares
  price: number
  premium: number // % vs VWAP
  type: 'BLOCK' | 'SWEEP' | 'CROSS'
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
}

// Market Brief type
export interface Brief {
  id: number
  title: string
  summary: string
  sector: string
  timestamp: string
  readTime: number
  tags: string[]
  content: string
  signals: {
    key: string
    value: string
    impact: 'positive' | 'negative' | 'neutral'
  }[]
}
