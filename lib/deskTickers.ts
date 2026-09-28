import { SECTORS } from '@/lib/sectors'
import { COMMODITY_TICKERS } from '@/lib/commodities'

/** Single basket for pro desk & consolidated quote refresh */
export const DESK_TICKERS = [
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  '^VIX',
  ...SECTORS.map((s) => s.etf),
  ...COMMODITY_TICKERS,
]
