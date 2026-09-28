/**
 * Q-138 — what the BTC liquidations panel says. Pure functions, so the wording
 * is pinned in node (jsdom component tests are CI-only on this machine).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  formatUsdCompact,
  liquidationBias,
  liquidationCards,
  liquidationWindowLabel,
  type LiqData,
} from '@/lib/liquidationDisplay'

const ROOT = join(__dirname, '..', '..')

const __SYNTHETIC__LIQ: LiqData & { __SYNTHETIC__: true } = {
  __SYNTHETIC__: true,
  totalLiquidations: 100,
  buyLiquidations: 86,   // SHORT positions force-bought
  sellLiquidations: 14,  // LONG positions force-sold
  buyVolume: 1_017_140.93,
  sellVolume: 158_623.95,
  netDirection: 'SHORT_BIAS',
  windowStart: '2026-09-28T10:36:00.000Z',
  fetchedAt: '2026-09-28T12:00:00.000Z',
  truncated: true,
}

const card = (liq: LiqData | null, label: string) => liquidationCards(liq).find((c) => c.label === label)!

describe('long/short mapping — a forced SELL closes a LONG', () => {
  it('the long-liquidations card shows the SELL side', () => {
    const c = card(__SYNTHETIC__LIQ, 'Long liquidations (forced sells)')
    expect(c.value).toBe('$158.6K')
    expect(c.sub).toBe('14 orders')
    expect(c.color).toBe('text-red-400')
  })

  it('the short-liquidations card shows the BUY side', () => {
    const c = card(__SYNTHETIC__LIQ, 'Short liquidations (forced buys)')
    expect(c.value).toBe('$1.02M')
    expect(c.sub).toBe('86 orders')
    expect(c.color).toBe('text-green-400')
  })

  it('bias wording matches the data: LONG_BIAS means longs were force-SOLD', () => {
    expect(liquidationBias('LONG_BIAS')).toMatchObject({ value: 'Longs liquidated more', signal: 'LONGS FORCE-SOLD', color: 'text-red-400' })
    expect(liquidationBias('SHORT_BIAS')).toMatchObject({ value: 'Shorts liquidated more', signal: 'SHORTS FORCE-BOUGHT', color: 'text-green-400' })
    expect(liquidationBias('NEUTRAL').value).toBe('Balanced')
    // The old Signals card rendered LONG_BIAS as "MORE AGG BUY VOLUME".
    expect(liquidationBias('LONG_BIAS').signal).not.toMatch(/BUY/)
  })
})

describe('the window is what the data covers, never a hardcoded day', () => {
  it('truncated: the span back to the oldest liquidation returned', () => {
    expect(liquidationWindowLabel(__SYNTHETIC__LIQ)).toBe('last 1.4h only (OKX returns the latest 100)')
    expect(card(__SYNTHETIC__LIQ, 'Liquidations').sub).toBe('last 1.4h only (OKX returns the latest 100)')
  })

  it('under an hour reads in minutes', () => {
    expect(liquidationWindowLabel({ ...__SYNTHETIC__LIQ, windowStart: '2026-09-28T11:35:00.000Z' })).toBe('last 25m only (OKX returns the latest 100)')
  })

  it('not truncated: the route\'s 24h filter is the window', () => {
    expect(liquidationWindowLabel({ ...__SYNTHETIC__LIQ, truncated: false })).toBe('last 24h')
  })

  it('unknown coverage is said, not guessed', () => {
    expect(liquidationWindowLabel(null)).toBe('window unknown')
    expect(liquidationWindowLabel({ ...__SYNTHETIC__LIQ, truncated: null })).toBe('window unknown')
  })
})

describe('a degraded feed renders as unknown, never as zero', () => {
  const degraded: LiqData = {
    totalLiquidations: null, buyLiquidations: null, sellLiquidations: null,
    buyVolume: null, sellVolume: null, netDirection: null, windowStart: null, truncated: null,
    degraded: true, userMessage: 'Liquidation feed failed to load.',
  }

  it('every card value and count is a dash', () => {
    for (const c of liquidationCards(degraded)) {
      expect(c.value, c.label).toBe('—')
      expect(c.sub, c.label).not.toMatch(/\b0\b|\$0/)
    }
  })

  it('a measured zero is still a zero', () => {
    const zero: LiqData = { ...degraded, degraded: undefined, totalLiquidations: 0, buyLiquidations: 0, sellLiquidations: 0, buyVolume: 0, sellVolume: 0, netDirection: 'NEUTRAL', truncated: false }
    expect(card(zero, 'Liquidations').value).toBe('0')
    expect(card(zero, 'Long liquidations (forced sells)').value).toBe('$0')
    expect(card(zero, 'Long liquidations (forced sells)').sub).toBe('0 orders')
  })
})

describe('formatUsdCompact', () => {
  it('picks a unit that fits, and never invents a zero', () => {
    expect(formatUsdCompact(2_500_000_000)).toBe('$2.50B')
    expect(formatUsdCompact(1_017_140.93)).toBe('$1.02M')
    expect(formatUsdCompact(158_623.95)).toBe('$158.6K')
    expect(formatUsdCompact(832)).toBe('$832')
    expect(formatUsdCompact(null)).toBe('—')
    expect(formatUsdCompact(Number.NaN)).toBe('—')
  })
})

describe('the component renders these, and the retired labels are gone', () => {
  const src = readFileSync(join(ROOT, 'components/crypto/BtcQuantLab.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/^\s*\/\/.*$/gm, '')

  it('uses the derived cards and bias', () => {
    expect(src).toContain('liquidationCards(liq).map(')
    expect(src).toContain('liquidationBias(liq?.netDirection)')
    expect(src).toMatch(/liq\?\.degraded &&/)
  })

  it.each([
    'OI Net Direction', 'MORE AGG BUY VOLUME', 'MORE AGG SELL VOLUME',
    '>$100k notional', 'Large Trades (24h)', 'Buy (Long Liq)', 'Sell (Short Liq)', '24h liquidation direction',
    'on-chain derivatives', 'On-Chain & Derivatives',
  ])('no longer says %s', (retired) => {
    // Case-insensitive: the section header said "On-Chain" and a lowercase
    // pattern let it through on the first pass.
    expect(src.toLowerCase()).not.toContain(retired.toLowerCase())
  })
})
