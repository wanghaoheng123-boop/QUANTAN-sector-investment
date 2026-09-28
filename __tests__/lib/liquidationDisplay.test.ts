/**
 * Q-138 — what the BTC liquidations panel says and how it moves between
 * states. Pure functions, plus the extracted panel RENDERED with
 * react-dom/server — a real render that runs in node (jsdom component tests
 * are CI-only on this machine).
 *
 * Fixtures are hand-made round numbers, not measurements (red-team LOW: the
 * first version reused live OKX figures without an inline derivation).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LIQ_SCOPE_NOTE,
  formatUsdCompact,
  liquidationBias,
  liquidationCards,
  liquidationFreshnessPrefix,
  liquidationWindowLabel,
  nextLiqState,
  unknownLiq,
  type LiqData,
} from '@/lib/liquidationDisplay'
import { LiquidationsPanel } from '@/components/crypto/LiquidationsPanel'
import { stripComments } from '../architecture/sourceText'

const ROOT = join(__dirname, '..', '..')

// Hand-made: 40 long liquidations worth $250,000 and 60 short worth
// $1,250,000; the oldest counted is 90 minutes before the fetch; the page cap
// (100) was hit.
const __SYNTHETIC__LIQ: LiqData & { __SYNTHETIC__: true } = {
  __SYNTHETIC__: true,
  totalLiquidations: 100,
  buyLiquidations: 60,
  sellLiquidations: 40,
  unclassifiedLiquidations: 0,
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
    const c = card(__SYNTHETIC__LIQ, 'Long liquidations (forced sells)')
    expect(c).toMatchObject({ value: '$250.0K', sub: '40 orders', color: 'text-red-400' })
  })

  it('the short-liquidations card shows the BUY side', () => {
    const c = card(__SYNTHETIC__LIQ, 'Short liquidations (forced buys)')
    expect(c).toMatchObject({ value: '$1.25M', sub: '60 orders', color: 'text-green-400' })
  })

  it('bias wording matches the data: LONG_BIAS means longs were force-SOLD', () => {
    expect(liquidationBias('LONG_BIAS')).toEqual({ value: 'Longs liquidated more', color: 'text-red-400' })
    expect(liquidationBias('SHORT_BIAS')).toEqual({ value: 'Shorts liquidated more', color: 'text-green-400' })
    expect(liquidationBias('NEUTRAL').value).toBe('Balanced')
    expect(liquidationBias(null).value).toBe('—')
  })

  it('unclassified liquidations are disclosed, not hidden in the total', () => {
    expect(card({ ...__SYNTHETIC__LIQ, unclassifiedLiquidations: 3 }, 'Liquidations').sub).toBe('latest 100 only · last 1.5h · 3 unclassified')
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

describe('formatUsdCompact', () => {
  it('picks a unit AFTER rounding, and never invents a zero', () => {
    expect(formatUsdCompact(2_500_000_000)).toBe('$2.50B')
    expect(formatUsdCompact(1_250_000)).toBe('$1.25M')
    expect(formatUsdCompact(250_000)).toBe('$250.0K')
    expect(formatUsdCompact(832)).toBe('$832')
    expect(formatUsdCompact(null)).toBe('—')
    expect(formatUsdCompact(Number.NaN)).toBe('—')
  })

  it('red-team LOW: no "$1000.0K" or "$1000.00M" at the unit boundaries', () => {
    expect(formatUsdCompact(999_960)).toBe('$1.00M')
    expect(formatUsdCompact(999_949)).toBe('$999.9K')
    expect(formatUsdCompact(999_996_000)).toBe('$1.00B')
    expect(formatUsdCompact(999.6)).toBe('$1.0K')
  })
})

describe('client state: a failure is never a silent stale number', () => {
  const degradedAnswer = { ok: true as const, data: unknownLiq('Liquidation feed failed to load.') }

  it('a degraded ROUTE answer replaces the last good figures (red-team A7)', () => {
    const next = nextLiqState(__SYNTHETIC__LIQ, degradedAnswer)
    expect(next.degraded).toBe(true)
    expect(next.totalLiquidations).toBeNull()
    expect(next.buyVolume).toBeNull()
  })

  it('a failure the route never saw keeps the figures only MARKED stale', () => {
    const next = nextLiqState(__SYNTHETIC__LIQ, { ok: false, message: 'HTTP 429' })
    expect(next.totalLiquidations).toBe(100)
    expect(next.degraded).toBe(true)
    expect(next.userMessage).toMatch(/latest refresh failed \(HTTP 429\).*last successful load/)
    expect(next.fetchedAt).toBe(__SYNTHETIC__LIQ.fetchedAt) // the age keeps showing
  })

  it('with nothing to keep, a failure is an explicit unknown', () => {
    const next = nextLiqState(null, { ok: false, message: 'network' })
    expect(next).toMatchObject({ totalLiquidations: null, degraded: true })
  })

  it('"Last updated" only when there are figures; otherwise "Last attempt"', () => {
    expect(liquidationFreshnessPrefix(__SYNTHETIC__LIQ)).toBe('Last updated')
    expect(liquidationFreshnessPrefix(unknownLiq('x'))).toBe('Last attempt')
  })
})

describe('the panel as rendered', () => {
  const render = (liq: LiqData | null, fetched = true) =>
    renderToStaticMarkup(createElement(LiquidationsPanel, { liq, loading: false, fetched, cached: false }))
  /** Card text in document order: label, value, sub. */
  const cardText = (html: string) =>
    [...html.matchAll(/data-testid="liq-card"[^>]*>([\s\S]*?)<\/div><\/div>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '|').split('|').filter(Boolean))

  it('ok: four cards, value then sub, no degraded notice, scope stated', () => {
    const html = render(__SYNTHETIC__LIQ)
    expect(html).not.toContain('data-testid="liq-degraded"')
    expect(cardText(html)).toEqual([
      ['Liquidations', '100', 'latest 100 only · last 1.5h'],
      ['Long liquidations (forced sells)', '$250.0K', '40 orders'],
      ['Short liquidations (forced buys)', '$1.25M', '60 orders'],
      ['Net bias', 'Shorts liquidated more', 'by USDT notional, same window'],
    ])
    expect(html).toContain(LIQ_SCOPE_NOTE.replace(/'/g, '&#x27;')) // React escapes the apostrophe
    expect(html).toContain('Last updated:')
  })

  it('degraded: the message renders, every figure is a dash, and it is an attempt, not an update', () => {
    const html = render(unknownLiq('Liquidation feed failed to load.'))
    expect(html).toMatch(/data-testid="liq-degraded"[^>]*>Liquidation feed failed to load\.</)
    for (const [, value] of cardText(html)) expect(value).toBe('—')
    expect(html).toContain('Last attempt:')
    expect(html).not.toMatch(/\$0\b|>0</)
  })

  it('stale: the old figures render beside a notice that says so', () => {
    const html = render(nextLiqState(__SYNTHETIC__LIQ, { ok: false, message: 'HTTP 502' }))
    expect(html).toContain('data-testid="liq-degraded"')
    expect(html).toContain('last successful load')
    expect(cardText(html)[0][1]).toBe('100')
  })
})

describe('the component uses these, and the retired labels are gone', () => {
  const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'))
  const lab = read('components/crypto/BtcQuantLab.tsx')

  it('the lab renders the panel and routes every fetch outcome through nextLiqState', () => {
    expect(lab).toMatch(/<LiquidationsPanel\s+liq=\{liq\}/)
    expect(lab).toContain('setLiq((prev) => nextLiqState(prev, lr))')
    // Only one writer of `liq`, so no path can bypass the transition.
    expect(lab.match(/setLiq\(/g)).toHaveLength(1)
  })

  it('red-team HIGH-2: no liquidation card in the signals grid', () => {
    expect(lab).not.toMatch(/label:\s*'(?:Liquidation Bias|OI Net Direction)'/)
    expect(lab).not.toMatch(/liq\?\.netDirection/)
  })

  it('red-team MEDIUM-4: the Analysis intro does not claim derivatives inputs', () => {
    expect(lab).toContain('It does not use the funding, open-interest or liquidation data')
  })

  const SURFACES = ['components/crypto/BtcQuantLab.tsx', 'components/crypto/LiquidationsPanel.tsx', 'lib/liquidationDisplay.ts', 'components/SiteNav.tsx']
  it.each([
    'OI Net Direction', 'MORE AGG BUY VOLUME', 'MORE AGG SELL VOLUME',
    '>$100k notional', 'Large Trades (24h)', 'Buy (Long Liq)', 'Sell (Short Liq)', '24h liquidation direction',
    'on-chain', 'OKX returns the latest',
  ])('no rendered surface says %s', (retired) => {
    // Case-insensitive: the section header said "On-Chain" and a lowercase
    // pattern let it through on the first pass.
    for (const rel of SURFACES) expect(read(rel).toLowerCase(), rel).not.toContain(retired.toLowerCase())
  })

  it('the comment stripper really removes TRAILING comments (red-team A15)', () => {
    expect(stripComments('x() // liquidationCards(liq).map(')).not.toContain('liquidationCards')
    expect(stripComments("const u = 'https://x.test' // note")).toContain("'https://x.test'")
  })
})
