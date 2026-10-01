// @vitest-environment jsdom
/**
 * Q-118 / I2 — the global search box says when search is DOWN, instead of
 * rendering an outage as "no results". The route answers `degraded: true` with
 * `error.message` (HTTP 200) when Yahoo's search fails; before, the client
 * showed raw codes ("rate_limited", "search_unavailable") or nothing at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import GlobalSearch from '@/components/GlobalSearch'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function search(text: string) {
  const input = screen.getByLabelText('Search stocks and ETFs')
  await act(async () => { fireEvent.change(input, { target: { value: text } }) })
}

describe('GlobalSearch — degraded answers are said', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('shows the route message when search is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({
      degraded: true, error: { code: 'search_unavailable', message: 'Search is temporarily unavailable — try again shortly.' },
    }))))
    render(<GlobalSearch />)
    await search('bank')
    await waitFor(() => expect(screen.getByText('Search is temporarily unavailable — try again shortly.')).toBeInTheDocument(), { timeout: 3000 })
  })

  it('a 429 reads as a plain sentence, not the raw code', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ error: 'rate_limited' }, 429))))
    render(<GlobalSearch />)
    await search('bank')
    await waitFor(() => expect(screen.getByText('Too many searches — try again in a moment.')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByText('rate_limited')).not.toBeInTheDocument()
  })
})
