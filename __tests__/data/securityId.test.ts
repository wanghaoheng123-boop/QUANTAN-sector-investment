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
    const src = readFileSync(join(ROOT, 'scripts/fetchBacktestData.mjs'), 'utf8')
    const entries = [...src.matchAll(/ticker:\s*'([^']+)'\s*,\s*sector:\s*'([^']+)'/g)].map((m) => ({
      symbol: m[1],
      attribute: m[2],
    }))
    expect(entries.length).toBeGreaterThan(40)
    expect(() => assertNoIdCollisions(entries)).not.toThrow()
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
