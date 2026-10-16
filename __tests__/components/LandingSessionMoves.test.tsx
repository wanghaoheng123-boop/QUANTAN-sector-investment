// @vitest-environment jsdom
/**
 * Q-135 — the landing page shows session moves as measurements: no BUY / SELL
 * / HOLD filter, no "Avg Confidence", and a sector without a quote is counted
 * as "No quote" rather than as a flat 0% move.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../architecture/sourceText'

vi.mock('@/hooks/useErrorToast', () => ({ useErrorToast: () => ({ toasts: [], showToast: vi.fn(), dismissToast: vi.fn() }) }))

class SilentEventSource {
  onmessage = null; onerror = null; onopen = null; readyState = 0
  constructor(public url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('landing page — session moves', () => {
  it('counts sectors without a quote as "No quote", not as flat', async () => {
    vi.stubGlobal('EventSource', SilentEventSource)
    // Synthetic quotes for two sectors only; the other nine have none.
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(String(url).startsWith('/api/prices')
      ? json({ quotes: [{ ticker: 'XLK', price: 250, change: 2.5, changePct: 1.01 }, { ticker: 'XLE', price: 90, change: -0.45, changePct: -0.5 }] })
      : json({ briefs: [] }))))
    const { default: Page } = await import('@/app/page')
    render(<Page />)
    const stats = await screen.findByLabelText('Market overview stats')
    await waitFor(() => expect(within(stats).getByText('No quote').previousElementSibling?.textContent).toMatch(/^9\//))
    expect(within(stats).getByText('Flat (0.00%)').previousElementSibling?.textContent).toMatch(/^0\//)
    expect(within(stats).getByText('Sectors up today').previousElementSibling?.textContent).toMatch(/^1\//)
    expect(screen.queryByText(/Avg Confidence/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BUY' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'UP' })).toBeInTheDocument()
  })

  // Red-team S3 (2026-10-17): the first version matched only the old filter
  // literal `'BUY', 'SELL'`, so "Strong BUY … quality long setup … size position
  // so a 1.5×ATR stop costs ≤1% of account" on the sector page passed it. Its
  // comment stripper also ate everything after `https://` on a line. Bare
  // BUY/SELL/HOLD (upper case, so "not buy/sell advice" is allowed), setups and
  // sizing are now matched, after the TS-emitter comment strip that keeps strings.
  const SIGNAL_WORDS = /\b(?:BUY|SELL|HOLD)\b/
  const ADVICE = /long setup|top warning|size (?:your )?position|stop costs|stop loss|risk\/reward|avg confidence|composite signal|sectors bullish|sectors bearish/i
  const SURFACES = ['app/page.tsx', 'app/sector/[slug]/page.tsx', 'components/SectorCard.tsx', 'components/SessionMoveCard.tsx']

  it('the copy guard catches the sentences it once missed (positive control)', () => {
    const old = 'Strong BUY + price above EMA200 + RSI 50–70 = <strong>quality long setup</strong>. Always size position so a 1.5×ATR stop costs ≤1% of account.'
    expect(old).toMatch(SIGNAL_WORDS)
    expect(old).toMatch(ADVICE)
    expect("{ label: 'Bullish bar / signal', meaning: 'price up vs prior close, or BUY signal' }").toMatch(SIGNAL_WORDS)
    // A URL no longer hides the rest of its line.
    expect(stripComments('const u = "https://x.test"; const s = "Strong BUY"')).toMatch(SIGNAL_WORDS)
    expect('not buy/sell advice').not.toMatch(SIGNAL_WORDS)
  })

  it('no surface promises levels, confidence, risk/reward, setups or sizing', () => {
    const root = join(__dirname, '..', '..')
    for (const f of SURFACES) {
      const src = stripComments(readFileSync(join(root, f), 'utf8'), f)
      expect(src, f).not.toMatch(SIGNAL_WORDS)
      expect(src, f).not.toMatch(ADVICE)
    }
  })
})
