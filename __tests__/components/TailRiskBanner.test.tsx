// @vitest-environment jsdom
/**
 * UX-27 — the tail-risk banner on /portfolio.
 *
 * Every input is a literal (`realizedSkew: -0.6`, `portfolioVegaUsd: -600_000`,
 * …) and there is no portfolio anywhere in the product — no positions, no
 * upload, no broker link. Until 2026-08-15 the word "Demo" appeared ONLY in a
 * source comment, so the rendered page told the reader their book carried
 * −$600,000 of vega and attached four concrete options trades to it under the
 * heading "Suggestions:".
 *
 * `/risk/scenarios` already discloses the same Phase-16 placeholder data in the
 * UI. These tests pin that disclosure onto this banner so it cannot be lost
 * again, and pin the reframing that stops the alerts reading as instructions
 * for a real position.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TailRiskBanner } from '@/components/risk/TailRiskBanner'

const html = () => renderToStaticMarkup(<TailRiskBanner />)

describe('TailRiskBanner — visible ILLUSTRATIVE disclosure (UX-27)', () => {
  it('renders an ILLUSTRATIVE badge in the output, not just in a comment', () => {
    expect(html()).toContain('ILLUSTRATIVE')
  })

  it('ports the /risk/scenarios wording verbatim', () => {
    expect(html()).toContain('Demo portfolio — wire live positions in Phase 16.')
  })

  it('states on screen that the numbers are not the reader’s positions', () => {
    const out = html()
    expect(out).toContain('not from your positions')
    expect(out).toContain('Nothing here is a recommendation')
  })

  it('names the fixed inputs it was computed from', () => {
    const out = html()
    expect(out).toContain('-0.60')      // realizedSkew
    expect(out).toContain('22%')        // realizedVol
    expect(out).toContain('18%')        // volMean
    expect(out).toContain('-600,000')   // portfolioVegaUsd
  })
})

describe('TailRiskBanner — the advice framing', () => {
  it('no longer heads the trade list with a bare "Suggestions:"', () => {
    const out = html()
    expect(out).not.toContain('Suggestions: ')
    expect(out).toContain('What this alert type would suggest:')
  })

  it('keeps the feature — both alerts still render', () => {
    const out = html()
    expect(out).toContain('tail risk elevated')
    expect(out).toContain('short vol exposure')
    expect(out).toContain('Consider protective puts')
  })
})
