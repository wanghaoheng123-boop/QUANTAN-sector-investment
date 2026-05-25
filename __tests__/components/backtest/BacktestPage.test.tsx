// @vitest-environment jsdom
/**
 * Q-058-NEW — Snapshot tests for app/backtest/page.tsx (887 LOC).
 *
 * Phase 16 S1.3 precondition for:
 *   1. Q-054-NEW page decomposition (887 → ≤200 LOC shell + presentational
 *      sub-components: AnalysisTab, WalkForwardPanel, LiveSignalsPanel, etc.)
 *   2. Q-057-NEW Next.js upgrade verification (App Router cache semantics
 *      changed in 15.x; this page uses `'use client'` + `fetch` + `useEffect`
 *      patterns that need to survive the migration)
 *
 * Same approach as QuantLabPanel.test.tsx: pin the deterministic
 * loading + error states. The data state is heavy DOM (~6 sections, ~30
 * metrics, charts) and would couple the test to every copy/style tweak.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import BacktestPage from '@/app/backtest/page'

describe('BacktestPage (Q-058-NEW snapshot precondition)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders centered loading spinner with copy while fetch is in flight', () => {
    // Pending promise keeps the component in `loading=true, data=null`.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    const { container } = render(<BacktestPage />)

    expect(screen.getByText('Loading backtest data…')).toBeInTheDocument()
    expect(
      screen.getByText(/Fetching 5Y history for 56 instruments/i),
    ).toBeInTheDocument()
    // The loading view is a full-bleed centered card — no header, no tabs,
    // no metrics. Q-054-NEW must preserve this contract.
    expect(screen.queryByText('Institutional Backtest')).not.toBeInTheDocument()

    expect(container.firstChild).toMatchSnapshot()
  })

  it('renders error fallback with Retry button when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('Internal Server Error', {
            status: 500,
            statusText: 'Internal Server Error',
          }),
        ),
      ),
    )

    const { container } = render(<BacktestPage />)

    // The error block reads `error ?? 'Unknown error'` and shows `HTTP 500`
    // for non-2xx responses (per the fetch handler).
    await waitFor(() =>
      expect(screen.getByText('Failed to load backtest')).toBeInTheDocument(),
    )

    expect(screen.getByText('HTTP 500')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()

    expect(container.firstChild).toMatchSnapshot()
  })

  it('handles network rejection without crashing (AbortError swallowed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ENETUNREACH'))),
    )

    render(<BacktestPage />)

    // Non-Abort errors flow into setError and surface in the UI.
    await waitFor(() =>
      expect(screen.getByText('ENETUNREACH')).toBeInTheDocument(),
    )
  })
})
