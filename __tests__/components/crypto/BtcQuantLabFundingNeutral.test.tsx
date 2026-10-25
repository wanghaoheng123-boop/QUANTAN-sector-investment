// @vitest-environment jsdom
/**
 * Q153-R2-1 — funding's BULLISH / BEARISH is a CONTRARIAN lean (crowded shorts
 * read BULLISH, lib/crypto.ts interpretFundingRate): the same shape as an
 * oversold RSI, which round 2 already stopped colouring. The grid cell was
 * green / orange and the Funding & OI card cyan / orange, so the commit's "one
 * neutral colour" was not true of the BTC lab. The WORDS are unchanged — they
 * are owner-gated (Q-083); only the colour went.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import BtcQuantLab from '@/components/crypto/BtcQuantLab'

const __SYNTHETIC__CANDLES = Array.from({ length: 60 }, (_, i) => ({
  time: 1_700_000_000 + i * 86_400, open: 60_000 + i * 10, high: 60_200 + i * 10, low: 59_800 + i * 10, close: 60_050 + i * 10, volume: 1_000,
}))

const VALENCE = /green|red|orange|amber|cyan|sky|lime|emerald|rose|teal/

function metrics(fundingRate: number): Response {
  return new Response(JSON.stringify({
    fundingRate, nextFundingTime: null, openInterest: 1e10, accountBuyRatio: null, accountSellRatio: null,
    longShortRatio: 1.1, longAccountPct: 0.52, shortAccountPct: 0.48, source: 'Bybit', fetchedAt: new Date().toISOString(),
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Every class on the element and its descendants, joined. */
function classesOf(el: Element): string {
  return [el, ...Array.from(el.querySelectorAll('*'))].map((e) => e.getAttribute('class') ?? '').join(' ')
}

describe('BtcQuantLab — funding is described, not colour-coded', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it.each([
    ['crowded shorts (BULLISH lean)', -0.001, 'BULLISH', '-0.1000%'],
    ['crowded longs (BEARISH lean)', 0.001, 'BEARISH', '0.1000%'],
  ])('%s: the word is unchanged and neither funding cell carries a valence colour', async (_name, rate, word, shown) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(metrics(rate))))
    render(<BtcQuantLab candles={__SYNTHETIC__CANDLES} />)
    await waitFor(() => expect(screen.getAllByText(shown).length).toBe(2)) // grid cell + Funding & OI card

    const gridCell = screen.getByText('Funding Rate').parentElement as HTMLElement
    expect(gridCell.textContent).toContain(word)
    expect(classesOf(gridCell)).not.toMatch(VALENCE)

    const card = screen.getByText('Funding Rate (8h)').parentElement as HTMLElement
    expect(card.textContent).toContain(shown)
    expect(classesOf(card)).not.toMatch(VALENCE)
  })

  it('the disclaimer says the funding figure is a per-interval percentage, not "decimal form"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(metrics(0.0001))))
    render(<BtcQuantLab candles={__SYNTHETIC__CANDLES} />)
    expect(screen.getByText(/Funding is the exchange's per-interval rate, shown as a percentage \(not annualised\)\./)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/decimal form/i)
  })
})
