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
