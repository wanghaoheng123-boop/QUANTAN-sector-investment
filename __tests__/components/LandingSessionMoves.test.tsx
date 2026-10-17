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
import { renderedPhrases, stripComments } from '../architecture/sourceText'

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
  // literal `'BUY', 'SELL'`. Round 2 (R2-239-2): the fix was a phrase list
  // tuned to the deleted sentences, so "Strong Buy … the setup to take.
  // Position sizing: risk 1% of your account per trade, with a stop-loss
  // 1.5×ATR below entry" passed it. The scan now reads the USER-VISIBLE text
  // (JSX text and string literals, via skill-wording's `renderedPhrases`) and
  // matches trade imperatives case-insensitively; only the disclaimers below
  // may mention buy/sell, and the positive controls are paraphrases, not the
  // deleted sentences.
  const SIGNAL_WORDS = /\b(?:BUY|SELL|HOLD)\b/
  const TRADE_WORDS = /\b(?:buy|sell|hold|accumulate|overweight|underweight)\b|\bgo (?:long|short)\b|\blong setup\b/i
  const RISK_WORDS = /stop[- ]?loss|position[- ]?siz|size (?:your |the )?position|take[- ]?profit|\brisk \d|\bentry\b|\btarget\b|setup to take|\d\s*[×x]\s*ATR\b|top warning|risk\/reward|avg confidence|composite signal|sectors (?:bullish|bearish)/i
  /** The only sentences on these surfaces allowed to name buy/sell: disclaimers. */
  const DISCLAIMERS = [/not (?:a )?forecast or a buy\/sell signal/gi, /not a recommendation to buy or sell/gi, /recommendation to buy or sell/gi, /not buy\/sell advice/gi, /not a trade signal(?:: no entry, stop or target is computed)?/gi]
  const SURFACES = ['app/page.tsx', 'app/sector/[slug]/page.tsx', 'components/SectorCard.tsx', 'components/SessionMoveCard.tsx']
  const offending = (text: string) => {
    const t = DISCLAIMERS.reduce((acc, re) => acc.replace(re, ' '), text)
    return TRADE_WORDS.test(t) || RISK_WORDS.test(t)
  }

  it('the copy guard catches paraphrases of trade advice, not just the deleted sentences (positive control)', () => {
    for (const s of [
      'Strong Buy + price above EMA200 + RSI 50–70 is the setup to take.',
      'Position sizing: risk 1% of your account per trade, with a stop-loss 1.5×ATR below entry.',
      'Buy when RSI drops below 30; sell above 70.',
      'Go long above the 200-day EMA; exit below it.',
      'Place your stop 1.5×ATR below entry and take profit at 2R.',
      'Accumulate on dips to the lower Bollinger band.',
      'A strong buy signal fires when MACD crosses up.',
      'Overweight this sector when breadth turns positive.',
      'Entry: next open. Target: +5%. Stop-loss: −2%.',
    ]) expect(offending(s), s).toBe(true)
    for (const s of ['It is a measurement of the move, not a forecast or a buy/sell signal.', 'Nothing here is a recommendation to buy or sell.']) {
      expect(offending(s), s).toBe(false)
    }
    // The visitor reaches JSX text and string literals, not only the decider.
    expect(renderedPhrases('const x = <p>Buy when RSI drops below 30</p>').some(offending)).toBe(true)
    expect(renderedPhrases("const y = { meaning: 'price up vs prior close, or BUY signal' }").some(offending)).toBe(true)
  })

  it('no surface promises levels, confidence, risk/reward, setups, sizing or trade actions', () => {
    const root = join(__dirname, '..', '..')
    for (const f of SURFACES) {
      const raw = readFileSync(join(root, f), 'utf8')
      expect(stripComments(raw, f), f).not.toMatch(SIGNAL_WORDS)
      const phrases = renderedPhrases(stripComments(raw, f))
      expect(phrases.length, `${f}: the extractor found no copy, so this check would be vacuous`).toBeGreaterThan(3)
      expect(phrases.filter(offending), f).toEqual([])
    }
  })
})
