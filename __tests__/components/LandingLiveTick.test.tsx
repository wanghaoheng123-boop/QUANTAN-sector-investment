// @vitest-environment jsdom
/**
 * Q-145 (red-team Q145-R1) — drive the REAL landing page with a live tick that
 * carries a price and no change, after a REST quote that had one.
 *
 * The red-team made the page keep the previous change (a stale move shown as
 * live) and every test stayed green, because nothing drove a tick through the
 * page. This one does: the multiplexed stream is a controllable EventSource,
 * and the assertion is on the rendered counts.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A STABLE toast object: the page's REST fetch is a useCallback on showToast,
// so a fresh vi.fn() per render re-ran the boot fetch on every render and
// overwrote the tick under test with the REST row.
const { toast } = vi.hoisted(() => ({ toast: { toasts: [], showToast: () => {}, dismissToast: () => {} } }))
vi.mock('@/hooks/useErrorToast', () => ({ useErrorToast: () => toast }))

type Listener = (evt: { data: string }) => void

class ControlledEventSource {
  static last: ControlledEventSource | null = null
  onmessage = null; onerror = null; onopen = null; readyState = 1
  private listeners = new Map<string, Listener[]>()
  constructor(public url: string) { ControlledEventSource.last = this }
  addEventListener(type: string, fn: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
  removeEventListener() {}
  close() {}
  emit(type: string, data: unknown) { for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) }) }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => { cleanup(); vi.unstubAllGlobals(); ControlledEventSource.last = null })

const count = (stats: HTMLElement, label: string) => within(stats).getByText(label).previousElementSibling?.textContent ?? ''

describe('landing page — a live tick with no change', () => {
  it('renders the sector as having no change data, never its previous change or 0.00%', async () => {
    vi.stubGlobal('EventSource', ControlledEventSource)
    // Synthetic quotes: XLK and XLE have a change; the other nine have no quote.
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(String(url).startsWith('/api/prices')
      ? json({ quotes: [{ ticker: 'XLK', price: 250, change: 2.5, changePct: 1.01 }, { ticker: 'XLE', price: 90, change: -0.45, changePct: -0.5 }] })
      : json({ briefs: [] }))))
    const { default: Page } = await import('@/app/page')
    render(<Page />)
    const stats = await screen.findByLabelText('Market overview stats')
    await waitFor(() => expect(count(stats, 'Sectors up today')).toMatch(/^1\//))
    expect(count(stats, 'No change data')).toMatch(/^9\//)

    await waitFor(() => expect(ControlledEventSource.last).not.toBeNull())
    act(() => {
      ControlledEventSource.last!.emit('quote', {
        ticker: 'XLK', price: 252, change: null, changePct: null, marketOpen: true,
        timestamp: '2026-10-19T15:00:00.000Z', quoteTime: '2026-10-19T14:59:58.000Z',
      })
    })

    // XLK's previous +1.01% must not survive the tick, and must not become a FLAT 0.00%.
    await waitFor(() => expect(count(stats, 'No change data')).toMatch(/^10\//))
    expect(count(stats, 'Sectors up today')).toMatch(/^0\//)
    expect(count(stats, 'Flat (0.00%)')).toMatch(/^0\//)
    expect(count(stats, 'Sectors down today')).toMatch(/^1\//)
  })
})
