import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Q-109 — the globally-mounted compliance banner asserted that the product is
 * not regulated under "MiFID II, SEC RIA, or equivalent regimes": a regulatory
 * SELF-CLASSIFICATION naming two regimes that do not govern and omitting MAS,
 * which does.
 *
 * The fix was to name NO regime, and the danger this guard exists for is the
 * obvious "correction" — rewriting it as "not regulated under MAS", which is
 * the same error pointed at the regulator that actually applies. Whether the
 * FAA/SFA line is crossed is a legal question for the owner (Q-083).
 *
 * COMMENTS ARE STRIPPED FIRST. The comment in ComplianceBanner.tsx that
 * explains all this necessarily names MiFID II and MAS, and a naive matcher
 * would flag the explanation of the fix as the defect — which is exactly what
 * happened to ui-copy-promises.test.ts v1 and cache-flag-consumed.test.ts v1.
 * The control below proves stripping does not also blind it to rendered copy.
 */

const ROOTS = ['components', 'app']
const SKIP = new Set(['node_modules', '.next', '__tests__', 'claude'])

/** Regime names that would constitute a self-classification if RENDERED. */
const REGIMES = [
  'MiFID', 'SEC RIA', 'FINRA', 'FCA', 'ESMA',
  'MAS', 'FAA', 'SFA', 'Securities and Futures Act', 'Financial Advisers Act',
]

export function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, '')             // block comments
    .replace(/^[ \t]*\/\/.*$/gm, '')              // line comments
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(r))
const BANNER = join('components', 'ComplianceBanner.tsx')

describe('Q-109 — user-visible copy names no regulatory regime', () => {
  it('visits the banner it was written for', () => {
    // Reachability: a scan that never reaches ComplianceBanner.tsx would pass
    // the next assertion for the wrong reason.
    expect(files).toContain(BANNER)
    expect(files.length).toBeGreaterThan(40)
  })

  it('no rendered copy claims which regimes do or do not govern the product', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const r of REGIMES) {
        if (new RegExp(`\\b${r}\\b`).test(src)) offenders.push(`${f} -> ${r}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the banner still makes the claims that ARE verifiable', () => {
    // STRIPPED, not raw. The file's explanatory comment quotes these same
    // phrases, so reading raw source let a mutation that deleted the RENDERED
    // copy still pass — the comment satisfied the assertion. Caught by
    // mutation, in the very test written to strip comments.
    const src = stripComments(readFileSync(BANNER, 'utf8'))
    expect(src).toMatch(/does not route or execute orders/)
    expect(src).toMatch(/does not hold customer funds/)
    expect(src).toMatch(/Not investment advice/)
  })

  it('does not reassert a blanket "all data is delayed" claim', () => {
    // False since the crypto order-book feeds stream browser-direct:
    // components/crypto/hooks/useBtcPriceWs.ts and useBtcKlineWs.ts.
    const src = stripComments(readFileSync(BANNER, 'utf8'))
    expect(src).not.toMatch(/Market data is delayed or aggregated/)
  })

  it('POSITIVE CONTROL: stripping comments does not blind it to rendered copy', () => {
    // The whole risk of the pre-processor is that it hides the real thing too.
    expect(stripComments('<p>not regulated under MiFID II</p>')).toMatch(/MiFID/)
    expect(stripComments('{/* explains MiFID II */}<p>ok</p>')).not.toMatch(/MiFID/)
    expect(stripComments('// mentions MAS\n<p>ok</p>')).not.toMatch(/MAS/)
    expect(stripComments('/* block naming SFA */<p>ok</p>')).not.toMatch(/SFA/)
  })
})
