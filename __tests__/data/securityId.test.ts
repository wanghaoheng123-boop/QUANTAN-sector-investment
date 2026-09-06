import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  canonicalSecurityId,
  dataFileNameFor,
  securityIdFromFileName,
  assertNoIdCollisions,
} from '@/lib/data/securityId'
// Plain .mjs: its only consumer is a Node verifier, and duplicating the
// arithmetic to satisfy a layering preference would put two copies of a
// statistical rule in the repo.
import { detectTickerHandover } from '../../scripts/lib/handoverDetect.mjs'
// Q110-D2: the universe is imported, not scraped out of source with a regex.
import { TICKERS } from '../../scripts/lib/universe.mjs'

const ROOT = join(__dirname, '../..')

describe('canonicalSecurityId — one security, one identity', () => {
  it('collapses the two vendor conventions for a share class', () => {
    // The live defect: the universe declares BRK-B, the fixture is BRK-B.json,
    // and availableTickers() reported BRK.B.
    expect(canonicalSecurityId('BRK-B')).toBe('BRK.B')
    expect(canonicalSecurityId('BRK.B')).toBe('BRK.B')
  })

  it('does NOT touch a hyphenated pair — BTC-USD is not a share class', () => {
    // The old blanket `replace(/-/g, '.')` turned this into BTC.USD, which is
    // not a security at all.
    expect(canonicalSecurityId('BTC-USD')).toBe('BTC-USD')
    expect(canonicalSecurityId('EUR-GBP')).toBe('EUR-GBP')
  })

  it('uppercases and trims', () => {
    expect(canonicalSecurityId('  brk-b ')).toBe('BRK.B')
  })

  it('passes the caret index form through', () => {
    expect(canonicalSecurityId('^VIX')).toBe('^VIX')
  })

  it('fails closed on input that cannot be an identity', () => {
    // Returning '' would propagate as a lookup key and silently miss.
    for (const bad of ['', '   ', '../etc/passwd', 'A B', 'A..B', 'A-B-C-D-E']) {
      expect(canonicalSecurityId(bad)).toBeNull()
    }
  })
})

describe('file-name encoding round-trips — the old pair did not', () => {
  it('BRK.B survives a full round trip', () => {
    const id = canonicalSecurityId('BRK-B')!
    expect(securityIdFromFileName(dataFileNameFor(id))).toBe(id)
  })

  it('BTC-USD survives a full round trip', () => {
    // Under the old mangle this became BTC.USD and never came back.
    const id = canonicalSecurityId('BTC-USD')!
    expect(dataFileNameFor(id)).toBe('BTC-USD')
    expect(securityIdFromFileName(dataFileNameFor(id))).toBe(id)
  })

  it('round-trips every fixture actually on disk', () => {
    // The property that matters is not that the rule is elegant but that it
    // holds for the real corpus.
    const { readdirSync, existsSync } = require('fs') as typeof import('fs')
    const dir = join(ROOT, 'scripts/backtestData')
    if (!existsSync(dir)) return
    const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    expect(names.length).toBeGreaterThan(20)
    for (const name of names) {
      const id = securityIdFromFileName(name)
      expect(id).not.toBeNull()
      expect(dataFileNameFor(id!)).toBe(name)
    }
  })
})

describe('assertNoIdCollisions — detects a REAL conflict, not a convention difference', () => {
  it('accepts the two conventions for the same security', () => {
    // BRK.B and BRK-B are one security written two ways. Flagging that would be
    // decoration — it is the merge the canonicaliser exists to perform.
    expect(() =>
      assertNoIdCollisions([
        { symbol: 'BRK.B', attribute: 'Financials' },
        { symbol: 'BRK-B', attribute: 'Financials' },
      ]),
    ).not.toThrow()
  })

  it('THROWS when one id carries conflicting attributes', () => {
    // This is the failure symbols alone cannot show: if the same id arrives as
    // two different sectors, one of them is not what we think it is.
    expect(() =>
      assertNoIdCollisions([
        { symbol: 'BRK-B', attribute: 'Financials' },
        { symbol: 'BRK.B', attribute: 'Technology' },
      ]),
    ).toThrow(/conflicting attributes/)
  })

  it('ignores entries with no attribute rather than guessing', () => {
    expect(() =>
      assertNoIdCollisions([{ symbol: 'BRK-B' }, { symbol: 'BRK.B', attribute: 'Financials' }]),
    ).not.toThrow()
  })

  it('the real universe has no conflicting attributes', () => {
    // Q110-D2 (2026-09-06) — this used to scrape the entries out of
    // `fetchBacktestData.mjs` with a REGEX over its source text. A regex over
    // source is not a reader of data: change how the array is written and the
    // match count silently drops to zero, the guard runs over an empty list,
    // and it passes. The `> 40` control was the only thing between that and a
    // vacuous green. The universe now lives in `scripts/lib/universe.mjs`,
    // which the fetch script and this test both IMPORT — a module cannot go
    // quietly empty the way a pattern match can.
    const entries = TICKERS.map((t) => ({ symbol: t.ticker, attribute: t.sector }))
    expect(entries.length).toBeGreaterThan(40) // reachability, kept deliberately
    expect(() => assertNoIdCollisions(entries)).not.toThrow()
  })

  it('the FIXTURES on disk collide with nothing in the universe either', () => {
    // The other half of Q110-D2, and the half that matters more: the universe
    // declares `BRK.B` while the file on disk is `BRK-B.json`, and a divergence
    // between those two is the exact defect class Q-080 existed to close. The
    // old test covered the declaration and never looked at the directory.
    const { readdirSync } = require('fs') as typeof import('fs')
    const dir = join(ROOT, 'scripts/backtestData')
    const fromDisk = readdirSync(dir)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => f.replace(/\.json$/, ''))
    expect(fromDisk.length).toBeGreaterThan(50) // reachability

    // Every fixture must resolve to an id, and every universe entry must have a
    // fixture — checked as SETS so a mismatch names the symbol rather than a count.
    const declared = new Set(TICKERS.map((t) => canonicalSecurityId(t.ticker)))
    const onDisk = new Set(fromDisk.map((f) => canonicalSecurityId(f)))
    expect([...declared].filter((id) => id != null && !onDisk.has(id))).toEqual([])

    // And the combined set must still carry one attribute per id: if a fixture
    // and a universe entry disagreed about the sector, THAT is a collision.
    const combined = [
      ...TICKERS.map((t) => ({ symbol: t.ticker, attribute: t.sector })),
      ...fromDisk.map((f) => {
        const meta = JSON.parse(readFileSync(join(dir, `${f}.json`), 'utf8'))
        return { symbol: f, attribute: meta.sector as string | undefined }
      }),
    ]
    expect(() => assertNoIdCollisions(combined)).not.toThrow()
  })
})

describe('detectTickerHandover — makes a reassignment visible', () => {
  it('is WIRED into verify-data-integrity, not merely exported', () => {
    // I6 named that verifier specifically as unable to detect a handover. An
    // exported detector with no caller would be the built-and-inert defect this
    // repo has found in five packages.
    const src = readFileSync(join(ROOT, 'scripts/verify-data-integrity.mjs'), 'utf8')
    expect(src).toMatch(/detectTickerHandover\(/)
  })

  const steady = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 7) * 2)
  const dates = Array.from({ length: 200 }, (_, i) => `2024-01-${String((i % 28) + 1).padStart(2, '0')}`)

  it('is silent on an ordinary series', () => {
    expect(detectTickerHandover(steady, dates)).toEqual([])
  })

  it('flags a reassignment-sized discontinuity', () => {
    // A ticker handed to a different issuer continues with no missing bars and
    // no malformed rows — verify-data-integrity sees nothing wrong. What it
    // leaves behind is a move far outside the series' own distribution.
    const spliced = [...steady.slice(0, 100), ...steady.slice(100).map((p) => p * 9)]
    const hits = detectTickerHandover(spliced, dates)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].gapRatio).toBeGreaterThan(5)
  })

  it('returns nothing for a series too short to have a distribution', () => {
    expect(detectTickerHandover([1, 2, 3], ['a', 'b', 'c'])).toEqual([])
  })

  it('does not divide by zero on a flat series', () => {
    expect(detectTickerHandover(new Array(50).fill(10), new Array(50).fill('d'))).toEqual([])
  })
})
