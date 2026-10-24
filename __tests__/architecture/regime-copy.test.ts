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
 * WHAT THIS FILE GUARDS, in the terms it can defend (compliance rounds 1-3):
 *   1. WORDS — the shared decider (adviceWords.ts) flags the listed trade,
 *      sizing, return and FORBIDDEN-vocabulary words in every string the
 *      surfaces can render. It recognises restored copy and that vocabulary; it is
 *      not a classifier, and the "CANNOT do" block below says what it misses.
 *   2. STRUCTURE — three rules over the parse tree that the word lists cannot
 *      express: no UI surface reads the classifier's dipSignal / riskLevel /
 *      color (C1, C5, C6); none names a dip class (C1, C2); none holds a bare
 *      percentage as a string literal (the removed return table).
 *   3. REMOVED COPY — every string this package removed is frozen
 *      (q153RemovedCopy.json from main, q153Round1Copy.json from round 1) and
 *      matched as an exact literal.
 *   4. SCOPE — the surfaces are the import closure of the files that import the
 *      regime module (regimeUiRules.importClosure), so copy imported INTO a
 *      surface is read too.
 * Every capability is exercised by a regression planted into the REAL file's
 * text, one plant per test, each asserted to add its OWN text.
 *
 * ── Mutations run against this guard (2026-10-24). Each: the edit, the file,
 * and what failed. Each target string was asserted to occur exactly once before
 * mutating, and the file was restored from a backup and re-hashed.
 * (filled in below the tests, after the run)
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { adviceOffenders, isCodeAttribute, offending, renderedText } from './adviceWords'
import { bareFigureLiterals, dipLiterals, importClosure, moduleSpecifiers, regimeReads, resolveSpecifier, slopeArithmetic } from './regimeUiRules'
import removed from './q153RemovedCopy.json'
import round1 from './q153Round1Copy.json'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const readIfFile = (p: string): string | undefined => {
  const abs = join(ROOT, p)
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : undefined
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

// ─── Scope: derived, not listed ───

const REGIME_MODULE = 'lib/quant/technicals.ts'
const productFiles = execSync('git ls-files -z app components hooks lib', { cwd: ROOT }).toString().split('\0')
  .filter((p) => /\.(?:tsx?|mjs)$/.test(p) && !p.endsWith('.d.ts'))
/** Product files that import the regime module — by RESOLVED path, not by the text of the specifier. */
const IMPORTERS = productFiles.filter((p) => {
  const src = read(p)
  return src.includes('technicals') && moduleSpecifiers(p, src).specifiers.some((s) => resolveSpecifier(p, s, readIfFile) === REGIME_MODULE)
})
/** The regime module, its importers, and everything they import (copy flows INTO a surface). */
const { files: SURFACES, opaque: OPAQUE_IMPORTS } = importClosure([REGIME_MODULE, ...IMPORTERS], readIfFile)
/** The `.tsx` files among them: the rendered surfaces and the components they mount. */
const UI = SURFACES.filter((f) => f.endsWith('.tsx'))
/** Files whose copy is the point of this package; each must yield copy to the visitor. */
const CORE = ['lib/quant/technicals.ts', 'lib/crypto.ts', 'lib/quant/btc-indicators.ts', 'components/crypto/BtcQuantLab.tsx',
  'components/stock/quantlab/tabs/TechnicalsTab.tsx', 'app/ma-deviation/page.tsx', 'app/api/ma-deviation/route.ts', 'lib/quant/buildFundamentalsPayload.ts']

// ─── Recorded residuals, in two lists that mean different things (Q153-R2-10) ───

interface Pin { text: string; reason: string }
const VALUATION = 'valuation-band copy ("buy zone" / "sell zone"): whether a per-ticker band may be shown to retail users is owner-gated, Q-083'

/**
 * Advice-like copy this package did NOT change and that is owner-gated (Q-083).
 * It stays visible, pinned EXACTLY, so any new offender in these files still
 * fails. Not covered: SummaryTab.tsx, quantlab/ui.tsx and lib/quant/frameworks.ts
 * carry the same family and are outside the closure (see the CANNOT block).
 */
const OWNER_GATED_RESIDUALS: Record<string, Pin[]> = {
  'lib/quant/buildFundamentalsPayload.ts': [
    { text: 'Below buy-zone upper bound', reason: `${VALUATION}; shipped as the payload field \`signal\`` },
    { text: 'Price is at or below the mechanical buy-zone ceiling ( ) vs composite fair value ~ .', reason: VALUATION },
    { text: 'Above sell-zone lower bound', reason: VALUATION },
    { text: 'Price is at or above the mechanical sell-zone floor ( ).', reason: VALUATION },
    { text: 'Between buy-zone and sell-zone vs fair value ~ — model is not aggressive either way.', reason: VALUATION },
  ],
  'lib/quant/priceBands.ts': [
    { text: 'buy zone at % below fair value;', reason: `${VALUATION}; \`bands.methodology\`, rendered by SummaryTab and shipped by /api/fundamentals` },
    { text: 'sell zone at % above fair value (asymmetric vol-adjusted extension).', reason: VALUATION },
  ],
  'lib/quant/researchScore.ts': [
    { text: 'Closer to mechanical buy zone vs composite fair value.', reason: `${VALUATION}; a research-score pillar detail` },
    { text: 'Closer to mechanical sell zone vs composite fair value.', reason: VALUATION },
  ],
}

/**
 * Hits that are NOT advice: the decider is a word list, and these words are
 * ordinary vocabulary in these places. Recording one here is a claim that it is
 * not copy a reader acts on — each reason says why.
 */
const KNOWN_FALSE_POSITIVES: Record<string, Pin[]> = {
  'lib/barInterval.ts': [
    { text: '1M', reason: 'the chart interval key for one month (a bar size); the horizon pattern reads it as a return horizon' },
  ],
  'lib/data/providers/okxLiquidations.ts': [
    { text: 'sell', reason: "OKX's own `side` value, compared with ===; a vendor enum, not copy" },
    { text: 'buy', reason: "OKX's own `side` value, compared with ===; a vendor enum, not copy" },
  ],
  'lib/liquidationDisplay.ts': [
    { text: 'Long liquidations (forced sells)', reason: 'describes what a long liquidation IS (a forced sale); not an instruction' },
    { text: 'Short liquidations (forced buys)', reason: 'describes what a short liquidation IS (a forced purchase); not an instruction' },
  ],
  'lib/quant/btc-indicators.ts': [
    { text: 'CAPITULATION', reason: 'a regime-name literal in btcRegime(), which has no caller outside tests, so it is never rendered; delete or rename it before it is' },
  ],
  'lib/quant/buildFundamentalsPayload.ts': [
    { text: 'An FCF DCF is not applied to : inside Financial Services only are admitted, because elsewhere in the sector cash flow usually cannot be separated from financing.', reason: '"usually" is a statement about accounting, not a frequency claim about prices' },
  ],
  'lib/quant/researchScore.ts': [
    { text: 'Rough guide: under ~40 often means several weak pillars (e.g. stretched multiple, poor 60d RS vs SPY, or soft quality). Above ~65 means multiple pillars align — still not a buy/sell call.', reason: 'a rubric that says the score is "not a buy/sell call": a negation, matched on the words alone' },
  ],
}

// ─── Positive controls for the decider ───

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

/** Q153-R2-7: the old TRADE regex in mutationHardening.q078w4 caught each of these; the shared list had dropped them. */
const OLD_TRADE_COVERAGE = ['Avoid', 'Avoid adding here.', 'Avoid this sector.', 'Averaging is not advised.', '12M', '3M: +3.6%', '6M outcome', 'Forward 12M']

/** Q153-R2-9: CLAUDE.md's FORBIDDEN section ("beats the market", "guaranteed", "proven") and its siblings. */
const FORBIDDEN_VOCABULARY = [
  'Proven to work across cycles.', 'Guaranteed to revert.', 'Beat the S&P in 7 of 10 years.', 'Beats the market.',
  'Outperformed the market by 4% a year.', 'A strategy that outperforms.', 'Beating the market since 2010.',
]

// ─── Regressions planted into REAL files ───

type Rule = 'advice' | 'regime-read' | 'dip-literal' | 'figure' | 'removed-copy' | 'slope-format'

/** Strings that may not come back, as exact whole literals: round 1's labels and claims, the 26 figures. */
const BANNED_EXACT = new Map<string, string>()
for (const e of round1.entries) if (e.kind === 'label' || e.kind === 'claim') BANNED_EXACT.set(norm(e.text), 'round 1')
for (const e of removed.entries) if (e.kind === 'figure') BANNED_EXACT.set(norm(e.text), 'figure')
/** The C6 traffic light: the six circles, in any rendered literal. */
const TRAFFIC_LIGHT = /[🟢🟡🟠🔵🔴⚫]/u

const removedCopyHits = (file: string, src: string): string[] =>
  renderedText(file, src).map((t) => norm(t.text)).filter((t) => BANNED_EXACT.has(t) || TRAFFIC_LIGHT.test(t))

/** What each rule finds in `src`, as comparable strings. */
function hitsFor(rule: Rule, file: string, src: string): string[] {
  switch (rule) {
    case 'advice': return renderedText(file, src).filter((t) => offending(t.text)).map((t) => norm(t.text))
    case 'regime-read': return regimeReads(file, src).map((h) => h.text)
    case 'dip-literal': return dipLiterals(file, src).map((h) => h.text)
    case 'figure': return bareFigureLiterals(file, src).map((h) => h.text)
    case 'removed-copy': return removedCopyHits(file, src)
    case 'slope-format': return slopeArithmetic(file, src).map((h) => h.text)
  }
}
const ALL_RULES: Rule[] = ['advice', 'regime-read', 'dip-literal', 'figure', 'removed-copy', 'slope-format']

/** Multiset difference: what `after` has that `before` does not (a plant moves line numbers, never texts). */
function added(before: string[], after: string[]): string[] {
  const left = [...before]
  const out: string[] = []
  for (const h of after) {
    const i = left.indexOf(h)
    if (i >= 0) left.splice(i, 1)
    else out.push(h)
  }
  return out
}

interface Plant {
  id: string
  file: string
  anchor: string
  insert: string
  /** Where the insert goes. A JSX plant goes AFTER an opening tag so the result still parses. */
  placement?: 'before' | 'after'
  /** Per rule, the texts that must be among the NEW hits. An empty list is a negative control: no rule may add a hit. */
  expect: Array<{ rule: Rule; own: string[] }>
}

const PAGE = 'app/ma-deviation/page.tsx'
const BTC = 'components/crypto/BtcQuantLab.tsx'
const TECH = 'components/stock/quantlab/tabs/TechnicalsTab.tsx'
const REGIME_LIB = 'lib/quant/technicals.ts'
const PAGE_H2 = '<h2 className="text-sm font-bold text-white mb-4">How to read this gauge</h2>'
const PAGE_ZONE_INFO = '{/* Zone info */}'
const PAGE_LEGEND = 'const ZONE_LEGEND:'
const BTC_SIGNALS = '// Signal summary'
const BTC_EXPLAINED = '{daily && <p className="text-xs text-slate-400 mt-2 leading-relaxed">{regime.dipSignalExplained}</p>}'
const BTC_TAB = "{activeMetricTab === 'liquidations' && ("
const TECH_ROOT = '<div className="space-y-6">'
const TECH_EXPLAINED = '<p className="text-xs text-slate-400 mt-2 leading-relaxed">'
const REGIME_FN = 'export function ma200Regime('

const PLANTS: Plant[] = [
  // ── Q153-C8's eight, now one plant each (Q153-R2-15) ──
  { id: 'V1', file: REGIME_LIB, anchor: REGIME_FN, insert: "const V1 = { STRONG_DIP: 'Buy' }\n", expect: [{ rule: 'advice', own: ['Buy'] }] },
  { id: 'V2', file: BTC, anchor: BTC_SIGNALS, insert: "const V2 = { signal: 'ACCUMULATE' }\n", expect: [{ rule: 'advice', own: ['ACCUMULATE'] }] },
  { id: 'V3', file: BTC, anchor: BTC_SIGNALS, insert: "const V3 = { signal: 'BUY-THE-DIP' }\n", expect: [{ rule: 'advice', own: ['BUY-THE-DIP'] }] },
  { id: 'V4', file: PAGE, anchor: PAGE_H2, insert: '<p>Buy while the trend is unknown.</p>', expect: [{ rule: 'advice', own: ['Buy while the trend is unknown.'] }] },
  { id: 'V5', file: PAGE, anchor: PAGE_H2, insert: '<p>Buy below a rising average | sell far above it</p>', expect: [{ rule: 'advice', own: ['Buy below a rising average | sell far above it'] }] },
  { id: 'V6', file: TECH, anchor: TECH_ROOT, placement: 'after', insert: '<p>200-Day MA Regime — buying a small number of shares here is the usual approach</p>', expect: [{ rule: 'advice', own: ['buying a small number of shares'] }] },
  { id: 'V7', file: TECH, anchor: TECH_ROOT, placement: 'after', insert: "{x === 'STRONG_DIP' ? 'BUY' : null}", expect: [{ rule: 'advice', own: ['BUY'] }, { rule: 'dip-literal', own: ['STRONG_DIP'] }] },
  { id: 'V8', file: PAGE, anchor: PAGE_H2, insert: `<p>${'The gauge describes the distance from the average. '.repeat(9)}Buy the dip.</p>`, expect: [{ rule: 'advice', own: ['Buy the dip.'] }] },

  // ── Round 2's N1-N8: copy in a rendered prop the first visitor classed as code (Q153-R2-4) ──
  { id: 'N1', file: BTC, anchor: BTC_TAB, insert: '<MetricCard label="Funding" value="—" sub="Negative funding: a good time to go long" />', expect: [{ rule: 'advice', own: ['Negative funding: a good time to go long'] }] },
  { id: 'N2', file: BTC, anchor: BTC_TAB, insert: '<MetricCard label="Funding" value="Accumulate" />', expect: [{ rule: 'advice', own: ['Accumulate'] }] },
  { id: 'N3', file: PAGE, anchor: PAGE_H2, insert: "<Legend items={[{ name: 'Buy the dip below a rising average' }]} />", expect: [{ rule: 'advice', own: ['Buy the dip below a rising average'] }] },
  { id: 'N4', file: PAGE, anchor: PAGE_H2, insert: "<Tip content={'Scale in over three tranches'} />", expect: [{ rule: 'advice', own: ['Scale in over three tranches'] }] },
  { id: 'N5', file: PAGE, anchor: PAGE_H2, insert: '<input readOnly value="Sell into strength" />', expect: [{ rule: 'advice', own: ['Sell into strength'] }] },
  { id: 'N6', file: TECH, anchor: TECH_ROOT, placement: 'after', insert: '<Card heading="Top buy candidates" description="Highest-conviction names this week" />', expect: [{ rule: 'advice', own: ['Top buy candidates'] }] },
  { id: 'N7', file: TECH, anchor: TECH_ROOT, placement: 'after', insert: "<span data-tooltip='Trim above +20%'>i</span>", expect: [{ rule: 'advice', own: ['Trim above +20%'] }] },
  { id: 'N8', file: TECH, anchor: TECH_ROOT, placement: 'after', insert: "<div role='meter' aria-valuetext='Strong buy' />", expect: [{ rule: 'advice', own: ['Strong buy'] }] },
  // The attributes the old allow-list DID name, and the two literal forms the visitor must read.
  { id: 'A1', file: PAGE, anchor: PAGE_H2, insert: '<span title="Buy the dip">i</span>', expect: [{ rule: 'advice', own: ['Buy the dip'] }] },
  { id: 'A2', file: PAGE, anchor: PAGE_H2, insert: '<span aria-label="Strong buy">i</span>', expect: [{ rule: 'advice', own: ['Strong buy'] }] },
  { id: 'B1', file: REGIME_LIB, anchor: REGIME_FN, insert: 'const B1 = `Buy the dip`\n', expect: [{ rule: 'advice', own: ['Buy the dip'] }] },
  { id: 'B2', file: BTC, anchor: BTC_SIGNALS, insert: 'const B2 = <span title={`Buy the dip`}>i</span>\n', expect: [{ rule: 'advice', own: ['Buy the dip'] }] },

  // ── The round-1 closures (Q153-R2-2): P1-P3 are the reviewer's, the rest cover the other forms ──
  {
    id: 'P1', file: TECH, anchor: TECH_EXPLAINED,
    insert: "<div className={`text-sm font-bold px-3 py-1 rounded-full border ${data.ma200Regime.dipSignal === 'STRONG_DIP' ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300' : data.ma200Regime.dipSignal === 'FALLING_KNIFE' ? 'bg-red-950/60 border-red-500/50 text-red-300' : 'bg-slate-900/60 border-slate-700 text-slate-300'}`}>{data.ma200Regime.dipSignal === 'STRONG_DIP' ? '🟢 Below a rising average' : data.ma200Regime.dipSignal === 'FALLING_KNIFE' ? '🔴 Below an average that is not rising' : 'Below the average'}</div>",
    expect: [
      { rule: 'regime-read', own: ['ma200Regime.dipSignal'] },
      { rule: 'dip-literal', own: ['STRONG_DIP', 'FALLING_KNIFE'] },
      { rule: 'removed-copy', own: ['🟢 Below a rising average', 'Below the average'] },
    ],
  },
  { id: 'P2', file: BTC, anchor: BTC_EXPLAINED, insert: "{daily && <div className={regime.riskLevel === 'low' ? 'text-green-400' : 'text-red-400'}>Drawdown outlook: {regime.riskLevel}</div>}", expect: [{ rule: 'regime-read', own: ['regime.riskLevel'] }] },
  { id: 'P3', file: PAGE, anchor: PAGE_ZONE_INFO, insert: '{(() => { const { color: zc } = regime; return <span style={{ color: zc }}>{regime.label}</span> })()}', expect: [{ rule: 'regime-read', own: ['color: zc'] }] },
  { id: 'P3-element', file: BTC, anchor: BTC_EXPLAINED, insert: "{daily && <span style={{ color: regime['color'] }}>x</span>}", expect: [{ rule: 'regime-read', own: ["regime['color']"] }] },
  { id: 'P3-alias', file: PAGE, anchor: PAGE_ZONE_INFO, insert: '{(() => { const r = regime; return <span>{r.color}</span> })()}', expect: [{ rule: 'regime-read', own: ['r.color'] }] },
  { id: 'P3-nested', file: PAGE, anchor: PAGE_LEGEND, insert: 'const P3N = (rows: Array<{ regime: unknown }>) => rows.map(({ regime: { color } }) => color)\n', expect: [{ rule: 'regime-read', own: ['color'] }] },
  { id: 'P3-typed', file: PAGE, anchor: PAGE_LEGEND, insert: 'const P3T = (r: MA200Regime) => r.color\n', expect: [{ rule: 'regime-read', own: ['r.color'] }] },
  // C2: the legend's classification column named a class, and read nothing off the regime.
  { id: 'P4', file: PAGE, anchor: PAGE_LEGEND, insert: "const OLD_LEGEND = [{ zone: '0 to -10%', label: '0–10% below', dipSignal: 'STRONG_DIP' }]\n", expect: [{ rule: 'dip-literal', own: ['STRONG_DIP'] }] },
  { id: 'P4-keys', file: PAGE, anchor: PAGE_LEGEND, insert: "const COLOURS = { STRONG_DIP: 'text-emerald-300', FALLING_KNIFE: 'text-red-300' }\n", expect: [{ rule: 'dip-literal', own: ['STRONG_DIP', 'FALLING_KNIFE'] }] },
  { id: 'P4-class', file: PAGE, anchor: PAGE_H2, insert: "<div className={`pill ${v === 'WATCH_DIP' ? 'a' : 'b'}`} />", expect: [{ rule: 'dip-literal', own: ['WATCH_DIP'] }] },
  { id: 'P4-header', file: PAGE, anchor: PAGE_H2, insert: '<th>Classification</th>', expect: [{ rule: 'removed-copy', own: ['Classification'] }] },
  { id: 'P4-light', file: PAGE, anchor: PAGE_H2, insert: '<span>🟢 Cheap</span>', expect: [{ rule: 'removed-copy', own: ['🟢 Cheap'] }] },
  // The removed return table: its figures as string literals, and a figure nobody froze.
  {
    id: 'P5', file: PAGE, anchor: PAGE_LEGEND,
    insert: "const ZONE_OUTCOMES = [{ zone: '0 to -10%', m3: '+3.6%', m6: '+6.8%', m12: '+11.2%', pos: '68%' }, { zone: '< -30%', m3: '+4.8%', m6: '+14.3%', m12: '+28.7%', pos: '72%' }]\n",
    expect: [
      { rule: 'figure', own: ['+3.6%', '+11.2%', '68%', '+28.7%', '72%'] },
      { rule: 'removed-copy', own: ['+3.6%', '68%', '72%'] },
    ],
  },
  { id: 'P5-headers', file: PAGE, anchor: PAGE_LEGEND, insert: "const OUTCOME_HEADERS = ['3M', '6M', '12M', 'Share positive']\n", expect: [{ rule: 'advice', own: ['3M', '12M'] }] },
  { id: 'P5-fresh', file: PAGE, anchor: PAGE_LEGEND, insert: "const FRESH = { m12: '+9.9%' }\n", expect: [{ rule: 'figure', own: ['+9.9%'] }] },

  // The slope is rounded in ONE place (Q153-R2-14): a surface that rounds it itself can print the threshold from the wrong side.
  { id: 'P9', file: PAGE, anchor: PAGE_LEGEND, insert: 'const P9 = (regime: { slopePct: number }) => `${(regime.slopePct * 100).toFixed(2)}%`\n', expect: [{ rule: 'slope-format', own: ['regime.slopePct * 100'] }] },

  // ── Negative controls: copy-shaped text in places that are code, and reads that are allowed ──
  {
    id: 'NEG-code-attributes', file: PAGE, anchor: PAGE_H2,
    insert: '<div data-testid="buy-row" className="hold sell buy" key="exit" id="entry" role="tab" href="/buy" scope="col" type="button" aria-controls="buy" aria-live="polite" skey="buy" color="text-sell" style={{ content: \'hold\' }} onClick={() => console.log(\'sell\')} />',
    expect: [],
  },
  { id: 'NEG-type-positions', file: PAGE, anchor: PAGE_LEGEND, insert: "type NegDip = 'STRONG_DIP' | 'WATCH_DIP'\ninterface NegShape { dipSignal: NegDip; riskLevel: string }\n", expect: [] },
  {
    id: 'NEG-allowed-reads', file: PAGE, anchor: PAGE_LEGEND,
    insert: 'const NEG = (regime: { label: string; dipSignalExplained: string }, s: { color: string }) => [regime.label, regime.dipSignalExplained, s.color, ({ label, value, color }: { label: string; value: string; color: string }) => `${label}${value}${color}`]\n',
    expect: [],
  },
]

/** Syntax errors only: a plant that does not parse proves nothing about what the visitor can see. */
function syntaxErrors(file: string, src: string): string[] {
  const out = ts.transpileModule(src, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext } })
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
}

const plantInto = (src: string, p: Plant): string =>
  src.replace(p.anchor, () => (p.placement === 'after' ? `${p.anchor}${p.insert}` : `${p.insert}${p.anchor}`))

// ═══════════════════════════════════════════════════════════════════════════════

describe('regime copy describes, and quotes no unmeasured returns (Q-153)', () => {
  describe('scope: the import closure of the surfaces (Q153-R2-8)', () => {
    it('visits every file the package is about, derived from imports rather than listed', () => {
      for (const f of ['app/api/ma-deviation/route.ts', 'lib/quant/buildFundamentalsPayload.ts', 'components/crypto/BtcQuantLab.tsx',
        'components/stock/quantlab/tabs/TechnicalsTab.tsx', 'app/ma-deviation/page.tsx']) {
        expect(IMPORTERS, f).toContain(f)
      }
      for (const f of CORE) expect(SURFACES, f).toContain(f)
      for (const f of CORE) expect(renderedText(f, read(f)).length, `${f}: the visitor found no copy`).toBeGreaterThan(2)
    })

    it('reaches copy that only flows INTO a surface: lib/crypto.ts and btc-indicators.ts are not listed anywhere', () => {
      // BtcQuantLab -> lib/crypto.ts -> `export … from './quant/btc-indicators'`: two hops, one of them a re-export.
      expect(IMPORTERS).not.toContain('lib/crypto.ts')
      expect(IMPORTERS).not.toContain('lib/quant/btc-indicators.ts')
      expect(SURFACES).toContain('lib/crypto.ts')
      expect(SURFACES).toContain('lib/quant/btc-indicators.ts')
    })

    it('the rendered files are among them, and no dynamic import in the closure is unresolvable', () => {
      expect(UI).toEqual(expect.arrayContaining(['app/ma-deviation/page.tsx', 'components/crypto/BtcQuantLab.tsx', 'components/stock/quantlab/tabs/TechnicalsTab.tsx']))
      // A non-literal import() cannot be followed; the closure refuses to ignore one.
      expect(OPAQUE_IMPORTS).toEqual([])
    })

    it('importClosure follows relative, @/ and re-export edges, skips type-only imports and packages, and reports opaque imports', () => {
      const files: Record<string, string> = {
        'lib/a.ts': "import { b } from './b'\nimport type { T } from './types'\nimport React from 'react'\nexport * from '@/lib/c'\nconst x = import(name)\nconst y = import('./lazy')",
        'lib/b.ts': "export { d } from '../data/d.json'",
        'lib/c.ts': 'export const c = 1',
        'lib/lazy.ts': "import cfg from '../data/cfg'\nexport const lazy = cfg",
        'data/cfg.json': '{ "c": 1 }',
        'lib/types.ts': 'export type T = string',
        'data/d.json': '{ "d": 1 }',
        'lib/orphan.ts': 'export const orphan = 1',
      }
      const result = importClosure(['lib/a.ts'], (p) => files[p])
      expect(result.files).toEqual(['data/cfg.json', 'data/d.json', 'lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/lazy.ts']) // cfg: an extensionless import of a .json file
      expect(result.opaque).toEqual(['lib/a.ts:5'])
    })
  })

  describe('the decider', () => {
    it('catches every paraphrase the reviewer wrote (positive controls)', () => {
      for (const s of PARAPHRASES) expect(offending(s), s).toBe(true)
    })

    it('keeps what the old TRADE regex caught (Q153-R2-7), without hitting look-back windows', () => {
      for (const s of OLD_TRADE_COVERAGE) expect(offending(s), s).toBe(true)
      // Case-sensitive on purpose: lower-case "m" is a look-back window, not a return horizon.
      for (const s of ['ρ (log ret, ~6m):', 'Avg vol 3m:', 'Up days (~252d):']) expect(offending(s), s).toBe(false)
    })

    it("flags CLAUDE.md's FORBIDDEN vocabulary (Q153-R2-9)", () => {
      for (const s of FORBIDDEN_VOCABULARY) expect(offending(s), s).toBe(true)
    })

    it('catches every advice string this package removed, if restored', () => {
      const advice = removed.entries.filter((e) => e.kind === 'advice')
      expect(removed.entries.length).toBeGreaterThan(200)
      expect(advice.length).toBeGreaterThan(100)
      for (const named of ['WATCH — NO ADD', 'Forward context:', 'Long risk ~2 ATR below:', 'ATR reference stops', 'Risk:', 'BUY THE DIP', 'always verify on the exchange before trading']) {
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
  })

  describe('the visitor: what counts as rendered text (Q153-R2-4)', () => {
    const texts = (src: string) => renderedText('x.tsx', src).map((t) => t.text)

    it('reads an attribute that is NOT on the code deny-list, including custom props', () => {
      expect(texts('const a = <MetricCard sub="Longs: 52%" label="L" />')).toEqual(expect.arrayContaining(['Longs: 52%', 'L']))
      expect(texts("const a = <input value='Sell' />")).toContain('Sell')
      expect(texts("const a = <span data-tooltip='Trim' />")).toContain('Trim')
      expect(texts('const a = <div aria-valuetext="Strong buy" />')).toContain('Strong buy')
    })

    it('does not read the value of a code attribute, however it is written', () => {
      expect(texts('const a = <div className="buy" key="sell" id="hold" href="/exit" data-testid="entry" role="tab" />')).toEqual([])
      expect(texts('const a = <div className={`x ${v ? "buy" : "sell"}`} onClick={() => go("hold")} style={{ content: "exit" }} />')).toEqual([])
      expect(texts('const a = <Row skey="buy" color="text-sell" aria-controls="x" aria-live="polite" />')).toEqual([])
    })

    it('still reads a string inside an ELEMENT nested in a code attribute', () => {
      expect(texts('const a = <Row key={<b>Buy</b>} />')).toContain('Buy')
    })

    it('reads no-substitution template literals and ignores literal TYPES and imports', () => {
      expect(texts('const a = `Buy the dip`')).toEqual(['Buy the dip'])
      expect(texts("import x from 'buy'\ntype T = 'sell'\nconst a: T = 'hold'")).toEqual(['hold'])
    })

    it('the deny-list is exactly the code attributes listed, plus on* handlers', () => {
      for (const n of ['className', 'key', 'href', 'id', 'type', 'role', 'style', 'scope', 'data-testid', 'aria-controls', 'aria-hidden', 'aria-expanded', 'skey', 'color', 'onClick', 'onChange']) {
        expect(isCodeAttribute(n), n).toBe(true)
      }
      for (const n of ['title', 'aria-label', 'alt', 'placeholder', 'label', 'sub', 'value', 'description', 'heading', 'content', 'data-tooltip', 'aria-valuetext', 'name', 'once', 'onlyText']) {
        expect(isCodeAttribute(n), n).toBe(false)
      }
    })
  })

  describe('regressions planted into the real files (one plant per test, each asserted to add its own text)', () => {
    it('the unplanted files parse, so a planted file that does not parse is a plant failure', () => {
      for (const f of new Set(PLANTS.map((p) => p.file))) expect(syntaxErrors(f, read(f)), f).toEqual([])
    })

    it.each(PLANTS.map((p) => [p.id, p] as const))('%s', (_id, plant) => {
      const src = read(plant.file)
      expect(src.split(plant.anchor).length - 1, `${plant.file}: anchor must occur exactly once`).toBe(1)
      const planted = plantInto(src, plant)
      expect(syntaxErrors(plant.file, planted), `${plant.id} must parse`).toEqual([])
      if (plant.expect.length === 0) {
        for (const rule of ALL_RULES) expect(added(hitsFor(rule, plant.file, src), hitsFor(rule, plant.file, planted)), `${plant.id}: ${rule} must add nothing`).toEqual([])
      }
      for (const { rule, own } of plant.expect) {
        const newHits = added(hitsFor(rule, plant.file, src), hitsFor(rule, plant.file, planted))
        for (const text of own) expect(newHits.some((h) => h.includes(text)), `${plant.id}: ${rule} did not add ${JSON.stringify(text)}; added ${JSON.stringify(newHits)}`).toBe(true)
      }
    })
  })

  describe('what the surfaces say today', () => {
    // Pins are compared as sets in both directions: an unpinned hit fails, and so does a pin that no longer matches.
    it('no surface gives trade instructions or return claims, apart from the recorded residuals', () => {
      for (const f of SURFACES) {
        const found = renderedText(f, read(f)).filter((t) => offending(t.text)).map((t) => norm(t.text)).sort()
        const pinned = [...(OWNER_GATED_RESIDUALS[f] ?? []), ...(KNOWN_FALSE_POSITIVES[f] ?? [])].map((p) => norm(p.text)).sort()
        expect(found, f).toEqual(pinned)
      }
    })

    it('every recorded residual names a file the guard visits and says why', () => {
      for (const [list, pins] of [['owner-gated', OWNER_GATED_RESIDUALS], ['false-positive', KNOWN_FALSE_POSITIVES]] as const) {
        for (const [file, entries] of Object.entries(pins)) {
          expect(SURFACES, `${list}: ${file} is not a visited surface, so its pin can never be checked`).toContain(file)
          for (const p of entries) expect(p.reason.length, `${file}: ${p.text}`).toBeGreaterThan(20)
        }
      }
      for (const file of Object.keys(OWNER_GATED_RESIDUALS)) {
        const both = (KNOWN_FALSE_POSITIVES[file] ?? []).map((p) => norm(p.text))
        for (const p of OWNER_GATED_RESIDUALS[file]) expect(both, `${file}: ${p.text} is listed as both`).not.toContain(norm(p.text))
      }
    })
  })

  // Q153-C1, C5, C6: the badge, "Risk: low" and the traffic-light colours were REMOVED, and the
  // word lists cannot see them return — the C1 badge's labels are honest words and its colour
  // sits in a className expression. The structure is what they had in common.
  describe('no UI surface reads or names the classifier (Q153-R2-2)', () => {
    it('reads no dipSignal, riskLevel, or regime color', () => {
      expect(UI.length).toBeGreaterThanOrEqual(5)
      for (const f of UI) expect(regimeReads(f, read(f)).map((h) => `${f}:${h.line} ${h.text}`), f).toEqual([])
    })

    it('names no dip class outside a type position', () => {
      for (const f of UI) expect(dipLiterals(f, read(f)).map((h) => `${f}:${h.line} ${h.text}`), f).toEqual([])
    })

    describe('rule (a) on synthetic source', () => {
      const reads = (src: string) => regimeReads('x.tsx', src).map((h) => h.text)
      it.each([
        ['property access', 'const a = regime.color', ['regime.color']],
        ['optional chain', 'const a = regime?.color', ['regime?.color']],
        ['non-null', 'const a = regime!.color', ['regime!.color']],
        ['as-cast', 'const a = (regime as Foo).color', ['(regime as Foo).color']],
        ['nested receiver', 'const a = row.regime?.riskLevel', ['row.regime?.riskLevel']],
        ['payload receiver', 'const a = data.ma200Regime.dipSignal', ['data.ma200Regime.dipSignal']],
        ['call result', 'const a = ma200Regime(p, c).color', ['ma200Regime(p, c).color']],
        ['element access', "const a = regime['color']", ["regime['color']"]],
        ['element access, double quotes', 'const a = regime["dipSignal"]', ['regime["dipSignal"]']],
        ['element access, template', 'const a = regime[`riskLevel`]', ['regime[`riskLevel`]']],
        ['computed key on the regime', 'const a = regime[key]', ['regime[key]']],
        ['destructuring', 'const { color } = regime', ['color']],
        ['destructuring, renamed', 'const { color: zc } = row.regime', ['color: zc']],
        ['destructuring with a fallback', 'const { color } = regime ?? fallback', ['color']],
        ['a ternary receiver', 'const a = (ok ? regime : other).color', ['(ok ? regime : other).color']],
        ['a || receiver', 'const a = (regime || {}).riskLevel', ['(regime || {}).riskLevel']],
        ['nested destructuring', 'const { regime: { color } } = row', ['color']],
        ['nested destructuring in a parameter', 'rows.map(({ regime: { riskLevel } }) => riskLevel)', ['riskLevel']],
        ['destructuring assignment', 'let c; ({ color: c } = regime)', ['color: c']],
        ['alias', 'const r = regime; const a = r.color', ['r.color']],
        ['alias through a binding', 'const { regime: rg } = row; const a = rg.color', ['rg.color']],
        ['parameter typed as the regime', 'const f = (r: MA200Regime) => r.color', ['r.color']],
        ['destructured parameter typed as the regime', 'const f = ({ color }: MA200Regime) => color', ['color']],
        ['dipSignal on any receiver', 'const a = x.dipSignal', ['x.dipSignal']],
        ['riskLevel destructured from anything', 'const f = ({ riskLevel }) => riskLevel', ['riskLevel']],
      ])('%s', (_name, src, expected) => { expect(reads(src as string)).toEqual(expected) })

      it.each([
        ['the measured sentence', 'const a = regime.dipSignalExplained'],
        ['other regime fields', 'const a = [regime.label, regime.interpretation, regime.slopePct, regime.deviationPct]'],
        ['color off something that is not the regime', 'const a = s.color; const b = ({ label, color }) => color'],
        ['a parameter named color', 'const f = (color: string) => color'],
        ['a type member', 'interface R { dipSignal: string; riskLevel: string; color: string }'],
        ['an object literal that defines the fields', "const a = { dipSignal: 'x', riskLevel: 'low', color: '#fff' }"],
      ])('allows %s', (_name, src) => { expect(reads(src)).toEqual([]) })
    })

    describe('rule (b) on synthetic source', () => {
      const lits = (src: string) => dipLiterals('x.tsx', src).map((h) => h.text)
      it.each([
        ['a comparison', "const a = x === 'STRONG_DIP'", ['STRONG_DIP']],
        ['an object value', "const a = { dipSignal: 'WATCH_DIP' }", ['WATCH_DIP']],
        ['an object KEY (a colour map)', "const a = { FALLING_KNIFE: 'text-red-300' }", ['FALLING_KNIFE']],
        ['a string key', "const a = { 'IN_TREND': 1 }", ['IN_TREND']],
        ['a template piece', 'const a = `x ${y} STRONG_DIP`', ['STRONG_DIP']],
        ['a no-substitution template', 'const a = `WATCH_DIP`', ['WATCH_DIP']],
        ['inside a className expression', "const a = <i className={v === 'FALLING_KNIFE' ? 'a' : 'b'} />", ['FALLING_KNIFE']],
        ['JSX text', 'const a = <p>IN_TREND</p>', ['IN_TREND']],
      ])('%s', (_name, src, expected) => { expect(lits(src as string)).toEqual(expected) })

      it.each([
        ['a literal type', "type D = 'STRONG_DIP' | 'WATCH_DIP'"],
        ['an interface member', 'interface I { STRONG_DIP: string }'],
        ['a type assertion', "const a = x as 'FALLING_KNIFE'"],
        ['OVERBOUGHT, the RSI state label', "const a = x > 70 ? 'OVERBOUGHT' : 'NEUTRAL'"],
        ['INSUFFICIENT_DATA', "const a = 'INSUFFICIENT_DATA'"],
        ['an import specifier', "import x from 'IN_TREND'"],
      ])('allows %s', (_name, src) => { expect(lits(src)).toEqual([]) })
    })
  })

  describe('the slope is formatted by formatSlopePct (Q153-R2-14)', () => {
    it('no UI surface scales a slope to a percentage itself', () => {
      for (const f of UI) expect(slopeArithmetic(f, read(f)).map((h) => `${f}:${h.line} ${h.text}`), f).toEqual([])
    })

    it('the rule sees a slope times 100 either way round, and nothing else', () => {
      const hits = (src: string) => slopeArithmetic('x.tsx', src).map((h) => h.text)
      expect(hits('const a = (regime.slopePct * 100).toFixed(2)')).toEqual(['regime.slopePct * 100'])
      expect(hits('const a = 100 * slope')).toEqual(['100 * slope'])
      expect(hits('const a = [rangePosition * 100, metrics.fundingRate * 100, Math.abs(c) / 35 * 50, slopePct * 2]')).toEqual([])
    })
  })

  // The removed "Empirical Forward Return Reference": 26 medians and hit rates, each an exact string
  // literal. The fixture used to call them "undetectable as text"; they were never undetectable.
  describe('the removed return table, its labels and its traffic light do not return (Q153-R2-5)', () => {
    it('no surface holds a bare percentage as a string literal', () => {
      for (const f of SURFACES) expect(bareFigureLiterals(f, read(f)).map((h) => `${f}:${h.line} ${h.text}`), f).toEqual([])
    })

    it('the rule reads string literals only: scale ticks in JSX text and code attributes are not figures', () => {
      const figures = (src: string) => bareFigureLiterals('x.tsx', src).map((h) => h.text)
      expect(figures("const a = ['+3.6%', '68%', '-4.1%', '−4.1%', ` 12.5% `]")).toEqual(['+3.6%', '68%', '-4.1%', '−4.1%', ' 12.5% '])
      expect(figures('const a = <p><span>-35%</span><i style={{ width: "0%" }} /></p>')).toEqual([])
      expect(figures("const a = ['0 to -10%', 'Up 3.6%', '3.6', 'x%']")).toEqual([])
    })

    it('none of the 26 frozen figures, none of round 1\'s labels and claims, and no traffic-light circle is rendered', () => {
      for (const f of SURFACES) expect(removedCopyHits(f, read(f)), f).toEqual([])
    })

    it('the first fixture classifies what it holds', () => {
      const kinds = new Set(removed.entries.map((e) => e.kind))
      expect([...kinds].sort()).toEqual(['advice', 'code', 'figure', 'glyph', 'neutral'])
      const figures = removed.entries.filter((e) => e.kind === 'figure')
      expect(figures).toHaveLength(26)
      for (const e of figures) expect(e.text, e.text).toMatch(/^\+?\d+(?:\.\d+)?%$/)
      // The six circles rendered; they are not code, and they are banned as rendered text.
      const glyphs = removed.entries.filter((e) => e.kind === 'glyph').map((e) => e.text)
      for (const c of ['🟢', '🟡', '🟠', '🔵', '🔴', '⚫']) expect(glyphs, c).toContain(c)
      for (const c of glyphs) expect(c, c).not.toMatch(/[A-Za-z0-9]/)
      expect(removed.entries.filter((e) => e.kind === 'code').map((e) => e.text).join(' ')).not.toMatch(/[🟢🟡🟠🔵🔴⚫▲▼↗↘→]/u)
      expect(removed.note).not.toMatch(/undetectable/)
    })

    it('the second fixture holds what round 1 introduced and round 2 removed, as exact literals', () => {
      const labels = round1.entries.filter((e) => e.kind === 'label' || e.kind === 'claim').map((e) => e.text)
      expect(labels.length).toBeGreaterThanOrEqual(15)
      for (const named of ['Below a rising average', 'Below the average', 'Below an average that is not rising', 'Far above the average', 'Above the average', 'Classification', 'Deviation zones and their classification']) {
        expect(labels, named).toContain(named)
      }
      expect(new Set(labels).size).toBe(labels.length)
      for (const e of round1.entries) expect(['label', 'claim', 'fragment'], e.text).toContain(e.kind)
      // Not word-list entries: "Above the average" is an honest phrase and the decider must keep passing it.
      expect(offending('Above the average')).toBe(false)
      expect(offending('Below the average')).toBe(false)
    })
  })

  describe('what this guard CANNOT do (each is a passing test: a green run is not a proof)', () => {
    it('a fresh paraphrase with none of the listed words passes (Q153-R2-9)', () => {
      for (const s of ['Load up below the average.', 'Looks expensive here.', 'Poised to rally.', 'Size the position at 2% of capital.',
        'Rotate into energy.', 'Cheap versus its 200-day average.', 'Stay on the sidelines until the slope turns.']) {
        expect(offending(s), s).toBe(false)
      }
    })

    it('a claim appended to an allowlisted disclaimer passes when it contains no listed word', () => {
      expect(offending('Forward returns for these zones have not been measured; they averaged +11%.')).toBe(false)
      expect(offending('This platform has not measured what followed each zone; the median was +15%.')).toBe(false)
    })

    it('string concatenation hides a word across two fragments (Q153-R2-16)', () => {
      expect(adviceOffenders('x.ts', "const a = 'Bu' + 'y the dip'")).toEqual([])
      expect(adviceOffenders('x.tsx', "const a = <p>{'Bu' + 'y'} now</p>")).toEqual([])
    })

    it('an HTML entity in JSX text hides a letter: the text is read raw (Q153-R2-16)', () => {
      expect(adviceOffenders('x.tsx', 'const a = <p>B&#117;y the dip</p>')).toEqual([])
      expect(adviceOffenders('x.tsx', 'const a = <p>Buy the dip</p>')).toHaveLength(1)
    })

    it('copy that arrives at runtime or from a module the closure does not reach is not read (Q153-R2-8)', () => {
      // BtcQuantLab renders `metrics.userMessage`, written by a route it reaches over HTTP, not by import.
      expect(read('components/crypto/BtcQuantLab.tsx')).toContain('userMessage')
      expect(SURFACES).not.toContain('app/api/crypto/btc/metrics/route.ts')
      // An import whose specifier is computed is reported, not followed.
      const virtual: Record<string, string> = { 'a.tsx': 'const m = await import(`./copy/${name}`)', 'copy/x.ts': "export const t = 'Buy the dip'" }
      const result = importClosure(['a.tsx'], (p) => virtual[p])
      expect(result.files).toEqual(['a.tsx'])
      expect(result.opaque).toEqual(['a.tsx:1'])
      // A URL is not an import.
      expect(importClosure(['b.tsx'], (p) => ({ 'b.tsx': "fetch('/api/x')", 'app/api/x/route.ts': "export const t = 'Buy'" })[p]).files).toEqual(['b.tsx'])
    })

    it('sibling tabs mounted by the same panel are outside the closure, and they carry the same family of copy (Q153-R2-12)', () => {
      for (const f of ['components/stock/quantlab/tabs/SummaryTab.tsx', 'components/stock/quantlab/ui.tsx', 'lib/quant/frameworks.ts']) {
        expect(SURFACES, f).not.toContain(f)
        expect(adviceOffenders(f, read(f)).length, `${f} would be flagged if it were visited`).toBeGreaterThan(0)
      }
    })

    it('a component that renames the prop and annotates nothing reads the regime unseen', () => {
      expect(regimeReads('x.tsx', 'export const Badge = ({ r }: { r: { color: string } }) => <i>{r.color}</i>')).toEqual([])
      expect(regimeReads('x.tsx', 'const c = { ...regime }; const d = c.color')).toEqual([])
    })

    it('a slope held in a variable that is not named for it is rounded unseen', () => {
      expect(slopeArithmetic('x.tsx', 'const f = (s: number) => (s * 100).toFixed(2)')).toEqual([])
    })

    it('a dip class written without its enum spelling is not a dip literal', () => {
      expect(dipLiterals('x.tsx', "const a = 'strong_dip'.toUpperCase()")).toEqual([])
      expect(dipLiterals('x.tsx', "const a = ['STRONG', 'DIP'].join('_')")).toEqual([])
    })
  })
})
