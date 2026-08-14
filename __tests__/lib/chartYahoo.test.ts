/**
 * UX-22 — bar-granularity SSOT for the chart's "INTRADAY / DAILY+ BARS" badge.
 *
 * The badge was built from hand-maintained inline lists that drifted between
 * the two pages sharing the timeframe rail (the stock page omitted `1m`/`3m`,
 * so a 1-minute chart announced "DAILY+ BARS"). These tests pin the label for
 * ALL 15 range tokens so any future edit to the rail has to state its intent.
 *
 * The expectations below are derived from the interval the chart API actually
 * fetches per token (app/api/chart/[ticker]/route.ts) — NOT from
 * `isStockIntradayPollRange`, whose 8-token set answers "should this range
 * poll?" and includes `1D`/`1W`, both served as `interval: '1d'`.
 */
import { describe, expect, it } from 'vitest'
import {
  STOCK_CHART_RANGES,
  chartBarKindLabel,
  isIntradayBarRange,
  isStockIntradayPollRange,
} from '@/lib/chartYahoo'

/** range token → the interval app/api/chart/[ticker]/route.ts requests. */
const ROUTE_INTERVAL: Record<string, string> = {
  '1m': '1m',
  '3m': '3m', // aggregated from 1m
  '5m': '5m',
  '15m': '15m',
  '1H': '1h',
  '4H': '1h',
  '1D': '1d',
  '1W': '1d',
  '1M': '1d',
  '3M': '1d',
  '6M': '1d',
  '1Y': '1d',
  '2Y': '1wk',
  '5Y': '1wk',
  'ALL': '1mo',
}

describe('chart bar-granularity label (UX-22)', () => {
  it('covers every published range token', () => {
    expect(Object.keys(ROUTE_INTERVAL).sort()).toEqual([...STOCK_CHART_RANGES].sort())
  })

  it.each([...STOCK_CHART_RANGES])('labels %s from the interval it actually fetches', (range) => {
    // Sub-daily Yahoo intervals end in minutes ('15m') or hours ('1h');
    // '1d' / '1wk' / '1mo' do not.
    const intraday = /(m|h)$/.test(ROUTE_INTERVAL[range])
    expect(isIntradayBarRange(range)).toBe(intraday)
    expect(chartBarKindLabel(range)).toBe(intraday ? 'INTRADAY' : 'DAILY+')
  })

  it('is INTRADAY for exactly the six sub-daily tokens', () => {
    expect(STOCK_CHART_RANGES.filter(isIntradayBarRange)).toEqual([
      '1m', '3m', '5m', '15m', '1H', '4H',
    ])
  })

  it('treats an unknown token as DAILY+, matching the route default', () => {
    expect(chartBarKindLabel('nonsense')).toBe('DAILY+')
    expect(isIntradayBarRange('')).toBe(false)
  })

  it('is NOT the poll predicate: 1D and 1W poll but draw daily bars', () => {
    for (const range of ['1D', '1W']) {
      expect(isStockIntradayPollRange(range)).toBe(true)  // polls (short lookback)
      expect(isIntradayBarRange(range)).toBe(false)       // …with interval '1d'
    }
  })

  it('the poll predicate still covers all six intraday-bar tokens', () => {
    for (const range of STOCK_CHART_RANGES.filter(isIntradayBarRange)) {
      expect(isStockIntradayPollRange(range)).toBe(true)
    }
  })
})
