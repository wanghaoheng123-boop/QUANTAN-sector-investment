/**
 * Q-144 (re-gate R2-1) — the recorded way out of a quarantine.
 *
 * A refused bar had no exit: the fixture kept its value, every later refresh
 * disagreed with it again, and the instrument froze while the weekly run went
 * red (BTC for nine weeks; CAT from 2026-10-18, on a volume-only revision of
 * +21.84%). A reviewed row in scripts/lib/acceptedRevisions.json lets the next
 * run adopt the vendor's bar — a volume revision only, within a bounded band,
 * for one fixture version, until the row expires. This is a second exemption
 * path into the guard Q144-R2-2 just closed, so every way it could widen has a
 * refusing case here, including the ones the exit-path review
 * (reviews/q144-exit-path-data-integrity-2026-10-24.md, E-1, E-2, E-5) found.
 *
 * Bars are synthetic; the relative sizes are the measured ones.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DAY_SECONDS, assessRefresh, keyDate } from '../../scripts/lib/dataVintage.mjs'
import { planSave } from '../../scripts/lib/planSave.mjs'
import {
  MAX_BAND_WIDTH,
  MAX_ROW_LIFETIME_DAYS,
  loadRecordedRevisions,
  recordedRevisionProblem,
} from '../../scripts/lib/recordedRevisions.mjs'

const FILE = join(__dirname, '../../scripts/lib/acceptedRevisions.json')
const committed = JSON.parse(readFileSync(FILE, 'utf8')) as { about: string; rows: Array<Record<string, unknown>> }

describe('the committed acceptances file', () => {
  it('is well formed, row by row, and holds the CAT row (a named member, so an emptied file fails)', () => {
    expect(Array.isArray(committed.rows)).toBe(true)
    for (const row of committed.rows) expect(recordedRevisionProblem(row), JSON.stringify(row)).toBeNull()
    const cat = committed.rows.find((r) => r.ticker === 'CAT' && r.date === '2026-10-09')
    expect(cat).toMatchObject({ fixtureFetchedAt: '2026-10-12T00:57:59.894Z', changes: { volume: [0.2, 0.24] }, decision: 'adopt', expires: '2026-11-08' })
    expect(String(cat?.decidedBy)).toMatch(/^Owner/)
  })

  it('has at most one row per ticker and bar date', () => {
    const keys = committed.rows.map((r) => `${r.ticker}|${r.date}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('holds no vendor values: every number in it is a relative bound in [-1, 10] (I8)', () => {
    const numbers: number[] = []
    const walk = (v: unknown) => {
      if (typeof v === 'number') numbers.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(committed)
    expect(numbers.length).toBeGreaterThan(0)
    for (const n of numbers) expect(n >= -1 && n <= 10, String(n)).toBe(true)
  })
})

describe('recordedRevisionProblem refuses every malformed or over-broad row', () => {
  const good = {
    ticker: 'CAT', date: '2026-10-09', fixtureFetchedAt: '2026-10-12T00:57:59.894Z', changes: { volume: [0.2, 0.24] },
    decision: 'adopt', reason: 'a reason long enough', evidence: 'evidence long enough', decidedAt: '2026-10-24', decidedBy: 'someone accountable',
    expires: '2026-11-08',
  }
  it('accepts the well-formed row, and a band exactly MAX_BAND_WIDTH wide', () => {
    expect(recordedRevisionProblem(good)).toBeNull()
    expect(MAX_BAND_WIDTH).toBe(0.05)
    expect(recordedRevisionProblem({ ...good, changes: { volume: [0.2, 0.25] } })).toBeNull()
    expect(recordedRevisionProblem({ ...good, changes: { volume: [0.5, 0.55] } })).toBeNull() // 0.050000000000000044 in floating point
  })
  it.each([
    ['an interval that includes 0', { changes: { volume: [-0.1, 0.24] } }],
    ['an interval that touches 0 from above', { changes: { volume: [0, 0.04] } }],
    ['an interval that touches 0 from below', { changes: { volume: [-0.04, 0] } }],
    ['an interval with low above high', { changes: { volume: [0.24, 0.2] } }],
    ['a band wider than MAX_BAND_WIDTH (E-2)', { changes: { volume: [0.2, 0.2501] } }],
    ['the review\'s [1e-6, 10] band (E-2)', { changes: { volume: [1e-6, 10] } }],
    ['a price field (E-2: no price exit has been designed)', { changes: { close: [0.5, 0.52] } }],
    ['a price field beside volume', { changes: { volume: [0.2, 0.24], close: [0.01, 0.02] } }],
    ['a field that is not a bar field', { changes: { dividend: [0.2, 0.24] } }],
    ['no fields', { changes: {} }],
    ['a bound that is not a number', { changes: { volume: [0.2, '0.24'] } }],
    ['a change below -100%', { changes: { volume: [-1.02, -1.0] } }],
    ['a date that is not YYYY-MM-DD', { date: '2026-10-9' }],
    ['a fetchedAt that is not an ISO timestamp', { fixtureFetchedAt: '2026-10-12' }],
    ['a decision other than adopt', { decision: 'keep' }],
    ['an empty reason', { reason: '' }],
    ['a lowercase ticker', { ticker: 'cat' }],
    ['an expiry on the day it was decided', { expires: '2026-10-24' }],
    ['an expiry before it was decided', { expires: '2026-10-01' }],
    [`an expiry more than ${MAX_ROW_LIFETIME_DAYS} days out`, { expires: '2026-11-25' }],
    ['an expiry that is not a date', { expires: 'never' }],
    ['an extra key (somewhere to put a vendor value)', { was: 1 }],
  ])('%s', (_name, patch) => {
    expect(recordedRevisionProblem({ ...good, ...patch })).not.toBeNull()
  })
  it('a missing key, and an inherited one', () => {
    const { expires: _e, ...noExpiry } = good
    expect(recordedRevisionProblem(noExpiry)).not.toBeNull()
    expect(recordedRevisionProblem(Object.create(good))).not.toBeNull()
    // Ten own keys (one bogus) with the required `expires` only on the prototype.
    const padded = Object.assign(Object.create({ expires: '2026-11-08' }), { ...noExpiry, bogus: 'x' })
    expect(recordedRevisionProblem(padded)).not.toBeNull()
  })
})

describe('planSave adopts a revision only when it is exactly the one recorded', () => {
  const DAY = DAY_SECONDS
  const OPEN = 13.5 * 3_600
  // 300 equity sessions at the 13:30 UTC open; the tail is 2026-10-09.
  const TAIL = Date.parse('2026-10-09T00:00:00Z') / 1000 + OPEN
  const series = (n = 300) =>
    Array.from({ length: n }, (_, i) => ({ time: TAIL - (n - 1 - i) * DAY, open: 100, high: 102, low: 98, close: 101, volume: 1_000_000 }))
  const FETCHED = '2026-10-12T00:57:59.894Z'
  const NOW = Date.parse('2026-10-25T23:30:00Z')
  const AFTER_EXPIRY = Date.parse('2026-11-08T00:00:00Z')
  const row = {
    ticker: 'CAT', date: '2026-10-09', fixtureFetchedAt: FETCHED, changes: { volume: [0.2, 0.24] },
    decision: 'adopt', reason: 'a reason long enough', evidence: 'evidence long enough', decidedAt: '2026-10-24', decidedBy: 'someone accountable',
    expires: '2026-11-08',
  }
  /** The vendor's view: the stored tail with its volume revised by `pct`, then `appended` new sessions. */
  const vendor = (pct: number, patch: Record<string, number> = {}, appended = 0) => {
    const s = series()
    s[299] = { ...s[299], volume: s[299].volume * (1 + pct), ...patch }
    for (let i = 1; i <= appended; i++) s.push({ ...series()[299], time: TAIL + i * DAY })
    return s
  }
  const run = (candles: ReturnType<typeof series>, acceptances: unknown[] = [row], prev: unknown = { candles: series(), fetchedAt: FETCHED }, ticker = 'CAT', nowMs = NOW) =>
    planSave({ ticker, sector: 'Industrials', prev, candles, nowMs, acceptances })

  it('without a row, the CAT shape is refused — the quarantine this exists to end', () => {
    const r = run(vendor(0.2184), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('2026-10-09 volume moved up to 2.2e-1')
  })

  it('with the row, the vendor bar is adopted, counted, recorded in the fixture and noticed with the measured change', () => {
    const r = run(vendor(0.2184, {}, 3))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.vintage).toEqual({ appended: 3, restated: 1, missing: 0, finalized: 0, superseded: 0, accepted: 1 })
    expect(r.doc.candles[299].volume).toBeCloseTo(1_218_400, 6)
    expect(r.doc.adoptedRevisions).toEqual([
      { date: '2026-10-09', fields: ['volume'], relativeChange: { volume: 0.2184 }, decidedAt: '2026-10-24', adoptedAt: '2026-10-25T23:30:00.000Z' },
    ])
    const notice = r.log.find((l) => l.includes('recorded revision adopted'))
    expect(notice).toBe('::notice title=CAT recorded revision adopted::2026-10-09 volume +21.84% (band [0.2, 0.24]), adopted under the row decided 2026-10-24')
    expect(r.log.join('\n')).toContain('[CAT] +3 new bar(s), 1 restated (adopted under a recorded acceptance)')
    expect(r.log.join('\n')).not.toMatch(/1218400|1000000/)
  })

  it('an adoption with no new bar still prints its summary line', () => {
    const r = run(vendor(0.2184))
    expect(r.ok && r.log).toContain('[CAT] +0 new bar(s), 1 restated (adopted under a recorded acceptance)')
  })

  it('the band ends are inclusive', () => {
    expect(run(vendor(0.2)).ok).toBe(true)
    expect(run(vendor(0.24)).ok).toBe(true)
  })

  it('going forward it fires once: the next write has a new fetchedAt, so a further revision is refused; the adoption record is carried', () => {
    const first = run(vendor(0.2184))
    if (!first.ok) throw new Error(first.reason)
    expect(first.doc.fetchedAt).not.toBe(FETCHED)
    const later = NOW + 7 * DAY * 1000
    const again = planSave({
      ticker: 'CAT', sector: 'Industrials', prev: first.doc, nowMs: later, acceptances: [row],
      candles: first.doc.candles.map((c, i) => (i === 299 ? { ...c, volume: c.volume * 1.21 } : c)),
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toContain('exists but does not match this fixture version and revision')
    const clean = planSave({ ticker: 'CAT', sector: 'Industrials', prev: first.doc, candles: first.doc.candles, nowMs: later, acceptances: [row] })
    expect(clean.ok).toBe(true)
    if (!clean.ok) return
    expect(clean.doc.vintage).toMatchObject({ restated: 0, accepted: 0 })
    expect(clean.doc.adoptedRevisions).toEqual(first.doc.adoptedRevisions)
  })

  it('a revert restores the fixture version, so the row fires again until it expires (E-1) — reversing needs the row deleted too', () => {
    expect(run(vendor(0.2184), [row], { candles: series(), fetchedAt: FETCHED }, 'CAT', NOW + 7 * DAY * 1000).ok).toBe(true)
    const expired = run(vendor(0.2184), [row], { candles: series(), fetchedAt: FETCHED }, 'CAT', AFTER_EXPIRY)
    expect(expired.ok).toBe(false)
    if (!expired.ok) expect(expired.reason).toContain('A recorded row for CAT has expired and was ignored.')
    expect(run(vendor(0.2184), [], { candles: series(), fetchedAt: FETCHED }, 'CAT', NOW + 7 * DAY * 1000).ok).toBe(false)
  })

  it('a malformed row is named as malformed, not as a mismatch', () => {
    const r = run(vendor(0.2184), [{ ...row, changes: { volume: [-0.5, 0.5] } }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('A recorded row for CAT is malformed and was ignored (changes.volume: the interval must exclude 0')
  })

  it('two disk bars on one UTC date cannot both be covered by one row', () => {
    const disk = series()
    const twin = { ...disk[299], time: disk[299].time + 3_600 }
    const r = run([...vendor(0.2184), { ...twin, volume: twin.volume * 1.2184 }], [row], { candles: [...disk, twin], fetchedAt: FETCHED })
    expect(r.ok).toBe(false)
  })

  it.each([
    ['the reversal (a revision DOWN)', () => run(vendor(-0.18))],
    ['a revision outside the bound', () => run(vendor(0.3))],
    ['a revision just below the bound', () => run(vendor(0.199))],
    ['a revision just above the bound', () => run(vendor(0.2401))],
    ['a price field moved on the same bar', () => run(vendor(0.2184, { close: 101.1 }))],
    ['a second restated bar on the same ticker', () => run(vendor(0.2184).map((c, i) => (i === 100 ? { ...c, close: 101.5 } : c)))],
    ['history loss alongside', () => run(vendor(0.2184).slice(1))],
    ['another ticker', () => run(vendor(0.2184), [row], { candles: series(), fetchedAt: FETCHED }, 'HON')],
    ['a different fixture version on disk', () => run(vendor(0.2184), [row], { candles: series(), fetchedAt: '2026-10-19T00:00:00.000Z' })],
    ['a row for another date', () => run(vendor(0.2184), [{ ...row, date: '2026-10-08' }])],
    ['a row naming a price field', () => run(vendor(0.2184), [{ ...row, changes: { volume: [0.2, 0.24], close: [0.01, 0.02] } }])],
    ['an expired row', () => run(vendor(0.2184), [row], { candles: series(), fetchedAt: FETCHED }, 'CAT', AFTER_EXPIRY)],
    ['acceptances that are not an array', () => run(vendor(0.2184), 'x' as unknown as unknown[])],
  ])('refuses %s', (_name, attempt) => {
    expect(attempt().ok).toBe(false)
  })

  it('a missing acceptances list is no acceptance, never a pass', () => {
    const r = planSave({ ticker: 'CAT', sector: 'Industrials', prev: { candles: series(), fetchedAt: FETCHED }, candles: vendor(0.2184), nowMs: NOW })
    expect(r.ok).toBe(false)
  })

  it('the restated bars assessRefresh returns carry no raw vendor values (E-6, I8)', () => {
    const v = assessRefresh(series(), vendor(0.2184), { existingFetchedAt: FETCHED })
    expect(v.restatedBars).toHaveLength(1)
    expect(Object.keys(v.restatedBars[0]).sort()).toEqual(['fields', 'key', 'maxRelativeChange', 'signedChanges'])
    expect(JSON.stringify(v)).not.toMatch(/"was"|"now"|1000000|1218400/)
  })

  it('the bar dates line up with the recorded date', () => {
    expect(keyDate(String(series()[299].time))).toBe('2026-10-09')
  })
})

describe('loadRecordedRevisions: an unreadable file is no rows and a warning, never a throw (E-5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'q144-rows-'))
  const write = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text); return p }
  const load = (file: string) => {
    const warnings: string[] = []
    return { rows: loadRecordedRevisions(file, (m: string) => warnings.push(m)), warnings }
  }

  it('reads the rows of a valid file without warning', () => {
    const r = load(FILE)
    expect(r.rows.length).toBe(committed.rows.length)
    expect(r.warnings).toEqual([])
  })

  it.each([
    ['truncated JSON', '{"rows": [ {"ticker": "CAT"'],
    ['null', 'null'],
    ['rows that are not an array', '{"rows": {"ticker": "CAT"}}'],
    ['a misspelled key', '{"row": []}'],
  ])('%s', (name, text) => {
    const r = load(write(`${name}.json`, text))
    expect(r.rows).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/^::warning title=Recorded revisions unreadable::.*no revision will be adopted this run$/)
  })

  it('a missing file', () => {
    const r = load(join(dir, 'absent.json'))
    expect(r.rows).toEqual([])
    expect(r.warnings).toHaveLength(1)
  })
})

describe('the fetch script loads the file through the tested loader and passes it to planSave', () => {
  const src = readFileSync(join(__dirname, '../../scripts/fetchBacktestData.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  it('passes ACCEPTED_REVISIONS, loaded from scripts/lib/acceptedRevisions.json', () => {
    expect(src).toMatch(/planSave\(\{ ticker, sector, prev, candles, nowMs: Date\.now\(\), acceptances: ACCEPTED_REVISIONS \}\)/)
    expect(src).toMatch(/const ACCEPTED_REVISIONS = loadRecordedRevisions\(path\.resolve\(__dirname, 'lib', 'acceptedRevisions\.json'\)\)/)
  })
})
