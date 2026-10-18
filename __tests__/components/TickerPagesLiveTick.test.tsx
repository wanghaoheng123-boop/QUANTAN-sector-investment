// @vitest-environment jsdom
/**
 * Q-145 (red-team Q145-R2-1) — drive the REAL /stock and /sector pages.
 *
 * The parse-tree guard pinned one SPELLING of the merge on these two pages; the
 * re-gate brought "keep the previous change" back four ways with every test
 * green (a shadowed helper, an early return, the previous change laundered
 * through the helper's second argument, all three at once). This mounts each
 * page, boots a priced quote with a change, then streams a tick that has a
 * price and no change, and asserts what the header SAYS. It also covers the
 * unpriced boot (R2) and an index ticker the route answers as `^VIX` (R2-3).
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNPRICED_REASON } from '@/lib/liveQuoteState'

const { toast } = vi.hoisted(() => ({ toast: { toasts: [], showToast: () => {}, dismissToast: () => {} } }))
vi.mock('@/hooks/useErrorToast', () => ({ useErrorToast: () => toast }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signIn: () => {}, signOut: () => {},
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound') },
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

type Listener = (evt: { data: string }) => void
class ControlledEventSource {
  static all: ControlledEventSource[] = []
  onmessage = null; onerror = null; onopen = null; readyState = 1
  private listeners = new Map<string, Listener[]>()
  constructor(public url: string) { ControlledEventSource.all.push(this) }
  addEventListener(type: string, fn: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
  removeEventListener() {}
  close() {}
  emit(type: string, data: unknown) { for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) }) }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

/** In-memory storage: this runtime's global localStorage is not a usable Storage. */
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
}

function stubNetwork(pricesBody: unknown) {
  const storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  vi.stubGlobal('EventSource', ControlledEventSource)
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(String(url).startsWith('/api/prices') ? json(pricesBody) : json({}))))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); ControlledEventSource.all = [] })

async function mountStock(ticker: string) {
  const { default: StockPage } = await import('@/app/stock/[ticker]/page')
  await act(async () => {
    render(<Suspense fallback={null}><StockPage params={Promise.resolve({ ticker })} /></Suspense>)
  })
}

async function mountSector(slug: string) {
  const { default: SectorPage } = await import('@/app/sector/[slug]/page')
  await act(async () => {
    render(<Suspense fallback={null}><SectorPage params={Promise.resolve({ slug })} /></Suspense>)
  })
}

function streamFor(ticker: string): ControlledEventSource {
  const es = ControlledEventSource.all.find((e) => e.url.includes(`/api/stream/${encodeURIComponent(ticker)}`))
  if (!es) throw new Error(`no stream opened for ${ticker}`)
  return es
}

const tickNoChange = (ticker: string, marketOpen: boolean) => ({
  ticker, price: 252, change: null, changePct: null, marketOpen,
  timestamp: '2026-10-19T15:00:00.000Z', quoteTime: '2026-10-19T14:59:58.000Z',
})

describe.each([
  ['/stock/AAPL', () => mountStock('AAPL'), 'AAPL'],
  ['/sector/technology', () => mountSector('technology'), 'XLK'],
] as const)('%s — a live tick with no change', (_name, mount, ticker) => {
  for (const marketOpen of [true, false]) {
    it(`renders "— (no change data)", never the previous change (market ${marketOpen ? 'open' : 'closed'})`, async () => {
      stubNetwork({ quotes: [{ ticker, price: 250, change: 2.5, changePct: 1.01, volume: 1000, high52w: 260, low52w: 200, pe: 30, marketCap: '1.0T' }], unpriced: [] })
      await mount()
      await waitFor(() => expect(document.body.textContent).toContain('(1.01%)'))
      await waitFor(() => expect(() => streamFor(ticker)).not.toThrow())
      act(() => { streamFor(ticker).emit('quote', tickNoChange(ticker, marketOpen)) })
      await waitFor(() => expect(screen.getByText('— (no change data)')).toBeInTheDocument())
      expect(document.body.textContent).not.toContain('(1.01%)')
      expect(document.body.textContent).not.toMatch(/\(0\.00%\)/)
    })
  }

  it('a degraded stream reads DEGRADED, not CLOSED or LIVE, until a fresh quote (red-team R2-9)', async () => {
    stubNetwork({ quotes: [{ ticker, price: 250, change: 2.5, changePct: 1.01, marketCap: '1.0T' }], unpriced: [] })
    await mount()
    await waitFor(() => expect(() => streamFor(ticker)).not.toThrow())
    act(() => { streamFor(ticker).emit('degraded', { message: 'quote fetch failed' }) })
    await waitFor(() => expect(screen.getByText('DEGRADED')).toBeInTheDocument())
    expect(screen.getByText('DEGRADED').getAttribute('title')).toBe('Stream degraded: quote fetch failed')
    act(() => { streamFor(ticker).emit('quote', { ...tickNoChange(ticker, true), change: 1, changePct: 0.4 }) })
    await waitFor(() => expect(screen.queryByText('DEGRADED')).not.toBeInTheDocument())
  })

  it('an unpriced boot renders "—" with the reason, not a skeleton (red-team R2)', async () => {
    stubNetwork({ quotes: [], unpriced: [ticker] })
    await mount()
    await waitFor(() => expect(screen.getByText(UNPRICED_REASON)).toBeInTheDocument())
  })
})

describe('/stock/vix — the route answers an index as ^VIX (red-team Q145-R2-3)', () => {
  it('the caret-prefixed quote is the page\'s quote, not "did not include this ticker"', async () => {
    stubNetwork({ quotes: [{ ticker: '^VIX', price: 18.5, change: -0.4, changePct: -2.12, marketCap: 'N/A' }], unpriced: [] })
    await mountStock('vix')
    await waitFor(() => expect(document.body.textContent).toContain('(2.12%)'))
    expect(document.body.textContent).not.toContain('did not include this ticker')
  })

  it('a caret-prefixed index named in unpriced is unpriced', async () => {
    stubNetwork({ quotes: [], unpriced: ['^VIX'] })
    await mountStock('vix')
    await waitFor(() => expect(screen.getByText(UNPRICED_REASON)).toBeInTheDocument())
  })
})
