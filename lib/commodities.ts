// Liquid ETF / ETP proxies for commodities — suitable for Yahoo Finance quotes & charts.

export type CommodityCategory = 'energy' | 'metals' | 'agriculture' | 'broad' | 'volatility'

export interface CommodityInstrument {
  ticker: string
  name: string
  category: CommodityCategory
  description: string
  color: string
  benchmarkNote: string
}

export const COMMODITY_INSTRUMENTS: CommodityInstrument[] = [
  {
    ticker: 'DBC',
    name: 'Invesco DB Commodity',
    category: 'broad',
    description: 'Broad diversified commodity futures exposure (energy, metals, agriculture).',
    color: '#eab308',
    benchmarkNote: 'DBIQ Optimum Yield Diversified Commodity Index',
  },
  {
    ticker: 'PDBC',
    name: 'Invesco Optimum Yield',
    category: 'broad',
    description: 'Alternative broad commodity basket with roll optimization.',
    color: '#ca8a04',
    benchmarkNote: 'DBIQ Optimum Yield Diversified Commodity Index Excess Return',
  },
  {
    ticker: 'USO',
    name: 'WTI Crude Oil',
    category: 'energy',
    description: 'Near-month WTI crude oil futures (contango/backwardation aware).',
    color: '#f97316',
    benchmarkNote: 'WTI light sweet crude futures',
  },
  {
    ticker: 'BNO',
    name: 'Brent Crude',
    category: 'energy',
    description: 'Brent crude oil futures exposure.',
    color: '#ea580c',
    benchmarkNote: 'Brent crude futures',
  },
  {
    ticker: 'UNG',
    name: 'Natural Gas',
    category: 'energy',
    description: 'Henry Hub natural gas futures.',
    color: '#22d3ee',
    benchmarkNote: 'NYMEX natural gas futures',
  },
  {
    ticker: 'GLD',
    name: 'Gold',
    category: 'metals',
    description: 'Physical gold bullion–backed ETP.',
    color: '#fcd34d',
    benchmarkNote: 'LBMA gold price',
  },
  {
    ticker: 'SLV',
    name: 'Silver',
    category: 'metals',
    description: 'Silver bullion–backed ETP.',
    color: '#94a3b8',
    benchmarkNote: 'Silver spot / futures',
  },
  {
    ticker: 'CPER',
    name: 'Copper',
    category: 'metals',
    description: 'HG copper futures exposure.',
    color: '#b45309',
    benchmarkNote: 'COMEX copper futures',
  },
  {
    ticker: 'DBB',
    name: 'Base Metals',
    category: 'metals',
    description: 'Aluminum, zinc, copper futures basket.',
    color: '#78716c',
    benchmarkNote: 'DBIQ Base Metals Index',
  },
  {
    ticker: 'WEAT',
    name: 'Wheat',
    category: 'agriculture',
    description: 'Wheat futures (CBOT).',
    color: '#84cc16',
    benchmarkNote: 'CBOT wheat futures',
  },
  {
    ticker: 'CORN',
    name: 'Corn',
    category: 'agriculture',
    description: 'Corn futures (CBOT).',
    color: '#65a30d',
    benchmarkNote: 'CBOT corn futures',
  },
  {
    ticker: 'SOYB',
    name: 'Soybeans',
    category: 'agriculture',
    description: 'Soybean futures exposure.',
    color: '#4d7c0f',
    benchmarkNote: 'CBOT soybean futures',
  },
]

export const COMMODITY_TICKERS = COMMODITY_INSTRUMENTS.map((c) => c.ticker)
