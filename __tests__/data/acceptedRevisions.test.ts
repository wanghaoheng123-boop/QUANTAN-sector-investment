/**
 * Q-144 (re-gate R2-1) — the recorded way out of a quarantine.
 *
 * A refused bar had no exit: the fixture kept its value, every later refresh
 * disagreed with it again, and the instrument froze while the weekly run went
 * red (BTC for nine weeks; CAT from 2026-10-18, on a volume-only revision of
 * +21.84%). A reviewed row in scripts/lib/acceptedRevisions.json now lets the
 * next run adopt the vendor's bar — once, and only for the exact revision that
 * was reviewed. This is a second exemption path into the guard Q144-R2-2 just
 * closed, so every way it could widen has a refusing case here.
 *
 * Bars are synthetic; the relative sizes are the measured ones.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DAY_SECONDS, keyDate } from '../../scripts/lib/dataVintage.mjs'
import { planSave, recordedRevisionProblem } from '../../scripts/lib/planSave.mjs'

const FILE = join(__dirname, '../../scripts/lib/acceptedRevisions.json')
const committed = JSON.parse(readFileSync(FILE, 'utf8')) as { about: string; rows: Array<Record<string, unknown>> }

describe('the committed acceptances file', () => {
  it('is well formed, row by row, and holds the CAT row (a named member, so an emptied file fails)', () => {
    expect(Array.isArray(committed.rows)).toBe(true)
    for (const row of committed.rows) expect(recordedRevisionProblem(row), JSON.stringify(row)).toBeNull()
    const cat = committed.rows.find((r) => r.ticker === 'CAT' && r.date === '2026-10-09')
    expect(cat).toMatchObject({ fixtureFetchedAt: '2026-10-12T00:57:59.894Z', changes: { volume: [0.2, 0.24] }, decision: 'adopt' })
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

describe('recordedRevisionProblem refuses every malformed row', () => {
  const good = {
    ticker: 'CAT', date: '2026-10-09', fixtureFetchedAt: '2026-10-12T00:57:59.894Z', changes: { volume: [0.2, 0.24] },
    decision: 'adopt', reason: 'a reason long enough', evidence: 'evidence long enough', decidedAt: '2026-10-24', decidedBy: 'someone accountable',
  }
  it('accepts the well-formed row', () => {
    expect(recordedRevisionProblem(good)).toBeNull()
  })
  it.each([
    ['an interval that includes 0', { changes: { volume: [-0.1, 0.24] } }],
    ['an interval with low above high', { changes: { volume: [0.24, 0.2] } }],
    ['a field that is not a bar field', { changes: { dividend: [0.2, 0.24] } }],
    ['no fields', { changes: {} }],
    ['a bound that is not a number', { changes: { volume: [0.2, '0.24'] } }],
    ['an absurd bound', { changes: { volume: [20, 30] } }],
    ['a date that is not YYYY-MM-DD', { date: '2026-10-9' }],
    ['a fetchedAt that is not an ISO timestamp', { fixtureFetchedAt: '2026-10-12' }],
    ['a decision other than adopt', { decision: 'keep' }],
    ['an empty reason', { reason: '' }],
    ['a lowercase ticker', { ticker: 'cat' }],
    ['an extra key (somewhere to put a vendor value)', { was: 1 }],
  ])('%s', (_name, patch) => {
    expect(recordedRevisionProblem({ ...good, ...patch })).not.toBeNull()
  })
  it('a missing key', () => {
    const { evidence: _e, ...rest } = good
    expect(recordedRevisionProblem(rest)).not.toBeNull()
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
  const row = {
    ticker: 'CAT', date: '2026-10-09', fixtureFetchedAt: FETCHED, changes: { volume: [0.2, 0.24] },
    decision: 'adopt', reason: 'a reason long enough', evidence: 'evidence long enough', decidedAt: '2026-10-24', decidedBy: 'someone accountable',
  }
  /** The vendor's view: the stored tail with its volume revised by `pct`, then `appended` new sessions. */
  const vendor = (pct: number, patch: Record<string, number> = {}, appended = 0) => {
    const s = series()
    s[299] = { ...s[299], volume: s[299].volume * (1 + pct), ...patch }
    for (let i = 1; i <= appended; i++) s.push({ ...series()[299], time: TAIL + i * DAY })
    return s
  }
  const run = (candles: ReturnType<typeof series>, acceptances: unknown[] = [row], prev: unknown = { candles: series(), fetchedAt: FETCHED }, ticker = 'CAT') =>
    planSave({ ticker, sector: 'Industrials', prev, candles, nowMs: NOW, acceptances })

  it('without a row, the CAT shape is refused — the quarantine this exists to end', () => {
    const r = run(vendor(0.2184), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('2026-10-09 volume moved up to 2.2e-1')
  })

  it('with the row, the vendor bar is adopted, counted and noticed — with a date and the bound, not a value', () => {
    const r = run(vendor(0.2184, {}, 3))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.vintage).toEqual({ appended: 3, restated: 1, missing: 0, finalized: 0, superseded: 0, accepted: 1 })
    expect(r.doc.candles[299].volume).toBeCloseTo(1_218_400, 6)
    const notice = r.log.find((l) => l.includes('recorded revision adopted'))
    expect(notice).toBe('::notice title=CAT recorded revision adopted::2026-10-09 adopted under the row decided 2026-10-24 (volume within [0.2, 0.24])')
    expect(r.log.join('\n')).toContain('[CAT] +3 new bar(s), 1 restated (adopted under a recorded acceptance)')
    expect(r.log.join('\n')).not.toMatch(/1218400|1000000/)
  })

  it('fires once: after adoption the fixture has a new fetchedAt, so a further revision is refused', () => {
    const first = run(vendor(0.2184))
    if (!first.ok) throw new Error(first.reason)
    expect(first.doc.fetchedAt).not.toBe(FETCHED)
    // The same row, the next week, a further +21% on the adopted bar.
    const again = planSave({
      ticker: 'CAT', sector: 'Industrials', prev: first.doc, nowMs: NOW + 7 * DAY * 1000, acceptances: [row],
      candles: first.doc.candles.map((c, i) => (i === 299 ? { ...c, volume: c.volume * 1.21 } : c)),
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toContain('does not match this revision exactly')
    // And the vendor serving the adopted value is simply clean: the row is inert.
    const clean = planSave({ ticker: 'CAT', sector: 'Industrials', prev: first.doc, candles: first.doc.candles, nowMs: NOW + 7 * DAY * 1000, acceptances: [row] })
    expect(clean.ok).toBe(true)
    if (clean.ok) expect(clean.doc.vintage).toMatchObject({ restated: 0, accepted: 0 })
  })

  it.each([
    ['the reversal (a revision DOWN)', () => run(vendor(-0.18))],
    ['a revision outside the bound', () => run(vendor(0.3))],
    ['a revision just below the bound', () => run(vendor(0.199))],
    ['a price field moved on the same bar', () => run(vendor(0.2184, { close: 101.1 }))],
    ['a second restated bar on the same ticker', () => run(vendor(0.2184).map((c, i) => (i === 100 ? { ...c, close: 101.5 } : c)))],
    ['history loss alongside', () => run(vendor(0.2184).slice(1))],
    ['another ticker', () => run(vendor(0.2184), [row], { candles: series(), fetchedAt: FETCHED }, 'HON')],
    ['a different fixture version on disk', () => run(vendor(0.2184), [row], { candles: series(), fetchedAt: '2026-10-19T00:00:00.000Z' })],
    ['a row for another date', () => run(vendor(0.2184), [{ ...row, date: '2026-10-08' }])],
    ['a malformed row (interval includes 0)', () => run(vendor(0.2184), [{ ...row, changes: { volume: [-0.5, 0.5] } }])],
    ['a row that also names a field that did not move', () => run(vendor(0.2184), [{ ...row, changes: { volume: [0.2, 0.24], close: [0.01, 0.02] } }])],
  ])('refuses %s', (_name, attempt) => {
    expect(attempt().ok).toBe(false)
  })

  it('a missing acceptances list is no acceptance, never a pass', () => {
    const r = planSave({ ticker: 'CAT', sector: 'Industrials', prev: { candles: series(), fetchedAt: FETCHED }, candles: vendor(0.2184), nowMs: NOW })
    expect(r.ok).toBe(false)
  })

  it('the bar dates line up with the recorded date', () => {
    expect(keyDate(String(series()[299].time))).toBe('2026-10-09')
  })
})

describe('the fetch script loads the file and passes it to planSave', () => {
  const src = readFileSync(join(__dirname, '../../scripts/fetchBacktestData.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  it('passes ACCEPTED_REVISIONS, and an unreadable file yields none', () => {
    expect(src).toMatch(/planSave\(\{ ticker, sector, prev, candles, nowMs: Date\.now\(\), acceptances: ACCEPTED_REVISIONS \}\)/)
    expect(src).toMatch(/path\.resolve\(__dirname, 'lib', 'acceptedRevisions\.json'\)/)
    expect(src).toMatch(/catch \(e\) \{[\s\S]{0,200}return \[\];/)
  })
})
