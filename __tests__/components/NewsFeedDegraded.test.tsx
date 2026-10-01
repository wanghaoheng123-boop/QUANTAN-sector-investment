// @vitest-environment jsdom
/**
 * Q-140 / Q-094 — NewsFeed says when the feed failed, and drops malformed
 * items rather than rendering empty cards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import NewsFeed from '@/components/NewsFeed'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('NewsFeed — degraded and malformed answers', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('an empty list from a FAILED feed is not "no recent news"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({
      news: [], sector: 'technology', fetchedAt: new Date().toISOString(),
      degraded: true, error: { code: 'news_unavailable', message: 'The news feed failed for 5 of 5 lookups; this list may be incomplete.' },
    }))))
    render(<NewsFeed sector="technology" color="#3b82f6" />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('The news feed failed for 5 of 5 lookups'))
    expect(screen.queryByText(/No recent news found/)).not.toBeInTheDocument()
  })

  it('a partial feed shows its items under a "Partial", not "Live", label', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({
      news: [{ title: 'Chipmakers rally', publisher: 'Reuters', link: 'https://example.test/a' }, { title: '' }],
      sector: 'technology', fetchedAt: new Date().toISOString(),
      degraded: true, error: { code: 'news_unavailable', message: 'The news feed failed for 3 of 5 lookups; this list may be incomplete.' },
    }))))
    render(<NewsFeed sector="technology" color="#3b82f6" />)
    await waitFor(() => expect(screen.getByText('Chipmakers rally')).toBeInTheDocument())
    expect(screen.getByText(/Partial · Yahoo Finance/)).toBeInTheDocument()
    expect(screen.queryByText(/Live · Yahoo Finance/)).not.toBeInTheDocument()
    // The malformed item (empty title) is dropped, not rendered as an empty card.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
