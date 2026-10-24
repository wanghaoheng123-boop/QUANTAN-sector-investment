/**
 * Q-153 (compliance Q153-C8, C9) — the ONE list of words that turn a
 * description into advice or a performance claim, and the ONE extractor of the
 * text a file renders. Imported by `regime-copy.test.ts` and
 * `__tests__/quant/mutationHardening.q078w4.test.ts`, which carried two
 * different lists over the same copy.
 *
 * The first guard missed 8 of 8 planted strings and 27 of 28 paraphrases: its
 * visitor kept only literals with whitespace (so `'Buy'`, `'ACCUMULATE'` and
 * `'BUY-THE-DIP'` were invisible), rejected JSX text containing `|`,
 * `unknown` or `number`, capped JSX text at 400 characters, and its word lists
 * held the spellings of the deleted sentences rather than the ideas.
 *
 * WHAT THIS DECIDER IS, STATED NARROWLY (Q153-R2-9). It recognises restored copy
 * and the vocabulary listed below. It is not a classifier of advice: a fresh
 * paraphrase with none of these words passes, and `regime-copy.test.ts` asserts
 * that in its "CANNOT do" block. Do not answer a missed paraphrase by adding its
 * spelling here: the round-2 review found this list had been fitted to the
 * round-1 paraphrases that way, and 0 of 36 fresh ones were caught.
 */
import ts from 'typescript'

/** Trade, sizing and timing instructions — and the vocabulary that implies them. */
export const ADVICE = new RegExp(
  '\\b(?:' + [
    'buy(?:ing|s)?', 'sell(?:ing|s)?', 'buyers?', 'sellers?', 'purchase\\w*',
    'scale in', 'scaling in', 'average down', 'averaging', 'accumulat\\w*',
    // Bare `avoid` and `averaging`: the narrower "avoid (long|chasing|…)" and
    // "averaging (in|down)" let "Avoid this sector." and "Averaging is not
    // advised." through (Q153-R2-7: the union with the old TRADE regex).
    'avoid', 'trim\\w*', 'tranches?', 'staged (?:entry|buying)', 'go all-in',
    'add(?:ing)? (?:on|to)', 'entry', 'entries', 'enter(?:ing)?', 'exit(?:ing)?', 'hold(?:ing)?',
    'take profits?', 'stop[- ]loss', '(?:reduce|increase) exposure', 'go (?:long|short)',
    'overweight', 'underweight', 'attractive', 'bounce', 'rebound', 'committ\\w*',
    'knife', 'screaming', 'opportunit\\w*', 'high[- ]probability', 'institutional',
    'target position', 'positioning',
    // Removed copy the first extension still missed (Q153-C9's restore list):
    'no add', "don't add", 'treat as (?:a )?watch', 'watch', 'monitor for', 'caution',
    '(?:long|short) risk', 'reference stops?', 'atr stops?', 'confirm\\w* (?:200MA|the slope|slope)',
    'kni(?:fe|ves)', 'oversold confirmation', 'dip signals?', 'quant signals?', 'risk level', 'high risk',
    // A removed C15 clause ("always verify on the exchange before trading"): it
    // presupposes the reader is about to trade.
    'before trading',
    // Value-laden names for a measured state (Q153-C16 and the removed zone labels).
    'bullish stack', 'bearish stack', 'golden cross', 'death cross', 'healthy uptrend', 'bull run', 'bear alert', 'capitulation',
  ].join('|') + ')\\b',
  'i',
)

/**
 * Return, frequency and hit-rate claims, or an appeal to a historical study —
 * and the performance vocabulary CLAUDE.md's FORBIDDEN section names
 * ("beats the market", "guaranteed", "proven"; Q153-R2-9).
 */
export const RETURN_CLAIMS = new RegExp(
  [
    'forward returns?', 'forward context', 'return context', 'expected return', 'empirical return', 'past performance', 'hit[- ]rate', 'win rate', 'median \\d', '\\b\\d+M (?:fwd|forward|return)',
    '\\b(?:19|20)\\d\\d\\s*[–-]\\s*(?:19|20)\\d\\d\\b', '\\b(?:19|20)\\d\\d\\s+(?:and|to)\\s+(?:19|20)\\d\\d\\b', '\\bsince (?:19|20)\\d\\d\\b',
    '\\bhistoric\\w*', '\\bstatistic\\w*', '\\brare(?:ly)?\\b', '\\busually\\b', '\\btypically\\b', '\\btends? to\\b',
    '\\bmore likely\\b', '\\b(?:rose|fell|gained|returned|lost|recovered)\\b[^.]*\\d+(?:\\.\\d+)?%', '\\bover the following\\b', '\\b\\d+(?:\\.\\d+)?% of (?:such|the time|cases)\\b', '\\b\\d+-month\\b', '\\brisk-adjusted\\b',
    // CLAUDE.md FORBIDDEN: marketing language and performance assertions.
    '\\bproven\\b', '\\bguarantee[sd]?\\b', '\\bbeat(?:s|ing)? the (?:market|S&P)', '\\boutperform\\w*',
  ].join('|'),
  'i',
)

/**
 * A return horizon used as a label or column header: "12M", "3M: +3.6%". CASE-
 * SENSITIVE on purpose — with the `i` flag it would hit "ρ (log ret, ~6m):" and
 * "Avg vol 3m:" (TechnicalsTab), which are look-back windows, not horizons.
 * The old TRADE regex in mutationHardening.q078w4 caught `\d+M`; the shared list
 * had dropped it (Q153-R2-7).
 */
const FORWARD_HORIZON_LABEL = /\b\d{1,2}M\b/

/** A whole literal that IS an instruction: `'Buy'`, `'ACCUMULATE'`, `'BUY-THE-DIP'`. */
const ADVICE_TOKEN = /^(?:buy|sell|accumulate|add|hold|trim|exit|enter|risk)$/i

/** A tick mark is an approval, not a measurement ("First Dip Zone ✅"). */
const APPROVAL_MARK = /[✅✔☑]/

/**
 * The disclaimers that may name what the page is NOT. Each is removed only when
 * it ends a sentence, so text appended to a disclaimer ("… have not been
 * measured to be negative") is still scanned.
 */
const DISCLAIMERS = [
  /not a forecast or a trade signal(?=\s*(?:[.;,]|$))/gi,
  /forward returns for (?:them|these zones) have not been measured(?=\s*(?:[.;]|$))/gi,
  /has not measured forward returns for these zones(?=\s*(?:[.;]|$))/gi,
  /this platform has not measured what followed each zone(?=\s*(?:[.;]|$))/gi,
]

export function offending(text: string): boolean {
  const s = DISCLAIMERS.reduce((acc, re) => acc.replace(re, ' '), text)
  if (ADVICE.test(s) || RETURN_CLAIMS.test(s) || FORWARD_HORIZON_LABEL.test(s) || APPROVAL_MARK.test(s)) return true
  const trimmed = s.trim()
  if (!/\s/.test(trimmed)) return trimmed.split(/[-_/]+/).some((t) => ADVICE_TOKEN.test(t.replace(/[^A-Za-z]/g, '')))
  return false
}

/**
 * JSX attributes whose value is CODE — a class, a key, an id, a handler — and
 * not text a reader sees. This is a DENY-list on purpose (Q153-R2-4): the first
 * version listed six attributes that render (`title`, `aria-label`, …) and
 * treated every other attribute as code, so `<MetricCard sub="…" />`,
 * `<input value="…" />` and `data-tooltip` were invisible, and emptying the set
 * broke no test. Now an attribute that is not listed here is SCANNED, so a new
 * prop that carries copy fails closed. Each attribute that holds a string on
 * the closure's `.tsx` files was classified (`skey` and `color` are project
 * props: a sort key and a Tailwind class); the other names are the standard
 * HTML, SVG and ARIA attributes that carry code or state, not text.
 */
const CODE_ATTRIBUTES = new Set([
  'className', 'class', 'key', 'ref', 'href', 'src', 'srcSet', 'id', 'htmlFor', 'type', 'role', 'style', 'scope',
  'target', 'rel', 'tabIndex', 'colSpan', 'rowSpan', 'viewBox', 'd', 'fill', 'stroke', 'xmlns',
  'data-testid',
  'aria-controls', 'aria-hidden', 'aria-expanded', 'aria-live', 'aria-labelledby', 'aria-describedby', 'aria-haspopup',
  'aria-selected', 'aria-pressed', 'aria-checked', 'aria-current', 'aria-disabled', 'aria-busy', 'aria-sort',
  'aria-orientation', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-atomic', 'aria-relevant',
  'skey', 'color',
])

/** Event handlers (`onClick`, `onChange`, …) carry code. */
const HANDLER_ATTRIBUTE = /^on[A-Z]\w*$/

export function isCodeAttribute(name: string): boolean {
  return CODE_ATTRIBUTES.has(name) || HANDLER_ATTRIBUTE.test(name)
}

/**
 * True when `n` sits inside the VALUE of a code attribute. The walk stops at the
 * nearest JSX element, so a string inside an element nested in an attribute
 * (`icon={<span>Buy</span>}`) is still scanned.
 */
export function isInCodeAttribute(n: ts.Node, sf: ts.SourceFile): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return isCodeAttribute(p.name.getText(sf))
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isSourceFile(p)) return false
  }
  return false
}

export function parseSource(path: string, source: string): ts.SourceFile {
  const kind = path.endsWith('.json') ? ts.ScriptKind.JSON
    : path.endsWith('x') ? ts.ScriptKind.TSX
      : path.endsWith('.mjs') || path.endsWith('.js') ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind)
}

export interface RenderedText { text: string; line: number }

/**
 * Every piece of text a file can render, read from the PARSE TREE: string and
 * template literals (any length, single tokens included), JSX text, and the
 * values of every JSX attribute that is not on the code deny-list. Excluded,
 * because they are code: module specifiers, literal TYPES, and the values of
 * code attributes (className, key, href, handlers …), including template
 * literals inside them. A `.json` file is read the same way, its property names
 * included (they are string literals; a name is scanned like a value).
 */
export function renderedText(path: string, source: string): RenderedText[] {
  const sf = parseSource(path, source)
  const out: RenderedText[] = []
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!isInCodeAttribute(n, sf) && n.text.trim() !== '') out.push({ text: n.text, line: line(n) })
    } else if (ts.isTemplateExpression(n)) {
      if (!isInCodeAttribute(n, sf)) {
        const text = [n.head.text, ...n.templateSpans.map((sp) => sp.literal.text)].join(' ')
        if (text.trim() !== '') out.push({ text, line: line(n) })
      }
    } else if (ts.isJsxText(n)) {
      const text = n.getText(sf).replace(/\s+/g, ' ').trim()
      if (text !== '') out.push({ text, line: line(n) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Offenders in a file: `path:line text`. */
export function adviceOffenders(path: string, source: string): string[] {
  return renderedText(path, source).filter((t) => offending(t.text)).map((t) => `${path}:${t.line} ${t.text.slice(0, 120)}`)
}
