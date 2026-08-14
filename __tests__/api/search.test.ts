/**
 * Tests for GET /api/search — instrument discovery.
 *
 * Context (2026-08-15, DQ-8): yahoo-finance2 validates Yahoo's `search()`
 * response against its own JSON schema, and Yahoo's SearchResult shape drifts.
 * When it does, `search()` THROWS — the route catches it and returns a
 * well-formed `{"quotes":[]}` with HTTP 200, so a dead upstream is
 * indistinguishable from "no securities match your query". That is exactly the
 * property that let the news equivalent run for three months before 72f42fc
 * fixed the four news callers; this route was the one call site that commit did
 * not touch, and a prod probe on 2026-08-15 confirmed it was failing
 * (`/api/search?q=bank` → `{"quotes":[]}` while the guarded brief callers
 * returned live headlines).
 *
 * What's pinned here:
 *   • the route passes `{ validateResult: false }` as the third argument;
 *   • rows still map correctly through the untyped (unvalidated) result;
 *   • THE CLASS, not just the instance: every `search()` call site in `app/`
 *     carries the guard, so the next route to be added can't reintroduce it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

const { searchMock, quoteMock } = vi.hoisted(() => ({
  // Full arity (query, queryOptions, moduleOptions) so the call-args
  // assertions below stay type-safe.
  searchMock: vi.fn(async (
    _query: string,
    _queryOptions?: unknown,
    _moduleOptions?: unknown,
  ): Promise<unknown> => ({ quotes: [] })),
  quoteMock: vi.fn(async (_symbol: unknown): Promise<unknown> => null),
}))

vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    search = searchMock
    quote = quoteMock
  },
}))

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}))

import { GET } from '@/app/api/search/route'

function request(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'))
}

describe('GET /api/search — Yahoo schema-drift tolerance (DQ-8)', () => {
  beforeEach(() => {
    searchMock.mockReset()
    searchMock.mockResolvedValue({ quotes: [] })
    quoteMock.mockReset()
    quoteMock.mockResolvedValue(null)
  })

  it('THE GUARD: passes { validateResult: false } to yahooFinance.search', async () => {
    await GET(request('http://localhost:3000/api/search?q=bank%20of'))
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith(
      'bank of',
      { newsCount: 0, quotesCount: 40 },
      { validateResult: false },
    )
  })

  it('honours the limit parameter in the query options', async () => {
    await GET(request('http://localhost:3000/api/search?q=bank%20of&limit=5'))
    expect(searchMock).toHaveBeenCalledWith(
      'bank of',
      { newsCount: 0, quotesCount: 5 },
      { validateResult: false },
    )
  })

  it('maps rows out of the UNVALIDATED result (the shape the guard lets through)', async () => {
    searchMock.mockResolvedValue({
      quotes: [
        {
          symbol: 'BAC',
          shortname: 'Bank of America Corporation',
          exchDisp: 'NYSE',
          quoteType: 'EQUITY',
          typeDisp: 'equity',
          // Fields yahoo-finance2's schema requires but a drifted payload may
          // omit entirely — the route must not care.
        },
        // Non-Yahoo (Crunchbase) row: dropped.
        { symbol: 'PRIVATECO', isYahooFinance: false },
        // Option row: dropped (EXCLUDED_QUOTE_TYPES).
        { symbol: 'BAC260116C00040000', quoteType: 'OPTION' },
        // Junk rows: dropped without throwing.
        null,
        { noSymbol: true },
      ],
    })

    const res = await GET(request('http://localhost:3000/api/search?q=bank%20of'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotes).toEqual([
      { symbol: 'BAC', shortname: 'Bank of America Corporation', exchange: 'NYSE', typeDisp: 'equity' },
    ])
  })

  it('still degrades to an empty list (not a 500) when search throws', async () => {
    searchMock.mockRejectedValue(new Error('result did not validate with schema: #/definitions/SearchResult'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await GET(request('http://localhost:3000/api/search?q=bank%20of'))
      expect(res.status).toBe(200)
      expect((await res.json()).quotes).toEqual([])
    } finally {
      err.mockRestore()
    }
  })
})

/** Every .ts file under a directory, recursively. */
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) tsFiles(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Blank out comments (block comments and whole-line `//` comments), preserving
 * length and newlines so offsets/line numbers still point at the real source.
 * Without this the scan trips over the routes' own prose — several file headers
 * describe the fetch as "via `yf.search()`".
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/[^\n]*/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length))
}

/**
 * Slice out the balanced `(...)` argument list that starts at `openIdx`
 * (the index OF the `(`). Good enough for real call sites — the arguments in
 * this repo contain no parenthesised string literals.
 */
function callArgs(src: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  return src.slice(openIdx)
}

describe('THE CLASS: every Yahoo search() call site is schema-drift tolerant', () => {
  it('no `search()` call in app/ omits validateResult:false', () => {
    const offenders: string[] = []
    const repoRoot = join(__dirname, '..', '..')
    for (const file of tsFiles(join(repoRoot, 'app'))) {
      const src = stripComments(readFileSync(file, 'utf8'))
      // Both spellings used in the repo: `yahooFinance.search(` and `yf.search(`.
      const re = /\b(?:yahooFinance|yf)\.search\s*\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const open = m.index + m[0].length - 1
        if (!/validateResult\s*:\s*false/.test(callArgs(src, open))) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${file.slice(repoRoot.length + 1)}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the scan actually finds call sites (guards against a vacuous pass)', () => {
    const repoRoot = join(__dirname, '..', '..')
    let sites = 0
    for (const file of tsFiles(join(repoRoot, 'app'))) {
      sites += (stripComments(readFileSync(file, 'utf8')).match(/\b(?:yahooFinance|yf)\.search\s*\(/g) ?? []).length
    }
    // 4 news callers (72f42fc) + /api/search (DQ-8).
    expect(sites).toBeGreaterThanOrEqual(5)
  })
})
