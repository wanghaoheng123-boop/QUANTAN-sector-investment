/**
 * Q-105 — the /backtest surfaces must describe the engine that produced the
 * numbers beside them.
 *
 * Three surfaces (the landing-page CTA, the /backtest info bar, and the
 * Overview tab's Strategy Rules grid) described an ATR-adaptive stop-loss, a
 * trailing stop, "SELL → exit full position", "≥2 confirms", tiered Half-Kelly
 * sizing and a 55% confidence minimum. `backtestInstrument` had run none of
 * them since 2026-07-11 (D2 retired the stops, D4 the SELL exit; production
 * runs the regime-only path, which never reads the threshold). The one exit it
 * does have — the 60-bar time exit — appeared nowhere.
 *
 * This asserts three things, in order of how much they would have caught:
 *   1. no rendered surface makes a claim from the retired rulebook;
 *   2. the numbers quoted are the constants the engine trades on;
 *   3. the "no stops" claim is true of the engine's declared exit policy.
 *
 * Scans read the BUILT strings for the derived surfaces and comment-stripped
 * source for the pages, so an explanatory comment quoting the old copy (the
 * pages carry several) cannot fail the scan, and a comment cannot satisfy it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ENGINE_RULES,
  ENGINE_SUMMARY,
  ENGINE_ONE_LINE,
  pct,
} from '@/lib/backtest/strategyDescription'
import { STRATEGY_RULES } from '@/components/backtest/OverviewTab'
import {
  ENGINE_MAX_HOLD_DAYS,
  MIN_SMA200_SLOPE,
  NEAR_SMA200_PCT,
  REGIME_PATH_POSITION_FRACTION,
} from '@/lib/backtest/strategyConstants'
import { DEFAULT_TIME_EXIT_CONFIG } from '@/lib/backtest/exitRules'
import { DEFAULT_CONFIG } from '@/lib/backtest/signals'

const ROOT = join(__dirname, '..', '..')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/^([ \t]*)\/\/[^\n]*/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length))
}

function flatCode(rel: string): string {
  return stripComments(readFileSync(join(ROOT, rel), 'utf8')).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
}

/**
 * The landing page's backtest call-to-action only. The rest of app/page.tsx
 * describes other features (the live signal cards DO show a stop level), and
 * scanning it whole would flag those.
 */
function landingBacktestSection(): string {
  const flat = flatCode('app/page.tsx')
  const start = flat.indexOf('id="section-backtest"')
  const end = flat.indexOf('</section>', start)
  return start >= 0 && end > start ? flat.slice(start, end) : ''
}

const rulesText = ENGINE_RULES.map(([t, d]) => `${t}: ${d}`).join(' | ')
const summaryText = ENGINE_SUMMARY.map(([t, d]) => `${t}: ${d}`).join(' | ')

/** Every rendered surface that describes the engine, as the user reads it. */
const SURFACES: Array<[string, string]> = [
  ['Strategy Rules grid (built)', rulesText],
  ['/backtest info bar (built)', summaryText],
  ['landing CTA clause (built)', ENGINE_ONE_LINE],
  ['app/backtest/page.tsx (source)', flatCode('app/backtest/page.tsx')],
  ['app/page.tsx backtest CTA (source)', landingBacktestSection()],
  ['components/backtest/TradeLog.tsx (source)', flatCode('components/backtest/TradeLog.tsx')],
]

/** Claims from the retired rulebook. Each was on a live surface before Q-105. */
const RETIRED_CLAIMS: Array<[string, RegExp]> = [
  ['ATR-adaptive stop', /ATR-adaptive/i],
  ['an ATR multiple as a stop', /\d(?:\.\d+)?\s*×\s*ATR\b/i],
  ['break-even trailing', /break-?even/i],
  ['SELL exits the position', /exit full position|SELL\s*=\s*full exit/i],
  ['a confidence minimum', /confidence (?:threshold|minimum|floor)\W{0,3}\d+\s*%|\d+\s*%\s*confidence (?:minimum|threshold)/i],
  ['a confirm count', /≥\s*\d+\s*of\s*:/],
  ['tiered Kelly sizing', /Half-Kelly\s*(?:sizing\s*)?\((?:max\s*)?\d+/i],
  ['stop exit codes', /STOP_LOSS|TRAILING_STOP|TP_PARTIAL/],
]

/**
 * Every mention of a stop must be negated. "No stop-loss" is the true claim and
 * must stay sayable; "Stop Loss: ATR-adaptive" must not.
 */
function unnegatedStops(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(stop-loss|stop loss|trailing stop|ATR stop)s?\b/gi)) {
    const before = text.slice(Math.max(0, m.index! - 24), m.index!)
    if (!/\b(?:no|not|without)\b[^.;:]*$/i.test(before)) out.push(`…${before}${m[0]}`)
  }
  return out
}

describe('1. no surface makes a claim from the retired rulebook', () => {
  it.each(SURFACES)('%s', (_label, text) => {
    expect(text.length, 'surface is empty — the scan would pass vacuously').toBeGreaterThan(20)
    for (const [name, re] of RETIRED_CLAIMS) {
      expect(text.match(re)?.[0] ?? null, `claims ${name}`).toBeNull()
    }
    expect(unnegatedStops(text)).toEqual([])
  })

  it('the stop scan is exercised: the rules DO mention stops, negated', () => {
    // Guards the negation rule against passing because nothing matched.
    expect([...rulesText.matchAll(/stop-loss|trailing stop/gi)].length).toBeGreaterThanOrEqual(2)
    expect(unnegatedStops('Stop Loss: ATR-adaptive (1.5× ATR)')).toHaveLength(1)
    expect(unnegatedStops('There is no stop-loss, no trailing stop')).toEqual([])
  })

  it('every retired-claim pattern fires on the copy it was written against', () => {
    // The pre-Q-105 strings, verbatim. A pattern that cannot match its own
    // original is decoration.
    const ORIGINALS = [
      'Stop Loss: ATR-adaptive (1.5× ATR, 3–15%)',
      '2× ATR profit → stop rises to break-even. 4× ATR profit → stop locks at 1× ATR above entry.',
      'FALLING_KNIFE (dip zone + declining SMA) or HEALTHY_BULL + RSI>70 → Exit full position',
      'Confidence threshold: 55%',
      '≥2 of: RSI<35, MACD hist>0, ATR%>2, BB%<0.20',
      'Kelly: Half-Kelly sizing (max 25%)',
      'Why the trade exited: TP_PARTIAL (partial profit-take), STOP_LOSS, TRAILING_STOP',
    ]
    for (const [name, re] of RETIRED_CLAIMS) {
      if (name === 'break-even trailing' || name === 'an ATR multiple as a stop') continue
      expect(ORIGINALS.some((o) => re.test(o)), name).toBe(true)
    }
    expect(RETIRED_CLAIMS.find(([n]) => n === 'break-even trailing')![1].test(ORIGINALS[1])).toBe(true)
    expect(RETIRED_CLAIMS.find(([n]) => n === 'an ATR multiple as a stop')![1].test(ORIGINALS[0])).toBe(true)
  })
})

describe('2. the numbers quoted are the constants the engine trades on', () => {
  it('the time exit is the engine hold horizon', () => {
    expect(DEFAULT_TIME_EXIT_CONFIG.maxHoldDays).toBe(ENGINE_MAX_HOLD_DAYS)
    expect(rulesText).toContain(`${ENGINE_MAX_HOLD_DAYS} daily bars`)
    expect(summaryText).toContain(`${ENGINE_MAX_HOLD_DAYS}-bar time exit`)
    expect(ENGINE_ONE_LINE).toContain(`${ENGINE_MAX_HOLD_DAYS}-bar time exit`)
  })

  it('the position size is the regime-path fraction the production default selects', () => {
    expect(DEFAULT_CONFIG.halfKelly).toBe(true)
    const size = `${pct(REGIME_PATH_POSITION_FRACTION.halfKelly)}%`
    expect(size).toBe('15%')
    expect(rulesText).toContain(`fixed ${size} of capital`)
    expect(summaryText).toContain(`fixed ${size} of capital`)
    expect(ENGINE_ONE_LINE).toContain(`fixed ${size} position size`)
  })

  it('the drawdown breaker and capital are the engine defaults', () => {
    expect(rulesText).toContain(`falls ${pct(DEFAULT_CONFIG.maxDrawdownCap)}% or more`)
    expect(summaryText).toContain(`${pct(DEFAULT_CONFIG.maxDrawdownCap)}% per instrument`)
    expect(summaryText).toContain(`$${DEFAULT_CONFIG.initialCapital.toLocaleString('en-US')} per instrument`)
  })

  it('the entry rule quotes the classifier thresholds', () => {
    expect(rulesText).toContain(`up more than ${pct(MIN_SMA200_SLOPE)}% over the last 20 bars`)
    expect(rulesText).toContain(`no more than ${NEAR_SMA200_PCT}% below the SMA`)
  })

  it('pct() does not leak float noise into copy', () => {
    expect(0.14 * 100).not.toBe(14) // the reason pct() exists: 14.000000000000002
    expect(pct(0.14)).toBe('14')
    expect(pct(0.29)).toBe('29')
    expect(pct(0.15)).toBe('15')
    expect(pct(0.005)).toBe('0.5')
    expect(pct(0.25)).toBe('25')
  })

  it('the rendered surfaces render THESE constants, not a lookalike literal', () => {
    expect(STRATEGY_RULES).toBe(ENGINE_RULES)
    expect(flatCode('app/backtest/page.tsx')).toMatch(/ENGINE_SUMMARY\.map\(/)
    expect(flatCode('app/page.tsx')).toContain('{ENGINE_ONE_LINE}')
    // No number the engine trades on is hardcoded in the copy module's strings.
    const src = stripComments(readFileSync(join(ROOT, 'lib/backtest/strategyDescription.ts'), 'utf8'))
    for (const literal of ['60', '15%', '25%', '0.5%', '100,000']) {
      const inStrings = [...src.matchAll(/'[^']*'|`[^`]*`/g)].map((m) => m[0].replace(/\$\{[^}]*\}/g, ''))
      expect(inStrings.filter((s) => s.includes(literal)), literal).toEqual([])
    }
  })
})

describe('3. the "no stops" claim is true of the engine\'s declared exit policy', () => {
  it('the default time-exit config arms no stop, no trail, no target and no signal exit', () => {
    // If a stop is re-armed here, the copy saying "no stop-loss" becomes false
    // and this fails — forcing the copy and the policy to move together.
    expect(DEFAULT_TIME_EXIT_CONFIG.atrStopMultiplier).toBe(0)
    expect(DEFAULT_TIME_EXIT_CONFIG.trailingStopPct).toBe(0)
    expect(DEFAULT_TIME_EXIT_CONFIG.profitTakePct).toBe(0)
    expect(DEFAULT_TIME_EXIT_CONFIG.panicExitAtrMultiple).toBe(0)
    expect(DEFAULT_TIME_EXIT_CONFIG.signalBasedExit).toBe(false)
  })

  it('CANNOT DO: core.ts does not read that config\'s stop fields at all', () => {
    // backtestInstrument hardcodes its exits (time exit + drawdown breaker) and
    // reads only `maxHoldDays` from the config. So the assertions above pin the
    // DECLARED policy; the engine's behaviour is pinned by the engine suites
    // and by the no-stop-code scan of core.ts below, not by this config.
    const core = stripComments(readFileSync(join(ROOT, 'lib/backtest/core.ts'), 'utf8'))
    expect(core).toContain('DEFAULT_TIME_EXIT_CONFIG.maxHoldDays')
    expect(core).not.toMatch(/DEFAULT_TIME_EXIT_CONFIG\.(atrStopMultiplier|trailingStopPct|profitTakePct)/)
    expect(core).not.toMatch(/atrAdaptiveStop|checkExitConditions/)
  })
})
