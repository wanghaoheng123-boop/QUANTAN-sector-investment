/**
 * Q-134 — the /backtest rules are shown only for the signal path that ran.
 *
 * Every rule on the page describes the regime-only path, which production
 * runs by default. With QUANTAN_USE_ENHANCED_SIGNAL=1 the engine runs the
 * enhanced path instead and the BUY, HOLD and sizing rows become false, with
 * every other test green. These tests fail in exactly that configuration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OverviewTab } from '@/components/backtest/OverviewTab'
import { ENGINE_RULES } from '@/lib/backtest/strategyDescription'

vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: async () => null }))

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

async function signalPathWith(flag: string): Promise<unknown> {
  vi.stubEnv('QUANTAN_USE_ENHANCED_SIGNAL', flag)
  vi.resetModules()   // the route holds a module-level cache
  const { GET } = await import('@/app/api/backtest/route')
  const body = await (await GET(new Request('http://localhost/api/backtest?tickers=AAPL'))).json()
  return body.signalPath
}

describe('Q-134: /api/backtest says which path produced its numbers', () => {
  it('regime-only when the flag is off', async () => {
    expect(await signalPathWith('0')).toBe('regime-only')
  }, 60_000)

  it('enhanced when the flag is on', async () => {
    expect(await signalPathWith('1')).toBe('enhanced')
  }, 60_000)
})

describe('Q-134: the Overview tab shows the regime-only rules only for that path', () => {
  const render = (signalPath?: 'regime-only' | 'enhanced') =>
    renderToStaticMarkup(<OverviewTab results={[]} sectorSummary={{}} initialCapital={100_000} signalPath={signalPath} />)
  const firstRule = ENGINE_RULES[0][0]

  it('renders the rules for the production path', () => {
    expect(render('regime-only')).toContain(firstRule)
  })

  it('withholds them, and says why, for the enhanced path', () => {
    const html = render('enhanced')
    expect(html).not.toContain(firstRule)
    expect(html).toContain('research-only enhanced signal path')
  })

  it('withholds them when the response does not say', () => {
    const html = render(undefined)
    expect(html).not.toContain(firstRule)
    expect(html).toContain('does not say which signal path')
  })
})
