// @vitest-environment jsdom
/**
 * Q-140 red-team B2 — the landing page with /api/briefs answering 429.
 *
 * Measured by the red-team: the header read "Live from Yahoo Finance · 0
 * articles" and the body "No news available at the moment" — a rate-limited
 * request presented as a quiet news day. And /api/prices answering 500 left
 * the page silent, because the 500 body parses as JSON.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

// Toasts expire after 4 s; assert the call, not a transient node.
const showToast = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useErrorToast', () => ({
  useErrorToast: () => ({ toasts: [], showToast, dismissToast: vi.fn() }),
}))

class SilentEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  readyState = 0
  constructor(public url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() { this.readyState = 2 }
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('landing page — a failed news or price fetch is said, not hidden', () => {
  it('a 429 from /api/briefs is not "Live … 0 articles" or "No news available"', async () => {
    vi.stubGlobal('EventSource', SilentEventSource)
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(
      String(url).startsWith('/api/briefs') ? respond(429, { error: 'rate_limited' }) : respond(200, { quotes: [] }),
    )))
    const { default: Page } = await import('@/app/page')
    render(<Page />)
    await waitFor(() => expect(screen.getByText(/Too many requests — the news feed will load on the next visit/)).toBeInTheDocument())
    expect(screen.getByText(/Unavailable · Yahoo Finance/)).toBeInTheDocument()
    expect(screen.queryByText(/Live from Yahoo Finance/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No news available at the moment/)).not.toBeInTheDocument()
  })

  it('a network failure keeps the news feed visibly unavailable after the toast', async () => {
    vi.stubGlobal('EventSource', SilentEventSource)
    vi.stubGlobal('fetch', vi.fn((url: string) => String(url).startsWith('/api/briefs')
      ? Promise.reject(new TypeError('Network request failed'))
      : Promise.resolve(respond(200, { quotes: [] })),
    ))
    const { default: Page } = await import('@/app/page')
    render(<Page />)
    await waitFor(() => expect(screen.getByText('Unavailable · Yahoo Finance')).toBeInTheDocument())
    expect(screen.getByText('The news feed could not be reached. Please try again later.')).toBeInTheDocument()
    expect(screen.queryByText(/No news available at the moment/)).not.toBeInTheDocument()
  })

  it('a 500 from /api/prices raises the price-refresh notice', async () => {
    vi.stubGlobal('EventSource', SilentEventSource)
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(
      String(url).startsWith('/api/prices') ? respond(500, { degraded: false, error: { code: 'upstream', message: 'x' } }) : respond(200, { briefs: [] }),
    )))
    const { default: Page } = await import('@/app/page')
    render(<Page />)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Price refresh failed: HTTP 500', 'warn', 4000))
  })
})
