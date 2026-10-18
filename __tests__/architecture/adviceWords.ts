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
 */
import ts from 'typescript'

/** Trade, sizing and timing instructions — and the vocabulary that implies them. */
export const ADVICE = new RegExp(
  '\\b(?:' + [
    'buy(?:ing|s)?', 'sell(?:ing|s)?', 'buyers?', 'sellers?', 'purchase\\w*',
    'scale in', 'scaling in', 'average down', 'averaging (?:in|down)', 'accumulat\\w*',
    'avoid (?:long|chasing|averaging|new)', 'trim\\w*', 'tranches?', 'staged (?:entry|buying)', 'go all-in',
    'add(?:ing)? (?:on|to)', 'entry', 'entries', 'enter(?:ing)?', 'exit(?:ing)?', 'hold(?:ing)?',
    'take profits?', 'stop[- ]loss', '(?:reduce|increase) exposure', 'go (?:long|short)',
    'overweight', 'underweight', 'attractive', 'bounce', 'rebound', 'committ\\w*',
    'knife', 'screaming', 'opportunit\\w*', 'high[- ]probability', 'institutional',
    'target position', 'positioning',
    // Removed copy the first extension still missed (Q153-C9's restore list):
    'no add', "don't add", 'treat as (?:a )?watch', 'watch', 'monitor for', 'caution',
    '(?:long|short) risk', 'reference stops?', 'atr stops?', 'confirm\\w* (?:200MA|the slope|slope)',
    'kni(?:fe|ves)', 'oversold confirmation', 'dip signals?', 'quant signals?', 'risk level', 'high risk',
    // Value-laden names for a measured state (Q153-C16 and the removed zone labels).
    'bullish stack', 'bearish stack', 'golden cross', 'death cross', 'healthy uptrend', 'bull run', 'bear alert', 'capitulation',
  ].join('|') + ')\\b',
  'i',
)

/** Return, frequency and hit-rate claims, or an appeal to a historical study. */
export const RETURN_CLAIMS = new RegExp(
  [
    'forward returns?', 'forward context', 'return context', 'expected return', 'empirical return', 'past performance', 'hit[- ]rate', 'win rate', 'median \\d', '\\b\\d+M (?:fwd|forward|return)',
    '\\b(?:19|20)\\d\\d\\s*[–-]\\s*(?:19|20)\\d\\d\\b', '\\b(?:19|20)\\d\\d\\s+(?:and|to)\\s+(?:19|20)\\d\\d\\b', '\\bsince (?:19|20)\\d\\d\\b',
    '\\bhistoric\\w*', '\\bstatistic\\w*', '\\brare(?:ly)?\\b', '\\busually\\b', '\\btypically\\b', '\\btends? to\\b',
    '\\bmore likely\\b', '\\b(?:rose|fell|gained|returned|lost|recovered)\\b[^.]*\\d+(?:\\.\\d+)?%', '\\bover the following\\b', '\\b\\d+(?:\\.\\d+)?% of (?:such|the time|cases)\\b', '\\b\\d+-month\\b', '\\brisk-adjusted\\b',
  ].join('|'),
  'i',
)

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
  if (ADVICE.test(s) || RETURN_CLAIMS.test(s) || APPROVAL_MARK.test(s)) return true
  const trimmed = s.trim()
  if (!/\s/.test(trimmed)) return trimmed.split(/[-_/]+/).some((t) => ADVICE_TOKEN.test(t.replace(/[^A-Za-z]/g, '')))
  return false
}

/** Attributes whose value is rendered to a user; every other attribute is code. */
const RENDERED_ATTRIBUTES = new Set(['title', 'aria-label', 'alt', 'placeholder', 'label', 'aria-description'])

export interface RenderedText { text: string; line: number }

/**
 * Every piece of text a file can render, read from the PARSE TREE: string and
 * template literals (any length, single tokens included), JSX text, and the
 * rendered attributes. Excluded, because they are code: module specifiers,
 * literal TYPES, and the values of non-rendered JSX attributes (className, key,
 * href …), including template literals inside them.
 */
export function renderedText(path: string, source: string): RenderedText[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: RenderedText[] = []
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const inCodeAttribute = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p)) return !RENDERED_ATTRIBUTES.has(p.name.getText(sf))
      if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isSourceFile(p)) return false
    }
    return false
  }
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!inCodeAttribute(n) && n.text.trim() !== '') out.push({ text: n.text, line: line(n) })
    } else if (ts.isTemplateExpression(n)) {
      if (!inCodeAttribute(n)) {
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
