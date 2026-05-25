// @vitest-environment jsdom
/**
 * Q-058-NEW — Snapshot tests for components/stock/QuantLabPanel.tsx (1684 LOC).
 *
 * Phase 16 S1.3 precondition for:
 *   1. Q-053-NEW god-component decomposition (1684 → 5 sub-tabs ≤ 400 LOC each)
 *   2. Q-057-NEW Next.js upgrade verification (App Router middleware changes
 *      could alter cookie/header propagation that this component relies on)
 *
 * The tests pin the deterministic entry-point UI states (loading + error) so
 * future refactors can be reviewed against an unchanged DOM shape. Data-state
 * snapshots are intentionally NOT captured — the populated UI is ~80KB of
 * conditional rendering and would couple this test to every product copy
 * change. The loading + error skeletons are the structural guardrails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import QuantLabPanel from '@/components/stock/QuantLabPanel'

describe('QuantLabPanel (Q-058-NEW snapshot precondition)', () => {
  beforeEach(() => {
    // sessionStorage shim is provided by jsdom. Component reads
    // `llm_api_key` on mount; ensure a clean slate so snapshots stay
    // deterministic across test runs.
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders loading skeleton with tabs while fundamentals fetch is in flight', () => {
    // Pending promise: fetch never resolves, so the component stays in
    // `loading=true, data=null` for the duration of this test render.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    const { container } = render(<QuantLabPanel ticker="AAPL" />)

    // Spot checks before the snapshot — if these fail, the snapshot diff
    // would be noisy and uninformative. These are the load-bearing pieces.
    expect(screen.getByText('Quant Lab')).toBeInTheDocument()
    // Pre-data, ticker appears twice: in the chip and as the headline fallback
    // (`data?.narrative?.name ?? ticker`). Use getAllByText to assert both.
    expect(screen.getAllByText('AAPL').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(screen.getByText('Technicals & RS')).toBeInTheDocument()
    expect(screen.getByText('Financials')).toBeInTheDocument()
    expect(screen.getByText('Valuation')).toBeInTheDocument()
    expect(screen.getByText('LLM Agents')).toBeInTheDocument()
    expect(screen.getByText('Codex frameworks')).toBeInTheDocument()

    // Snapshot guards against accidental DOM-shape drift during a future
    // Q-053-NEW decomposition or Q-057-NEW Next.js upgrade.
    expect(container.firstChild).toMatchSnapshot()
  })

  it('renders error state when fundamentals fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'fundamentals_unavailable' }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    )

    const { container } = render(<QuantLabPanel ticker="MSFT" />)

    // The fetchPayload catch sets `err` to the JSON `.error` field; wait for it
    // to surface in the DOM.
    await waitFor(() =>
      expect(screen.getByText('fundamentals_unavailable')).toBeInTheDocument(),
    )

    // The fallback help text is part of the error block — it stays stable
    // across all error paths, so it's a good anchor for the snapshot.
    expect(
      screen.getByText(/ETFs and ADRs sometimes omit full statements/i),
    ).toBeInTheDocument()

    expect(container.firstChild).toMatchSnapshot()
  })

  it('renders ticker prop in the header chip and ticker-only headline before data arrives', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    render(<QuantLabPanel ticker="NVDA" />)

    // The chip and the headline both render the raw ticker pre-data — this
    // is the contract that any sub-tab decomposition must preserve.
    const tickerOccurrences = screen.getAllByText('NVDA')
    expect(tickerOccurrences.length).toBeGreaterThanOrEqual(2)
  })
})
