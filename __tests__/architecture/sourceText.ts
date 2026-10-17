import ts from 'typescript'

/**
 * Shared source-text helpers for guards that read code as text. Not a test
 * file: importing a *.test.ts module would re-register its tests.
 */

/**
 * Blank every comment and string literal (template literals included) to
 * spaces, preserving length and newlines. A tokenizer rather than regexes: a
 * regex that strips `//` also cuts `'https://…'`, and one that strips quotes
 * trips over an apostrophe inside a comment (red-team round 2).
 */
export function blankNonCode(src: string): string {
  let out = ''
  let i = 0
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (c === '/' && n === '/') {
      const j = src.indexOf('\n', i); const end = j < 0 ? src.length : j
      out += blank(src.slice(i, end)); i = end
    } else if (c === '/' && n === '*') {
      const j = src.indexOf('*/', i + 2); const end = j < 0 ? src.length : j + 2
      out += blank(src.slice(i, end)); i = end
    } else if (c === '`') {
      // Template: blank the text, KEEP each `${…}` interpolation — it is code.
      out += ' '
      let j = i + 1
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { out += blank(src.slice(j, j + 2)); j += 2; continue }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 0, k = j + 1
          for (; k < src.length; k++) {
            if (src[k] === '{') depth++
            else if (src[k] === '}' && --depth === 0) break
          }
          out += src.slice(j, k + 1); j = k + 1; continue
        }
        out += blank(src[j]); j += 1
      }
      out += ' '; i = j + 1
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      const body = src.slice(i + 1, j)
      // An identifier-only string is kept, unquoted, so a bracket key
      // `out['field']` reads as `out[ field ]` — never as a `.field` read.
      out += ' ' + (/^\w+$/.test(body) ? body : blank(body)) + ' '; i = j + 1
    } else { out += c; i += 1 }
  }
  return out
}

/**
 * Remove comments — line (including TRAILING), block and JSX `{/* … *\/}` —
 * keeping string contents, for scans that look for user-facing text. A scan
 * for a retired label must not blank the string literal that carries it, and
 * a positive assertion ("the component calls X") must not be satisfied by a
 * comment (Q-138 red-team A15).
 *
 * Uses the TypeScript compiler's own emitter (`removeComments`, JSX preserved)
 * rather than a hand tokenizer. Round 2 showed why: the tokenizer was not
 * JSX-aware, so an apostrophe in JSX text ("Don't") opened a pseudo-string and
 * a comment after it survived — enough for a reverted sentence to hide behind
 * a comment that satisfied the assertion (mutation S1). The output is emitted
 * code: types are erased and formatting may be normalised, so assert on
 * identifiers and literals, not on exact whitespace.
 */
export function stripComments(src: string, fileName = 'source.tsx'): string {
  return ts.transpileModule(src, {
    fileName,
    compilerOptions: {
      removeComments: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText
}

/**
 * COPY IS PHRASES; IDENTIFIERS ARE SINGLE TOKENS.
 *
 * This is the discriminator, and it matters because `alpha` is a legitimate
 * identifier in real statistics here — `lib/portfolio/var.ts` uses it for a
 * significance level and `lib/portfolio/factorAttribution.ts` for a regression
 * intercept. Neither is a claim, and neither should be renamed to satisfy a
 * wording ban. A rendered phrase contains whitespace; `'alpha'` alone does not.
 *
 * The previous extractor was the whole defect: it took string literals plus JSX
 * text matched by `/>[^<>{}]{2,80}</`, which silently skipped
 *   - any JSX text longer than 80 characters (both sr-only table captions), and
 *   - any JSX text containing an interpolation (the factor-attribution label).
 * Its "positive control" asserted `BANNED.test('Alpha vs B&H')` — validating the
 * DECIDER while the VISITOR returned nothing. Green, and blind.
 */
export function renderedPhrases(source: string): string[] {
  const out: string[] = []

  // 1. String and template literals that contain whitespace.
  for (const m of source.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    const body = m[2]
    if (/\s/.test(body) && /[A-Za-z]/.test(body)) out.push(body)
  }

  // 2. JSX text nodes: any length, across newlines, interpolations removed.
  for (const m of source.matchAll(/>([^<]{2,400})</g)) {
    const text = m[1].replace(/\{[^{}]*\}/g, ' ')
    // Reject anything that reads as code rather than prose. Parentheses are
    // NOT rejected — prose uses them ("Alpha (daily):"), and excluding them was
    // how the factor-attribution label stayed invisible.
    // Reject only on STRUCTURAL code markers.
    //
    // Two earlier attempts each blinded the guard, and both looked sensible:
    //   - rejecting any text containing `;` hid a live disclaimer, because
    //     prose uses semicolons;
    //   - rejecting the WORD `return` hid essentially all of this product's
    //     copy, because it is a finance app and its UI says "annualised
    //     return" everywhere.
    // Every filter here shrinks what the guard visits, so prefer over-matching
    // and let the offender list be the judge.
    if (/=>|\)\s*;|={/.test(text)) continue
    // Type syntax, not prose: `Record<'alpha' | K, number>` puts an interface
    // body between angle brackets and it reads as a JSX text node otherwise.
    if (/\||\?:|\b(?:number|string|boolean|null|undefined|unknown|void)\b/.test(text)) continue
    if (!/[A-Za-z]{2,}/.test(text)) continue
    out.push(text)
  }
  return out
}
