import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatFreshness } from '@/lib/format'
import { LIVE_MAX_SEC, RECENT_MAX_SEC } from '@/lib/data/freshness'

/**
 * Q-114 — `formatFreshness` was a SECOND, independent age-to-label mapping.
 * It called anything under 30s "live" where `classifyFreshness` says 10, and
 * knew nothing about caching, vendor delay or the market session. The same
 * datum could read "live" from one and "Stale" from the other three inches
 * away on the same page.
 *
 * Criterion 4 of the ticket is this file: a test that fails if a second
 * mapping is reintroduced. It guards BEHAVIOUR (the boundaries agree) and
 * STRUCTURE (nothing else invents its own thresholds).
 */

const SSOT = join('lib', 'data', 'freshness.ts')
const DELEGATE = join('lib', 'format.ts')
const ROOTS = ['lib', 'components', 'app', 'hooks']
const SKIP = new Set(['node_modules', '.next', '__tests__', 'claude', 'backtestData'])

function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(r))
const NOW = Date.UTC(2026, 5, 10, 15, 0, 0)          // a Wednesday, inside the US session
const at = (ageSec: number, opts = {}) =>
  formatFreshness(new Date(NOW - ageSec * 1000).toISOString(), { now: NOW, ...opts })

describe('Q-114 — one freshness vocabulary', () => {
  it('visits the modules it governs', () => {
    expect(files).toContain(SSOT)
    expect(files).toContain(DELEGATE)
    expect(files.length).toBeGreaterThan(80)
  })

  it('the LIVE boundary is the classifier\'s, not a second one', () => {
    // The whole defect in one assertion: this used to say "live" at 29s.
    expect(at(LIVE_MAX_SEC - 1, { stamp: 'vendor' })).toBe('live')
    expect(at(LIVE_MAX_SEC + 1, { stamp: 'vendor' })).not.toBe('live')
    expect(at(29, { stamp: 'vendor' })).not.toBe('live')
  })

  it('knows about caching, vendor delay and the market session', () => {
    expect(at(2, { stamp: 'vendor', cached: true })).toMatch(/^cached/)
    expect(at(2, { stamp: 'vendor', delayedMinutes: 15 })).toBe('delayed 15m')
    // Outside the session a recent-enough stamp is "at close", not an alarm.
    const sunday = Date.UTC(2026, 5, 14, 15, 0, 0)
    expect(formatFreshness(new Date(sunday - 3600_000).toISOString(),
      { now: sunday, stamp: 'vendor', calendar: 'us-equity' })).toBe('at close')
  })

  it('never claims "live" for OUR OWN clock', () => {
    // fetchedAt/computedAt measure when WE pulled or computed. Calling that
    // "live" describes our clock and claims the vendor's — the Q-101 defect.
    expect(at(1, { stamp: 'ours' })).toBe('just now')
    expect(at(1)).toBe('just now')          // and 'ours' is the DEFAULT
    expect(at(1, { stamp: 'vendor' })).toBe('live')
  })

  it('a missing or unparseable timestamp is "—", never an age claim', () => {
    expect(formatFreshness(null)).toBe('—')
    expect(formatFreshness(undefined)).toBe('—')
    expect(formatFreshness('not-a-date')).toBe('—')
  })

  it('formatFreshness DELEGATES rather than deciding', () => {
    const src = stripComments(readFileSync(DELEGATE, 'utf8'))
    expect(src).toMatch(/classifyFreshness\(/)
    // and does not carry its own thresholds
    expect(src).not.toMatch(/deltaSec\s*<\s*\d+/)
  })

  it('no other module invents its own age-to-label mapping', () => {
    const VOCAB = /(['"`])(live|stale|at close|just now)\1/i
    const AGE = /(Date\.now\(\)\s*-|now\s*-\s*\w*[Tt]ime)/
    const offenders = files
      .filter((f) => f !== SSOT && f !== DELEGATE)
      .filter((f) => {
        const src = stripComments(readFileSync(f, 'utf8'))
        return VOCAB.test(src) && AGE.test(src)
      })
    expect(offenders).toEqual([])
  })

  it('the threshold constants live in exactly one module', () => {
    const owners = files.filter((f) => /\b(LIVE_MAX_SEC|RECENT_MAX_SEC)\s*=/.test(stripComments(readFileSync(f, 'utf8'))))
    expect(owners).toEqual([SSOT])
    expect(LIVE_MAX_SEC).toBeLessThan(RECENT_MAX_SEC)
  })

  it('POSITIVE CONTROL: the detectors can fire', () => {
    const VOCAB = /(['"`])(live|stale|at close|just now)\1/i
    const AGE = /(Date\.now\(\)\s*-|now\s*-\s*\w*[Tt]ime)/
    const rogue = `const d = Date.now() - ts; if (d < 30) return 'live'`
    expect(VOCAB.test(rogue) && AGE.test(rogue)).toBe(true)
    expect(stripComments(`// if (d < 30) return 'live'`)).not.toMatch(VOCAB)
  })
})
