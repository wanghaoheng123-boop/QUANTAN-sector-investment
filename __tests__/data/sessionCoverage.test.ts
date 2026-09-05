/**
 * Q110-D1 — a one-day hole is invisible from inside a single series.
 *
 * `verify-data-integrity.mjs` fails on a calendar gap > 5 days between
 * consecutive bars. EQIX was missing 2026-07-31: Thursday 07-30 to Monday 08-03
 * is FOUR days, so the rule could not fire, and the fixture sat one bar short of
 * all 55 peers (1253 vs 1254) with every check green.
 *
 * These exercise the pure comparator over constructed universes, so the
 * behaviour is pinned independently of what the fixture directory happens to
 * contain — including the day EQIX is refetched and the real instance vanishes.
 */
import { describe, it, expect } from 'vitest'
import { findSessionHoles, DEFAULT_QUORUM } from '../../scripts/lib/sessionCoverage.mjs'

type Holes = { sessions: string[]; holes: Array<{ ticker: string; missing: string[] }> }
const universe = (spec: Record<string, string[]>) =>
  new Map(Object.entries(spec).map(([t, ds]) => [t, new Set(ds)]))

const FULL = ['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-03', '2026-08-04']

describe('findSessionHoles — the EQIX shape', () => {
  it('names the one session a single ticker is missing', () => {
    const u = universe({
      A: FULL, B: FULL, C: FULL, D: FULL, E: FULL, F: FULL, G: FULL, H: FULL, I: FULL,
      EQIX: FULL.filter((d) => d !== '2026-07-31'),
    })
    const { sessions, holes } = findSessionHoles(u) as Holes
    // Reachability: an empty consensus calendar makes every assertion vacuous.
    expect(sessions).toEqual(FULL)
    expect(holes).toEqual([{ ticker: 'EQIX', missing: ['2026-07-31'] }])
  })

  it('reports NOTHING when every ticker has every session', () => {
    const u = universe({ A: FULL, B: FULL, C: FULL, D: FULL, E: FULL })
    expect((findSessionHoles(u) as Holes).holes).toEqual([])
  })

  it('does not accuse a name that listed mid-window of having holes', () => {
    // The distinction that makes this usable: short history is not a hole. A
    // check that conflated them would warn on every recent listing and be
    // learned-ignored within a week.
    const u = universe({
      A: FULL, B: FULL, C: FULL, D: FULL, E: FULL, F: FULL, G: FULL, H: FULL, I: FULL,
      NEWCO: ['2026-08-03', '2026-08-04'],
    })
    expect((findSessionHoles(u) as Holes).holes).toEqual([])
  })

  it('still catches a hole INSIDE a short history', () => {
    // The other side of the same rule — the range restriction must not become a
    // blanket exemption for anything with less data.
    const u = universe({
      A: FULL, B: FULL, C: FULL, D: FULL, E: FULL, F: FULL, G: FULL, H: FULL, I: FULL,
      NEWCO: ['2026-07-30', '2026-08-03'],
    })
    expect((findSessionHoles(u) as Holes).holes).toEqual([
      { ticker: 'NEWCO', missing: ['2026-07-31'] },
    ])
  })

  it('a session only a minority trades is not part of the consensus calendar', () => {
    // A half-day, a vendor artefact, or one name's bad bar must not become a
    // session every other ticker is then reported as missing.
    const u = universe({
      A: FULL, B: FULL, C: FULL, D: FULL, E: FULL, F: FULL, G: FULL, H: FULL, I: FULL,
      ODD: [...FULL, '2026-08-01'],
    })
    const { sessions, holes } = findSessionHoles(u) as Holes
    expect(sessions).not.toContain('2026-08-01')
    expect(holes).toEqual([])
  })

  it('an empty universe is empty, not a division by zero', () => {
    expect(findSessionHoles(new Map())).toEqual({ sessions: [], holes: [] })
  })

  it('the quorum is a real parameter, not a decoration', () => {
    const u = universe({ A: FULL, B: FULL, C: FULL.filter((d) => d !== '2026-07-31') })
    // At 0.9, one of three missing it leaves 2/3 = 0.67 < 0.9 → not a session.
    expect((findSessionHoles(u, DEFAULT_QUORUM) as Holes).holes).toEqual([])
    // At 0.6 it clears quorum and C's hole is named.
    expect((findSessionHoles(u, 0.6) as Holes).holes).toEqual([
      { ticker: 'C', missing: ['2026-07-31'] },
    ])
  })
})

describe('findSessionHoles — the live fixture directory', () => {
  it('finds EQIX 2026-07-31, the instance this check was built for', () => {
    // The real instance, asserted. When EQIX is refetched this test must be
    // updated deliberately — a silently vanishing positive control is how a
    // guard goes quietly back to zero instances.
    const { readdirSync, readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const dir = join(__dirname, '../../scripts/backtestData')
    const byTicker = new Map<string, Set<string>>()
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      const ticker: string = d.ticker ?? f.replace('.json', '')
      if ((d.sector ?? '').toLowerCase() === 'crypto' || ticker.startsWith('BTC')) continue
      byTicker.set(
        ticker,
        new Set(
          (d.candles ?? []).map((r: { time: number }) =>
            new Date(r.time * 1000).toISOString().slice(0, 10),
          ),
        ),
      )
    }
    expect(byTicker.size).toBeGreaterThan(50) // reachability
    const { holes } = findSessionHoles(byTicker) as Holes
    expect(holes).toEqual([{ ticker: 'EQIX', missing: ['2026-07-31'] }])
  })
})
