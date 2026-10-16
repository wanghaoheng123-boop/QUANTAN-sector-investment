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
    expect(within(stats).getByText('Flat (±0.01%)').previousElementSibling?.textContent).toMatch(/^0\//)
    expect(within(stats).getByText('Sectors up today').previousElementSibling?.textContent).toMatch(/^1\//)
    expect(screen.queryByText(/Avg Confidence/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BUY' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'UP' })).toBeInTheDocument()
  })

  it('no surface promises levels, confidence or risk/reward the producer does not supply', () => {
    const root = join(__dirname, '..', '..')
    for (const f of ['app/page.tsx', 'app/sector/[slug]/page.tsx', 'components/SectorCard.tsx', 'components/SessionMoveCard.tsx']) {
      const src = readFileSync(join(root, f), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
      expect(src, f).not.toMatch(/stop loss|risk\/reward|Avg Confidence|Composite signal|Sectors Bullish|Sectors Bearish|'BUY', 'SELL'/i)
    }
  })
})
