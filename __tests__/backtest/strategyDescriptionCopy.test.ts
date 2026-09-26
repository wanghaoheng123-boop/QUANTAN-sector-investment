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
 * RED-TEAM ROUND 1 found the first version scanned too little and matched too
 * narrowly:
 *   - It scanned the Rules grid but not the TOOLTIP TEXT on the same page. The
 *     trade log's Conf% header resolved to a glossary entry saying "<55%
 *     triggers HOLD" and "70%+ = act with full size"; its Signal header said
 *     "EXIT = OVERBOUGHT"; its Regime header described a classifier the
 *     platform does not have. The scan now covers every components/backtest
 *     source AND the glossary text every metricKey on those files resolves to.
 *   - 18 of 22 paraphrases of retired claims passed. They are now a regression
 *     corpus that must all be caught (CORPUS below), and negation is strictly
 *     adjacent, so "a no-cost stop-loss" is not a negated stop.
 *   - CANNOT DO: this is a blacklist, so it is paraphrase-incomplete by
 *     construction. The corpus pins what is known; it proves nothing about
 *     wording nobody has tried.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ENGINE_RULES,
  ENGINE_SUMMARY,
  ENGINE_ONE_LINE,
  pct,
} from '@/lib/backtest/strategyDescription'
import { STRATEGY_RULES } from '@/components/backtest/OverviewTab'
import { HEADER_TOOLTIPS } from '@/components/backtest/TradeLog'
import { positionSizeLabel } from '@/components/backtest/LiveSignalsPanel'
import {
  ENGINE_MAX_HOLD_DAYS,
  FIRST_DIP_FLOOR_PCT,
  MIN_SMA200_SLOPE,
  NEAR_SMA200_PCT,
  REGIME_PATH_POSITION_FRACTION,
} from '@/lib/backtest/strategyConstants'
import { DEFAULT_TIME_EXIT_CONFIG } from '@/lib/backtest/exitRules'
import { DEFAULT_CONFIG } from '@/lib/backtest/signals'
import { getMetric } from '@/lib/metricGlossary'

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
 * describes other features, and scanning it whole would flag those.
 */
function landingBacktestSection(): string {
  const flat = flatCode('app/page.tsx')
  const start = flat.indexOf('id="section-backtest"')
  const end = flat.indexOf('</section>', start)
  return start >= 0 && end > start ? flat.slice(start, end) : ''
}

const rulesText = ENGINE_RULES.map(([t, d]) => `${t}: ${d}`).join(' | ')
const summaryText = ENGINE_SUMMARY.map(([t, d]) => `${t}: ${d}`).join(' | ')

/** Every component the /backtest page renders from. */
const BACKTEST_SOURCES = [
  'app/backtest/page.tsx',
  ...readdirSync(join(ROOT, 'components/backtest'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `components/backtest/${f}`),
]

/**
 * Glossary keys those sources render through <MetricTooltip metricKey=…>,
 * found in the source (literal props and `metricKey: '…'` map entries).
 */
const GLOSSARY_KEYS = [...new Set(BACKTEST_SOURCES.flatMap((rel) =>
  [...flatCode(rel).matchAll(/metricKey(?:=|:\s*)["'](\w+)["']/g)].map((m) => m[1]),
))].sort()

function glossaryText(key: string): string {
  const m = getMetric(key)
  return m ? [m.label, m.definition, m.range, m.howToUse].filter(Boolean).join(' ') : ''
}

/** Every rendered surface that describes the engine, as the user reads it. */
const SURFACES: Array<[string, string]> = [
  ['Strategy Rules grid (built)', rulesText],
  ['/backtest info bar (built)', summaryText],
  ['landing CTA clause (built)', ENGINE_ONE_LINE],
  ['app/page.tsx backtest CTA (source)', landingBacktestSection()],
  ...BACKTEST_SOURCES.map((rel): [string, string] => [`${rel} (source)`, flatCode(rel)]),
  ...GLOSSARY_KEYS.map((k): [string, string] => [`glossary '${k}' (rendered on /backtest)`, glossaryText(k)]),
]

/** Claims from the retired rulebook. Each pattern is exercised by CORPUS. */
const RETIRED_CLAIMS: Array<[string, RegExp]> = [
  ['an ATR-sized stop', /ATR-(?:adaptive|based)|\bATR stop|\d(?:\.\d+)?\s*[×x]\s*ATR\b/i],
  ['break-even trailing', /break[- ]?even/i],
  ['SELL exits the position', /exit full position|\bSELL\b[^.|;]{0,30}?(?:→|->|=|\bsignal\b)[^.|;]{0,20}\b(?:exit|close)|\bSELL\b\s*(?:signal\s+)?(?:closes|exits)\b/i],
  ['a confidence minimum', /\bconfidence\b[^.|;]{0,40}?\d{2}\s*%|\d{2}\s*%[^.|;]{0,25}\bconfidence\b|<\s*\d{2}\s*%[^.|;]{0,20}\b(?:HOLD|wait)\b/i],
  ['a confirm count', /(?:≥|>=|at least|needs?|requires?)\s*\d+\s*of\b|\b\d\s*of\s*\d\s*(?:confirms?|confirmations|signals)\b/i],
  ['tiered Kelly sizing', /Half[- ]?Kelly[^.|;]{0,30}?\d+\s*%|\bKelly[^.|;]{0,15}\btier|\b\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{1,2}\s*%|\b\d{1,2}%\s*,\s*\d{1,2}%\s*,?\s*(?:or|and)?\s*\d{1,2}%/i],
  ['stop/exit codes', /\b(?:stop_loss|trailing_stop|tp_partial|signal_flip|max_hold)\b|\bSTOP\b\s*,\s*TRAIL/i],
  ['an exit zone', /\bEXIT\s*=/],
  // Bare "stop" is also a verb ("model is broken — stop"), so it is a claim
  // only as a NOUN in a stop context. "stop-loss"/"trailing stop" are handled
  // by the strict-negation rule below instead.
  ['a stop (noun)', /\b(?:the|a|an|initial|protective)\s+stop\b|\bstop\s*(?::|rises|locks|trails|moves|sits|at\s+\d|below)/i],
  ['advice wording', /act with full size|\bsize up\b|trade smaller/i],
]

/**
 * Every mention of a stop must be negated by the word IMMEDIATELY before it.
 * "No stop-loss" is the true claim and must stay sayable; "Stop Loss:
 * ATR-adaptive" and "a no-cost stop-loss" must not.
 */
function unnegatedStops(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(?:trailing stops?|stop-loss(?:es)?|stop loss(?:es)?)\b/gi)) {
    const before = text.slice(Math.max(0, m.index! - 24), m.index!)
    if (!/(?:^|[\s(])(?:no|without)\s+$/i.test(before)) out.push(`…${before}${m[0]}`)
  }
  return out
}

function violations(text: string): string[] {
  const hits = RETIRED_CLAIMS.flatMap(([name, re]) => {
    const m = text.match(re)
    return m ? [`${name}: "${m[0]}"`] : []
  })
  return [...hits, ...unnegatedStops(text).map((s) => `un-negated stop: "${s}"`)]
}

/**
 * Red-team round 1's paraphrases (18 passed the first version) plus the
 * pre-Q-105 originals, verbatim. Every one must be caught.
 */
const CORPUS = [
  // originals
  'Stop Loss: ATR-adaptive (1.5× ATR, 3–15%)',
  '2× ATR profit → stop rises to break-even. 4× ATR profit → stop locks at 1× ATR above entry.',
  'FALLING_KNIFE (dip zone + declining SMA) or HEALTHY_BULL + RSI>70 → Exit full position',
  'Confidence threshold: 55%',
  '≥2 of: RSI<35, MACD hist>0, ATR%>2, BB%<0.20',
  'Kelly: Half-Kelly sizing (max 25%)',
  'Why the trade exited: TP_PARTIAL (partial profit-take), STOP_LOSS, TRAILING_STOP',
  'BUY = entry, SELL = full exit, PARTIAL = profit-take leaving runner.',
  '0–100%. <55% triggers HOLD; >75% = high conviction.',
  '70%+ = act with full size. 55–70% = trade smaller.',
  'BUY zone = STRONG_DIP. EXIT = OVERBOUGHT/EXTENDED_BULL.',
  // red-team paraphrases
  'Confidence threshold of 55%',
  'Minimum confidence: 55%',
  'BUY requires confidence of at least 55%',
  'Confidence ≥ 55% required',
  'SELL → exit the full position',
  'SELL = close position',
  'A SELL signal closes the whole position.',
  'Half Kelly sizing (max 25%)',
  'Half-Kelly sizing: 10/15/25% by conviction',
  'Kelly-tiered: 10%, 15% or 25%',
  'Needs 2 of 4 confirms: RSI<35, MACD>0',
  '≥2 of RSI<35, MACD hist>0',
  'at least 2 of: RSI<35, MACD hist>0',
  'Exit codes: stop_loss, trailing_stop, tp_partial',
  'Why the trade exited: STOP, TRAIL, MAX_HOLD, SIGNAL_FLIP',
  'Losses are cut at 1.5 x ATR; the stop then trails the high.',
  'Stop: ATR-based, 3-15% below entry.',
  'break even stop after 2 ATR',
  'A no-cost stop-loss sits 8% below entry.',
]

describe('1. no surface makes a claim from the retired rulebook', () => {
  it('the scan reaches the tooltip text, not only the page source', () => {
    // Reachability: the Q-105 round-1 miss was glossary text behind metricKeys.
    for (const k of ['regime', 'dipSignal', 'confidence']) expect(GLOSSARY_KEYS).toContain(k)
    expect(BACKTEST_SOURCES).toContain('components/backtest/LiveSignalsPanel.tsx')
    expect(BACKTEST_SOURCES.length).toBeGreaterThanOrEqual(10)
    // The trade log's map is what the page actually uses.
    expect(HEADER_TOOLTIPS['Conf%']?.metricKey).toBe('confidence')
  })

  it.each(SURFACES)('%s', (_label, text) => {
    expect(text.length, 'surface is empty — the scan would pass vacuously').toBeGreaterThan(20)
    expect(violations(text)).toEqual([])
  })

  it.each(CORPUS)('CORPUS — caught: %s', (claim) => {
    expect(violations(claim).length).toBeGreaterThan(0)
  })

  it('a bare "stop" used as a verb is not a stop claim', () => {
    expect(violations('If realised DD > 1.5× backtest DD, model is broken — stop.')).toEqual([])
  })

  it('negation is strictly adjacent: the true claims stay sayable', () => {
    expect(violations('There is no stop-loss, no trailing stop and no profit target')).toEqual([])
    expect(violations('a 60-bar time exit with no stop-loss')).toEqual([])
    expect(unnegatedStops('A no-cost stop-loss sits 8% below entry.')).toHaveLength(1)
    expect([...rulesText.matchAll(/stop-loss|trailing stop/gi)].length).toBeGreaterThanOrEqual(2)
  })

  it('CANNOT DO: wording nobody has tried can still pass', () => {
    // Asserted so a green run is not read as a proof. Each is a retired claim.
    expect(violations('Positions are protected by a volatility-scaled floor.')).toEqual([])
    expect(violations('Conviction under fifty-five means stand aside.')).toEqual([])
  })
})

describe('2. the numbers quoted are the constants the engine trades on', () => {
  it('the time exit is the engine hold horizon', () => {
    expect(DEFAULT_TIME_EXIT_CONFIG.maxHoldDays).toBe(ENGINE_MAX_HOLD_DAYS)
    expect(rulesText).toContain(`once ${ENGINE_MAX_HOLD_DAYS} daily bars have passed since a position's fill`)
    expect(summaryText).toContain(`${ENGINE_MAX_HOLD_DAYS}-bar time exit`)
    expect(ENGINE_ONE_LINE).toContain(`${ENGINE_MAX_HOLD_DAYS}-bar time exit`)
  })

  it('the position size is the regime-path fraction of CASH, whole shares, with the skip disclosed', () => {
    expect(DEFAULT_CONFIG.halfKelly).toBe(true)
    const size = `${pct(REGIME_PATH_POSITION_FRACTION.half)}%`
    expect(size).toBe('15%')
    expect(rulesText).toContain(`${size} of the instrument's cash at entry, rounded down to whole shares`)
    expect(rulesText).toContain('cannot afford one share is skipped')
    const ceiling = (DEFAULT_CONFIG.initialCapital * REGIME_PATH_POSITION_FRACTION.half).toLocaleString('en-US')
    expect(rulesText).toContain(`priced above $${ceiling} cannot open its first position`)
    expect(summaryText).toContain(`${size} of cash, whole shares`)
    expect(ENGINE_ONE_LINE).toContain(`${size} of cash per position`)
    // Red-team R1: "fixed 15% of capital" must not come back.
    expect(`${rulesText} ${summaryText} ${ENGINE_ONE_LINE}`).not.toMatch(/fixed\s+\d+%/i)
  })

  it('the drawdown breaker and capital are the engine defaults', () => {
    expect(rulesText).toContain(`falls ${pct(DEFAULT_CONFIG.maxDrawdownCap)}% or more`)
    expect(summaryText).toContain(`${pct(DEFAULT_CONFIG.maxDrawdownCap)}% per instrument`)
    expect(summaryText).toContain(`$${DEFAULT_CONFIG.initialCapital.toLocaleString('en-US')} per instrument`)
  })

  it('the entry rule and the HOLD/SELL boundary quote the classifier thresholds', () => {
    expect(rulesText).toContain(`up more than ${pct(MIN_SMA200_SLOPE)}% over the last 20 bars`)
    expect(rulesText).toContain(`no more than ${NEAR_SMA200_PCT}% below the SMA`)
    expect(rulesText).toContain(`a dip of up to ${FIRST_DIP_FLOOR_PCT}% that fails`)
    expect(rulesText).toContain(`Dips deeper than ${FIRST_DIP_FLOOR_PCT}% that fail`)
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
    // (A `${60}` interpolation would dodge this; test 2 above still catches drift.)
    const src = stripComments(readFileSync(join(ROOT, 'lib/backtest/strategyDescription.ts'), 'utf8'))
    const inStrings = [...src.matchAll(/'[^']*'|`[^`]*`/g)].map((m) => m[0].replace(/\$\{[^}]*\}/g, ''))
    for (const literal of ['60', '15%', '25%', '0.5%', '100,000', '15,000', '10%']) {
      expect(inStrings.filter((s) => s.includes(literal)), literal).toEqual([])
    }
  })

  it('red-team R3: the Signals tab shows a size only for BUY, under a header that is not "Kelly"', () => {
    // Production /api/backtest/live returns KellyFraction 1.0 on SELL and 0.10 on HOLD.
    expect(positionSizeLabel('SELL', 1.0)).toBe('—')
    expect(positionSizeLabel('HOLD', 0.1)).toBe('—')
    expect(positionSizeLabel('BUY', REGIME_PATH_POSITION_FRACTION.half)).toBe('15%')
    expect(positionSizeLabel('BUY', null)).toBe('—')
    const panel = flatCode('components/backtest/LiveSignalsPanel.tsx')
    expect(panel).toContain('{positionSizeLabel(action, kellyFraction)}')
    expect(panel).not.toMatch(/>\s*Kelly\s*</)
    expect(panel).toContain("'200SMA Dev'")
  })

  it('red-team R6: the landing CTA quotes no win rate from a different rulebook', () => {
    expect(landingBacktestSection()).not.toMatch(/\bWR\b|win rate|\d+\s*%\s*(?:gross|net)/i)
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
