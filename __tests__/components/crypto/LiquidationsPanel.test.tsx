// @vitest-environment jsdom
/**
 * Q-138 round 2 — the container's fetch WIRING, which node tests cannot reach.
 *
 * The red team showed that the earlier split (the lab holding liquidation
 * state and passing it down) could be broken without any test failing: an
 * early `return` before the state transition, or `cached={false}`, left the
 * last good numbers unmarked after a 429 / 5xx / network error. The panel now
 * owns its fetch; these tests drive it through a real render with a mocked
 * `fetch`, so a wiring change that skips `nextLiqState` fails here.
 *
 * The pure transitions and the rendered view are also covered in node by
 * __tests__/lib/liquidationDisplay.test.ts. (An earlier note here said jsdom
 * tests hang on this machine. They do not — all 15 component/hook files ran
 * locally in 3s on 2026-09-28; the "hang" was `timeout` not existing on macOS.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LiquidationsPanel } from '@/components/crypto/LiquidationsPanel'

// Hand-made payload: 40 longs worth 250,000 USDT, 60 shorts worth 1,250,000.
const __SYNTHETIC__OK = {
  __SYNTHETIC__: true,
  totalLiquidations: 100,
  buyLiquidations: 60,
  sellLiquidations: 40,
  buyVolume: 1_250_000,
  sellVolume: 250_000,
  netDirection: 'SHORT_BIAS',
  windowStart: new Date(Date.now() - 90 * 60_000).toISOString(),
  truncated: true,
  fetchedAt: new Date().toISOString(),
  _cached: false,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('LiquidationsPanel — fetch wiring', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the figures from a good answer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(__SYNTHETIC__OK))))
    render(<LiquidationsPanel />)
    await waitFor(() => expect(screen.getByText('1.25M USDT')).toBeInTheDocument())
    expect(screen.getByText('250.0K USDT')).toBeInTheDocument()
    expect(screen.queryByTestId('liq-degraded')).not.toBeInTheDocument()
  })

  it('a 429 AFTER a good answer keeps the figures only MARKED stale', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(__SYNTHETIC__OK))
      .mockResolvedValueOnce(json({ error: 'rate_limited' }, 429))
    vi.stubGlobal('fetch', fetchMock)
    render(<LiquidationsPanel />)
    await waitFor(() => expect(screen.getByText('1.25M USDT')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByTestId('liq-degraded')).toHaveTextContent('last successful load'))
    expect(screen.getByText('1.25M USDT')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a degraded ROUTE answer after a good one replaces the figures with an explicit unknown', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(__SYNTHETIC__OK))
      .mockResolvedValueOnce(json({
        totalLiquidations: null, buyLiquidations: null, sellLiquidations: null,
        buyVolume: null, sellVolume: null, netDirection: null, windowStart: null, truncated: null,
        degraded: true, userMessage: 'Liquidation feed failed to load.', fetchedAt: new Date().toISOString(),
      })))
    render(<LiquidationsPanel />)
    await waitFor(() => expect(screen.getByText('1.25M USDT')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByTestId('liq-degraded')).toHaveTextContent('Liquidation feed failed to load.'))
    expect(screen.queryByText('1.25M USDT')).not.toBeInTheDocument()
  })

  it('a network error with nothing to keep is an explicit unknown, not a blank or zero panel', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    render(<LiquidationsPanel />)
    await waitFor(() => expect(screen.getByTestId('liq-degraded')).toHaveTextContent('could not be loaded (network error)'))
    expect(screen.getByTestId('liq-freshness')).toHaveTextContent(/^Last attempt: (?!—)/)
  })
})
