/**
 * Q-153 (2026-10-17) — the 200-day-average regime describes; it does not
 * advise, and it does not quote returns nobody measured.
 *
 * Red-team R2-241-3 (HIGH): the regime copy rendered on three surfaces said
 * "textbook high-probability buy zone … consider scaling in", "Avoid long
 * exposure", "BUY THE DIP", "scale in with a maximum of 30–40% of your target
 * position", and an "Empirical Forward Return Reference" of median 3M/6M/12M
 * returns "based on … 1990–2024" data — an analysis this repository never ran.
 * Trade and sizing instructions are the surface Q-083 (MAS/FAA) gates; an
 * unsourced performance figure is what I5 forbids.
 *
 * ROUND 2 (compliance Q153-C8, C9). The first version of this guard missed 8 of
 * 8 planted strings and 27 of 28 paraphrases. Now:
 *   - the VISITOR reads the parse tree (adviceWords.renderedText): single-token
 *     literals, JSX text of any length and content, rendered attributes;
 *   - the SURFACES are derived — every product file that imports the regime
 *     module — plus lib/crypto.ts, whose copy renders on the BTC lab;
 *   - the DECIDER is one shared list (adviceWords.ts), also used by
 *     mutationHardening.q078w4;
 *   - the positive controls are the reviewer's 28 paraphrases, every advice
 *     string this package REMOVED (frozen in q153RemovedCopy.json), and the
 *     reviewer's planted strings, planted into the real files' text.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { adviceOffenders, offending, renderedText } from './adviceWords'
import removed from './q153RemovedCopy.json'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const IMPORTS_REGIME_MODULE = /from\s+['"](?:@\/lib\/quant\/|\.\/|\.\.\/)technicals['"]/
const productFiles = execSync('git ls-files -z app components hooks lib', { cwd: ROOT }).toString().split('\0')
  .filter((p) => /\.(?:tsx?|mjs)$/.test(p) && !p.endsWith('.d.ts'))
/** Every file that imports the regime module, the module itself, and lib/crypto.ts (rendered on the BTC lab). */
const SURFACES = [...new Set(['lib/quant/technicals.ts', 'lib/crypto.ts', ...productFiles.filter((p) => IMPORTS_REGIME_MODULE.test(read(p)))])]

/**
 * Named residuals, pinned EXACTLY so a new offender in these files still fails.
 * The valuation-band copy ("buy-zone", "sell-zone") is the owner-gated Q-083
 * surface the compliance review inventoried, not regime copy; the DCF refusal
 * reason uses "usually" as a statement about accounting, not a frequency claim
 * about prices.
 */
const PINNED_RESIDUALS: Record<string, string[]> = {
  'lib/quant/buildFundamentalsPayload.ts': [
    'An FCF DCF is not applied to  : inside Financial Services only   are admitted, because elsewhere in the sector cash flow usually cannot be separated from financing.',
    'Below buy-zone upper bound',
    'Price is at or below the mechanical buy-zone ceiling ( ) vs composite fair value ~ .',
    'Above sell-zone lower bound',
    'Price is at or above the mechanical sell-zone floor ( ).',
    'Between buy-zone and sell-zone vs fair value ~  — model is not aggressive either way.',
  ],
}

/** Q153-C9: 28 paraphrases. The first guard caught one. */
const PARAPHRASES = [
  'Consider adding on weakness.',
  'A good entry point for long-term investors.',
  'Wait for the slope to turn up before committing.',
  'Hold through the pullback.',
  'Take profits above +20%.',
  'Reduce exposure until the average turns up.',
  'Go long when price reclaims the average.',
  'Overweight sectors below a rising average.',
  'Purchase on weakness.',
  'Buyers usually step in here.',
  'Set a stop-loss 2 ATR below the close.',
  'Historically, dips below a rising average recovered within six months.',
  'Statistically, corrections are more likely from here.',
  'High-probability setup.',
  'Prices rose 12% over the following year.',
  '70% of such dips recovered within six months.',
  'The win rate in this zone is 68%.',
  'Hit-rate 72%.',
  'Since 1990 the 12-month gain from this zone averaged +15%.',
  'Between 2008 and 2022 this pattern preceded further downside.',
  'Expected return: +11% over 12 months.',
  'Oversold — expect a bounce.',
  'This is an attractive level.',
  'The institutional benchmark for long-term trend direction.',
  'Most institutional managers view this as the preferred hold zone.',
  'Best risk-adjusted returns. Ideal holding zone.',
  'Forward returns for these zones have not been measured to be negative.',
  'Not a forecast or a trade signal, but a buy.',
  // Q153-C3: the frequency claim round 1 ADDED, then removed in round 2.
  'Price is more than 20% above its 200-day simple moving average, a distance it rarely reaches.',
  'Prices typically revert from here.',
]

/**
 * Q153-C8's planted strings, each planted into a REAL file's text: the visitor
 * has to find it there, not in a probe string.
 */
const PLANTS: Array<{ file: string; anchor: string; insert: string }> = [
  { file: 'lib/quant/technicals.ts', anchor: 'export function ma200Regime(', insert: "const V1 = { STRONG_DIP: 'Buy' }\n" },
  { file: 'components/crypto/BtcQuantLab.tsx', anchor: '// Signal summary', insert: "const V2 = { signal: 'ACCUMULATE' }\nconst V3 = { signal: 'BUY-THE-DIP' }\n" },
  { file: 'app/ma-deviation/page.tsx', anchor: '<h2 className="text-sm font-bold text-white mb-4">How to read this gauge</h2>', insert: '<p>Buy while the trend is unknown.</p><p>Buy below a rising average | sell far above it</p>' },
  { file: 'components/stock/quantlab/tabs/TechnicalsTab.tsx', anchor: '<div className="space-y-6">', insert: "<p>200-Day MA Regime — buying a small number of shares here is the usual approach</p>{x === 'STRONG_DIP' ? 'BUY' : null}" },
  { file: 'app/ma-deviation/page.tsx', anchor: '<h2 className="text-sm font-bold text-white mb-4">How to read this gauge</h2>', insert: `<p>${'The gauge describes the distance from the average. '.repeat(9)}Buy the dip.</p>` },
]

describe('regime copy describes, and quotes no unmeasured returns (Q-153)', () => {
  it('visits every surface that renders or ships the regime (derived, not listed)', () => {
    for (const f of ['lib/quant/technicals.ts', 'components/crypto/BtcQuantLab.tsx', 'components/stock/quantlab/tabs/TechnicalsTab.tsx',
      'app/ma-deviation/page.tsx', 'app/api/ma-deviation/route.ts', 'lib/quant/buildFundamentalsPayload.ts', 'lib/crypto.ts']) {
      expect(SURFACES, f).toContain(f)
    }
    for (const f of SURFACES) expect(renderedText(f, read(f)).length, `${f}: the visitor found no copy`).toBeGreaterThan(2)
  })

  it('the decider catches every paraphrase the reviewer wrote (positive controls)', () => {
    for (const s of PARAPHRASES) expect(offending(s), s).toBe(true)
  })

  it('the decider catches every advice string this package removed, if restored', () => {
    const advice = removed.entries.filter((e) => e.kind === 'advice')
    expect(removed.entries.length).toBeGreaterThan(200)
    expect(advice.length).toBeGreaterThan(100)
    for (const named of ['WATCH — NO ADD', 'Forward context:', 'Long risk ~2 ATR below:', 'ATR reference stops', 'Risk:', 'BUY THE DIP']) {
      expect(advice.some((e) => e.text.includes(named)), named).toBe(true)
    }
    for (const e of advice) expect(offending(e.text), `${e.file}: ${e.text}`).toBe(true)
  })

  it('disclaimers pass only as whole sentences', () => {
    for (const ok of [
      'A description of where price sits relative to its long-run average; not a forecast or a trade signal.',
      'They are not a forecast, and forward returns for them have not been measured. Not investment advice.',
      'None of these figures is a forecast, and this platform has not measured what followed each zone.',
      'The ±2×ATR(14) levels are distances from the last close, not stop placement.',
    ]) expect(offending(ok), ok).toBe(false)
    expect(offending('Forward returns for these zones have not been measured to be negative.')).toBe(true)
  })

  it('the visitor finds strings planted into the real files (Q153-C8 V1-V8)', () => {
    for (const { file, anchor, insert } of PLANTS) {
      const src = read(file)
      expect(src.split(anchor).length - 1, `${file}: anchor must occur exactly once`).toBe(1)
      const planted = src.replace(anchor, `${insert}${anchor}`)
      expect(adviceOffenders(file, planted).length, `${file}: ${insert.slice(0, 60)}`).toBeGreaterThan(adviceOffenders(file, src).length)
    }
  })

  it('no surface gives trade instructions or return claims, apart from the pinned residuals', () => {
    for (const f of SURFACES) {
      const found = renderedText(f, read(f)).filter((t) => offending(t.text)).map((t) => t.text.replace(/\s+/g, ' ').trim())
      expect(found, f).toEqual((PINNED_RESIDUALS[f] ?? []).map((t) => t.replace(/\s+/g, ' ').trim()))
    }
  })

  // Q153-C6: the zones were coloured as a traffic light (green just above,
  // lime just below, red at both extremes), which carried "buy the dip / stop"
  // without the words. No UI surface may read the regime's `color` again.
  it('no UI surface colours by the regime zone', () => {
    const UI = SURFACES.filter((f) => f.endsWith('.tsx'))
    expect(UI.length).toBeGreaterThanOrEqual(3)
    for (const f of UI) {
      const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const reads: string[] = []
      const visit = (n: ts.Node) => {
        if (ts.isPropertyAccessExpression(n) && n.name.text === 'color' && /(?:^|\.)(?:regime|ma200Regime)!?$/.test(n.expression.getText(sf))) reads.push(n.getText(sf))
        ts.forEachChild(n, visit)
      }
      visit(sf)
      expect(reads, f).toEqual([])
    }
  })
})
