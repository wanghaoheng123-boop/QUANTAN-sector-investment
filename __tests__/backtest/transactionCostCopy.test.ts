/**
 * UX-14 — the /backtest transaction-cost copy, pinned to the engine SSOT.
 *
 * The page stated its cost assumption in two places at once and they disagreed:
 *
 *   app/backtest/page.tsx        "≈22 bps (11 bps/side)"          ✔ correct
 *   components/backtest/OverviewTab.tsx
 *                                "~11bps round-trip (IBKR: $0.005/sh
 *                                 + 0.05% spread + 0.5bps slippage)"  ✘ halves it
 *
 * `lib/backtest/executionModel.ts` is unambiguous: 11 bps PER SIDE (5 spread +
 * 2 slippage + 4 commission), 22 bps round trip. The STRATEGY RULES row was a
 * hardcoded literal that halved the modelled friction — on the one line a
 * professional reads to judge whether the backtest is honest about costs — and
 * its itemisation was wrong too (0.5 bps slippage against the model's 2).
 *
 * These tests assert both surfaces against the SSOT, so changing a cost
 * constant without updating the prose fails here. They assert copy only; no
 * model constant, fixture or published performance number is involved.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_EXECUTION_COSTS,
  costBpsPerSide,
  roundTripCostPct,
} from '@/lib/backtest/executionModel'
import { TX_COST_RULE } from '@/components/backtest/OverviewTab'

const ROOT = join(__dirname, '..', '..')
const perSide = costBpsPerSide()
const roundTrip = Math.round(roundTripCostPct() * 10_000)

/**
 * Blank out comments before scanning. Both files carry postmortem comments that
 * quote the defective string verbatim ("~11bps round-trip …"); without this the
 * scans would fail on their own documentation.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/[^\n]*/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length))
}

/** File source with comments blanked and whitespace/&nbsp; flattened. */
function flatCode(rel: string): string {
  return stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}

describe('the SSOT itself', () => {
  it('is 11 bps per side and 22 bps round trip', () => {
    expect(perSide).toBe(11)
    expect(roundTrip).toBe(22)
    expect(roundTrip).toBe(2 * perSide)
  })
})

describe('STRATEGY RULES → Transaction Costs (components/backtest/OverviewTab.tsx)', () => {
  it('states the per-side cost from the SSOT', () => {
    expect(TX_COST_RULE).toContain(`${perSide} bps per side`)
  })

  it('states the round-trip cost from the SSOT', () => {
    expect(TX_COST_RULE).toContain(`≈${roundTrip} bps round-trip`)
  })

  it('never calls the per-side number a round-trip number', () => {
    // The original defect, expressed as a property: whatever figure precedes
    // "round-trip" must be the round-trip figure.
    const m = TX_COST_RULE.match(/≈?~?(\d+)\s*bps\s+round-?\s?trip/i)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(roundTrip)
  })

  it('itemises the per-side cost exactly as the model composes it', () => {
    expect(TX_COST_RULE).toContain(`${DEFAULT_EXECUTION_COSTS.spreadBpsPerSide} bps spread`)
    expect(TX_COST_RULE).toContain(`${DEFAULT_EXECUTION_COSTS.slippageBpsPerSide} bps slippage`)
    expect(TX_COST_RULE).toContain(`${DEFAULT_EXECUTION_COSTS.commissionBpsPerSide} bps commission`)
    const parts =
      DEFAULT_EXECUTION_COSTS.spreadBpsPerSide +
      DEFAULT_EXECUTION_COSTS.slippageBpsPerSide +
      DEFAULT_EXECUTION_COSTS.commissionBpsPerSide
    expect(parts).toBe(perSide)
  })

  it('says the cost is charged on both legs', () => {
    expect(TX_COST_RULE).toMatch(/entry AND exit/i)
  })

  it('is derived, not hardcoded', () => {
    const code = flatCode('components/backtest/OverviewTab.tsx')
    expect(code).toContain("from '@/lib/backtest/executionModel'")
    expect(code).not.toContain('11bps round-trip')
  })
})

describe('the page prose (app/backtest/page.tsx)', () => {
  // "≈22&nbsp;bps (11&nbsp;bps/side)" — &nbsp; entities and JSX line breaks.
  const flat = flatCode('app/backtest/page.tsx')

  it('quotes the round-trip figure from the SSOT', () => {
    const m = flat.match(/round-trip transaction costs of ≈\s*(\d+)\s*bps/i)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(roundTrip)
  })

  it('quotes the per-side figure from the SSOT', () => {
    const m = flat.match(/\(\s*(\d+)\s*bps\/side\s*\)/i)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(perSide)
  })
})

describe('THE CLASS: no /backtest surface may contradict the round-trip figure', () => {
  /**
   * Both word orders occur on the page — "≈22 bps round-trip" and "round-trip
   * transaction costs of ≈22 bps" — and the defect was an inconsistency between
   * two such claims, so the scan has to see every one of them.
   */
  const PATTERNS = [
    /(\d+)\s*bps[^.]{0,30}?round-?\s?trip/gi,
    /round-?\s?trip[^.]{0,40}?≈?~?\s*(\d+)\s*bps/gi,
  ]

  function claimsIn(text: string): number[] {
    return PATTERNS.flatMap(re => [...text.matchAll(re)].map(m => Number(m[1])))
  }

  /**
   * The two rendered surfaces. OverviewTab contributes its BUILT string rather
   * than its source, because the fix made it a template expression — scanning
   * the source there would find no digits and pass vacuously forever.
   */
  const SURFACES: Array<[string, string]> = [
    ['app/backtest/page.tsx', flatCode('app/backtest/page.tsx')],
    ['components/backtest/OverviewTab.tsx (rendered)', TX_COST_RULE],
  ]

  it.each(SURFACES)('%s: every round-trip bps claim equals the SSOT', (_label, text) => {
    for (const claim of claimsIn(text)) expect(claim).toBe(roundTrip)
  })

  it('the scan finds a claim on BOTH surfaces (guards against a vacuous pass)', () => {
    for (const [, text] of SURFACES) {
      expect(claimsIn(text).length).toBeGreaterThanOrEqual(1)
    }
  })
})
