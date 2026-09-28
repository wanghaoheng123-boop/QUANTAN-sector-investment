/**
 * Q-138 — what the BTC liquidations panel says and how it moves between
 * states. Pure functions, plus the props-only view RENDERED with
 * react-dom/server. The container's fetch wiring is covered in jsdom by
 * __tests__/components/crypto/LiquidationsPanel.test.tsx.
 *
 * Fixtures are hand-made round numbers, not measurements.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LIQ_SCOPE_NOTE,
  formatNotional,
  friendlyFailure,
  isLiqPayload,
  liquidationBias,
  liquidationCards,
  liquidationFreshnessPrefix,
  liquidationWindowLabel,
  nextLiqState,
  unknownLiq,
  type LiqData,
} from '@/lib/liquidationDisplay'
import { LiquidationsView } from '@/components/crypto/LiquidationsPanel'
import { stripComments } from '../architecture/sourceText'

const ROOT = join(__dirname, '..', '..')
const AT = '2026-01-01T12:05:00.000Z'

// Hand-made: 40 long liquidations worth 250,000 USDT and 60 short worth
// 1,250,000; the oldest counted is 90 minutes before the fetch; the page cap
// (100) was hit.
const __SYNTHETIC__LIQ: LiqData & { __SYNTHETIC__: true } = {
  __SYNTHETIC__: true,
  totalLiquidations: 100,
  buyLiquidations: 60,
  sellLiquidations: 40,
  buyVolume: 1_250_000,
  sellVolume: 250_000,
  netDirection: 'SHORT_BIAS',
  windowStart: '2026-01-01T10:30:00.000Z',
  fetchedAt: '2026-01-01T12:00:00.000Z',
  truncated: true,
}

const card = (liq: LiqData | null, label: string) => liquidationCards(liq).find((c) => c.label === label)!

describe('long/short mapping — a forced SELL closes a LONG', () => {
  it('the long-liquidations card shows the SELL side', () => {
    expect(card(__SYNTHETIC__LIQ, 'Long liquidations (forced sells)')).toMatchObject({ value: '250.0K USDT', sub: '40 orders', color: 'text-red-400' })
  })

  it('the short-liquidations card shows the BUY side', () => {
    expect(card(__SYNTHETIC__LIQ, 'Short liquidations (forced buys)')).toMatchObject({ value: '1.25M USDT', sub: '60 orders', color: 'text-green-400' })
  })

  it('bias wording matches the data: LONG_BIAS means longs were force-SOLD', () => {
    expect(liquidationBias('LONG_BIAS')).toEqual({ value: 'Longs liquidated more', color: 'text-red-400' })
    expect(liquidationBias('SHORT_BIAS')).toEqual({ value: 'Shorts liquidated more', color: 'text-green-400' })
    expect(liquidationBias('NEUTRAL').value).toBe('Balanced')
    expect(liquidationBias(null).value).toBe('—')
  })
})

describe('the window is what the data covers, never a hardcoded day', () => {
  it('capped: the span back to the oldest liquidation returned, blaming nobody', () => {
    expect(liquidationWindowLabel(__SYNTHETIC__LIQ)).toBe('latest 100 only · last 1.5h')
  })

  it('under an hour reads in minutes', () => {
    expect(liquidationWindowLabel({ ...__SYNTHETIC__LIQ, windowStart: '2026-01-01T11:35:00.000Z' })).toBe('latest 100 only · last 25m')
  })

  it('not capped: the route\'s 24h filter is the window', () => {
    expect(liquidationWindowLabel({ ...__SYNTHETIC__LIQ, truncated: false })).toBe('last 24h')
  })

  it('unknown coverage is said, not guessed', () => {
    expect(liquidationWindowLabel(null)).toBe('window unknown')
    expect(liquidationWindowLabel({ ...__SYNTHETIC__LIQ, truncated: null })).toBe('window unknown')
  })
})

describe('formatNotional — in the settlement currency, never an invented zero', () => {
  it('picks a unit AFTER rounding', () => {
    expect(formatNotional(2_500_000_000)).toBe('2.50B USDT')
    expect(formatNotional(1_250_000)).toBe('1.25M USDT')
    expect(formatNotional(250_000)).toBe('250.0K USDT')
    expect(formatNotional(832)).toBe('832 USDT')
    expect(formatNotional(null)).toBe('—')
    expect(formatNotional(Number.NaN)).toBe('—')
  })

  it('no "1000.0K" or "1000.00M" at the unit boundaries', () => {
    expect(formatNotional(999_960)).toBe('1.00M USDT')
    expect(formatNotional(999_949)).toBe('999.9K USDT')
    expect(formatNotional(999_996_000)).toBe('1.00B USDT')
    expect(formatNotional(999.6)).toBe('1.0K USDT')
  })

  it('round 2: no "$" beside a note that says USDT', () => {
    for (const c of liquidationCards(__SYNTHETIC__LIQ)) expect(c.value).not.toContain('$')
    expect(LIQ_SCOPE_NOTE).toMatch(/USDT/)
  })
})

describe('client state: a failure is never a silent stale number', () => {
  const degradedAnswer = { ok: true as const, data: unknownLiq('Liquidation feed failed to load.', AT) }

  it('a degraded ROUTE answer replaces the last good figures', () => {
    const next = nextLiqState(__SYNTHETIC__LIQ, degradedAnswer, AT)
    expect(next).toMatchObject({ degraded: true, totalLiquidations: null, buyVolume: null })
  })

  it('a failure the route never saw keeps the figures only MARKED stale, in plain words', () => {
    const next = nextLiqState(__SYNTHETIC__LIQ, { ok: false, message: 'HTTP 429' }, AT)
    expect(next.totalLiquidations).toBe(100)
    expect(next.degraded).toBe(true)
    expect(next.userMessage).toBe('The latest refresh failed (too many requests — try again shortly); these figures are from the last successful load.')
    expect(next.fetchedAt).toBe(__SYNTHETIC__LIQ.fetchedAt) // the age keeps showing
  })

  it('round 2: no internal path or raw code reaches the user', () => {
    expect(friendlyFailure('/api/crypto/btc/liquidations → invalid JSON (HTTP 504)')).toBe('server error 504')
    expect(friendlyFailure('rate_limited')).toBe('too many requests — try again shortly')
    expect(friendlyFailure('TypeError: Failed to fetch')).toBe('network error')
    const next = nextLiqState(__SYNTHETIC__LIQ, { ok: false, message: '/api/crypto/btc/liquidations → invalid JSON (HTTP 504)' }, AT)
    expect(next.userMessage).not.toMatch(/\/api\/|JSON/)
  })

  it('with nothing to keep, a failure is an explicit unknown that carries its attempt time', () => {
    const next = nextLiqState(null, { ok: false, message: 'network' }, AT)
    expect(next).toMatchObject({ totalLiquidations: null, degraded: true, fetchedAt: AT })
    // Round 2: after a degraded answer, a client failure used to read "Last attempt: —".
    const again = nextLiqState(unknownLiq('x', '2026-01-01T11:00:00.000Z'), { ok: false, message: 'HTTP 502' }, AT)
    expect(again.fetchedAt).toBe(AT)
  })

  it('round 2: an ok body that is not a payload (an empty 200) is a failure, not a blank panel', () => {
    expect(isLiqPayload(null)).toBe(false)
    expect(isLiqPayload({})).toBe(false)
    expect(isLiqPayload({ totalLiquidations: '100' })).toBe(false)
    expect(isLiqPayload({ totalLiquidations: null })).toBe(true)
    const next = nextLiqState(null, { ok: true, data: null }, AT)
    expect(next).toMatchObject({ degraded: true, fetchedAt: AT })
    expect(next.userMessage).toMatch(/unreadable response/)
  })

  it('"Last updated" only when there are figures; otherwise "Last attempt"', () => {
    expect(liquidationFreshnessPrefix(__SYNTHETIC__LIQ)).toBe('Last updated')
    expect(liquidationFreshnessPrefix(unknownLiq('x', AT))).toBe('Last attempt')
  })
})

describe('the view as rendered', () => {
  const render = (liq: LiqData | null, fetched = true, cached = false) =>
    renderToStaticMarkup(createElement(LiquidationsView, { liq, loading: false, fetched, cached }))
  /** Card text in document order: label, value, sub. */
  const cardText = (html: string) =>
    [...html.matchAll(/data-testid="liq-card"[^>]*>([\s\S]*?)<\/div><\/div>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '|').split('|').filter(Boolean))

  it('ok: four cards, value then sub, no degraded notice, scope stated', () => {
    const html = render(__SYNTHETIC__LIQ)
    expect(html).not.toContain('data-testid="liq-degraded"')
    expect(cardText(html)).toEqual([
      ['Liquidations', '100', 'latest 100 only · last 1.5h'],
      ['Long liquidations (forced sells)', '250.0K USDT', '40 orders'],
      ['Short liquidations (forced buys)', '1.25M USDT', '60 orders'],
      ['Net bias', 'Shorts liquidated more', 'by notional, same window'],
    ])
    expect(html).toContain(LIQ_SCOPE_NOTE.replace(/'/g, '&#x27;')) // React escapes the apostrophe
    expect(html).toMatch(/data-testid="liq-freshness"[^>]*>Last updated: /)
  })

  it('degraded: the message renders, every figure is a dash, and it is an attempt with a time', () => {
    const html = render(unknownLiq('Liquidation feed failed to load.', new Date().toISOString()))
    expect(html).toMatch(/data-testid="liq-degraded"[^>]*>Liquidation feed failed to load\.</)
    for (const [, value] of cardText(html)) expect(value).toBe('—')
    expect(html).toMatch(/data-testid="liq-freshness"[^>]*>Last attempt: (?!—)/)
  })

  it('stale: the old figures render beside a notice that says so', () => {
    const html = render(nextLiqState(__SYNTHETIC__LIQ, { ok: false, message: 'HTTP 502' }, AT))
    expect(html).toContain('data-testid="liq-degraded"')
    expect(html).toContain('last successful load')
    expect(cardText(html)[0][1]).toBe('100')
  })

  it('a served-from-cache answer is badged (I2)', () => {
    expect(render(__SYNTHETIC__LIQ, true, true)).not.toBe(render(__SYNTHETIC__LIQ, true, false))
  })
})

describe('the lab no longer touches liquidation data, and the retired labels are gone', () => {
  const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), rel)
  const lab = read('components/crypto/BtcQuantLab.tsx')
  const panel = read('components/crypto/LiquidationsPanel.tsx')

  it('the lab renders the self-contained panel and holds no liquidation state', () => {
    expect(lab).toMatch(/<LiquidationsPanel\s*\/>/)
    // Round 2 X1: a card under ANY label reading the liquidation payload.
    expect(lab).not.toMatch(/\bliq\b|netDirection|btc\/liquidations|LiqData/)
  })

  it('the panel routes every fetch outcome through nextLiqState, and badges the cache', () => {
    expect(panel).toContain('nextLiqState(prev, result,')
    expect(panel.match(/setLiq\(/g)).toHaveLength(1)
    expect(panel).toMatch(/_cached/)
    expect(panel).toMatch(/cached && <DataFreshnessIndicator cached compact\s*\/>/)
  })

  it('round 2 MEDIUM-1: the lab renders a real badge for its OWN cache flag (metrics)', () => {
    expect(lab).toMatch(/metricsCached && \(\s*<div[^>]*><DataFreshnessIndicator cached compact\s*\/><\/div>/)
  })

  it('round 2 MEDIUM-2: the Analysis intro names the timeframe it depends on', () => {
    expect(lab).toContain('This analysis reads only the price candles last loaded on the Chart tab')
    expect(lab).toContain('It does not use the funding, open-interest or liquidation data')
    expect(lab).not.toContain('reads only the daily candles')
  })

  const SURFACES = ['components/crypto/BtcQuantLab.tsx', 'components/crypto/LiquidationsPanel.tsx', 'lib/liquidationDisplay.ts', 'components/SiteNav.tsx']
  it.each([
    'OI Net Direction', 'MORE AGG BUY VOLUME', 'MORE AGG SELL VOLUME',
    '>$100k notional', 'Large Trades (24h)', 'Buy (Long Liq)', 'Sell (Short Liq)', '24h liquidation direction',
    'on-chain', 'OKX returns the latest', 'unclassified',
  ])('no rendered surface says %s', (retired) => {
    for (const rel of SURFACES) expect(read(rel).toLowerCase(), rel).not.toContain(retired.toLowerCase())
  })

  it('the stripper removes TRAILING and post-apostrophe JSX comments (red-team A15, S1)', () => {
    expect(stripComments('x() // liquidationCards(liq).map(')).not.toContain('liquidationCards')
    expect(stripComments("const u = 'https://x.test' // note")).toContain("'https://x.test'")
    expect(stripComments("const a = <p>Don't {/* reads only the daily candles */} x</p>")).not.toContain('daily candles')
  })
})
