/**
 * Anti-recurrence guard for UX-26 — the SSR self-fetch class.
 *
 * The outage was not a logic bug inside the brief builder. It was a shape: a
 * server component asking its own deployment for data over HTTP. That hop can
 * fail for reasons entirely outside the app's code (deployment protection, an
 * auth redirect, `VERCEL_URL` resolving to the deployment host rather than the
 * production alias, the app tripping its own per-IP rate limiter) while the
 * route being fetched answers 200 to everyone else — which is exactly how
 * /briefs came to render "All Yahoo Finance requests failed" on 2026-08-15 with
 * a healthy API behind it.
 *
 * A unit test of the builder cannot catch that. A source scan can: these tests
 * assert the SHAPE is absent, so the next page that reintroduces it fails here
 * instead of in production.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROOT = join(__dirname, '..', '..')

/** Every .ts/.tsx file under a directory, recursively. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Blank out comments (block comments and whole-line `//` comments), preserving
 * length and newlines so line numbers still point at real source. Both briefs
 * pages carry long header comments that quote the removed `fetch(...)` call —
 * without this the scan would trip over its own postmortem.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/[^\n]*/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length))
}

const BRIEFS_PAGES = [
  'app/briefs/page.tsx',
  'app/briefs/sector/[sector]/page.tsx',
]

describe('the briefs pages read data in-process, not over HTTP (UX-26)', () => {
  it.each(BRIEFS_PAGES)('%s makes no fetch() call', (rel) => {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    expect(src).not.toMatch(/\bfetch\s*\(/)
  })

  it.each(BRIEFS_PAGES)('%s does not resolve its own origin', (rel) => {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    expect(src).not.toMatch(/appBaseUrl|apiBase|NEXT_PUBLIC_APP_URL|VERCEL_URL/)
  })

  it.each(BRIEFS_PAGES)('%s imports the shared builder instead', (rel) => {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    expect(src).toMatch(/from '@\/lib\/briefs\/sectorBrief'/)
  })

  it('the route handler and the pages share ONE builder', () => {
    const route = stripComments(readFileSync(join(ROOT, 'app/api/briefs/[sector]/route.ts'), 'utf8'))
    expect(route).toMatch(/from '@\/lib\/briefs\/sectorBrief'/)
    // The route is a wrapper now: no Yahoo client of its own.
    expect(route).not.toMatch(/yahoo-finance2/)
  })
})

describe('THE CLASS: no server component resolves its own origin to fetch itself', () => {
  it('no page.tsx or layout.tsx under app/ references appBaseUrl', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(ROOT, 'app'))) {
      if (!/(?:page|layout)\.tsx$/.test(file)) continue
      const src = stripComments(readFileSync(file, 'utf8'))
      if (/\bappBaseUrl\s*\(/.test(src)) offenders.push(file.slice(ROOT.length + 1))
    }
    expect(offenders).toEqual([])
  })

  it('the scan actually walks the route tree (guards against a vacuous pass)', () => {
    const pages = sourceFiles(join(ROOT, 'app')).filter(f => /(?:page|layout)\.tsx$/.test(f))
    expect(pages.length).toBeGreaterThanOrEqual(15)
    for (const rel of BRIEFS_PAGES) {
      expect(pages.some(p => p.endsWith(rel.split('/').join(sep)))).toBe(true)
    }
  })
})

describe('the moved Yahoo search() call site keeps its schema-drift guard', () => {
  it('every search() call under lib/ passes validateResult:false', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(ROOT, 'lib'))) {
      const src = stripComments(readFileSync(file, 'utf8'))
      const re = /\b(?:yahooFinance|yf)\.search\s*\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        // Balanced slice of the argument list starting at the '('.
        const open = m.index + m[0].length - 1
        let depth = 0
        let args = src.slice(open)
        for (let i = open; i < src.length; i++) {
          if (src[i] === '(') depth++
          else if (src[i] === ')') {
            depth--
            if (depth === 0) { args = src.slice(open, i + 1); break }
          }
        }
        if (!/validateResult\s*:\s*false/.test(args)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('finds the brief builder call site (guards against a vacuous pass)', () => {
    const src = stripComments(readFileSync(join(ROOT, 'lib/briefs/sectorBrief.ts'), 'utf8'))
    expect(src).toMatch(/\byf\.search\s*\(/)
  })
})
