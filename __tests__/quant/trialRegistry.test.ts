import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parseRegistry, countTrials, readTrialCount } from '@/lib/quant/trialRegistry'

const ROOT = join(__dirname, '../..')
const REGISTRY = join(ROOT, '.quantlab/TRIAL_REGISTRY.jsonl')

describe('trial registry — parsing', () => {
  it('ignores blank lines', () => {
    expect(parseRegistry('\n{"trial_id":"T-1"}\n\n')).toHaveLength(1)
  })

  it('fails closed on malformed JSON rather than skipping the row', () => {
    // I2: never fail silent. A dropped row understates multiplicity, which
    // moves the published DSR in the flattering direction.
    expect(() => parseRegistry('{"trial_id":"T-1"}\n{oops}')).toThrow(/line 2/)
  })

  it('fails closed on a row with no trial_id', () => {
    expect(() => parseRegistry('{"configs_tried":{"declared_grid":8}}')).toThrow(/trial_id/)
  })
})

describe('trial registry — counting', () => {
  it('uses the reported count for the lower bound and the declared grid for the upper', () => {
    const c = countTrials([
      { trial_id: 'T-1', configs_tried: { declared_grid: 1024, reported_total_combinations_per_instrument: 16, uncertain: true } },
    ])
    expect(c.lower).toBe(16)
    expect(c.upper).toBe(1024)
    expect(c.uncertain).toEqual(['T-1'])
  })

  it('counts a trial with NO recorded configuration count as one, not zero', () => {
    // It was still run, looked at, and kept or discarded — that consumed a
    // degree of freedom. Counting it as zero would understate multiplicity.
    expect(countTrials([{ trial_id: 'T-1' }])).toMatchObject({ lower: 1, upper: 1 })
  })

  it('never returns an upper bound below the lower bound', () => {
    const c = countTrials([
      { trial_id: 'T-1', configs_tried: { declared_grid: 4, reported_total_combinations_per_instrument: 64 } },
    ])
    expect(c.upper).toBeGreaterThanOrEqual(c.lower)
  })

  it('sums across rows', () => {
    const c = countTrials([
      { trial_id: 'T-1', configs_tried: { declared_grid: 10 } },
      { trial_id: 'T-2', configs_tried: { declared_grid: 5 } },
    ])
    expect(c).toMatchObject({ lower: 15, upper: 15, rows: 2 })
  })

  it('an empty registry yields zero rows so the caller can fail rather than guess', () => {
    expect(countTrials([])).toMatchObject({ lower: 0, upper: 0, rows: 0 })
  })
})

describe('trial registry — the real corpus', () => {
  it('exists and parses', () => {
    expect(existsSync(REGISTRY)).toBe(true)
    expect(readTrialCount(readFileSync(REGISTRY, 'utf8')).rows).toBeGreaterThan(0)
  })

  it('collapses to a POINT now that Q-084 is resolved', () => {
    const c = readTrialCount(readFileSync(REGISTRY, 'utf8'))
    // This test previously asserted a BAND, because T-0001 recorded declared
    // 1024 vs reported 16 and flagged itself unresolved. Q-085 found the answer
    // in the code: generateGrid iterates only the two dimensions the evaluator
    // consumes, so 16 is right and 1024 counted three inert ones. With an
    // effective count on file there is no interval left to express.
    //
    // The band was never the goal — refusing to INVENT a denominator was. A
    // counted point is strictly better than an honest interval.
    expect(c.upper).toBe(c.lower)
    expect(c.lower).toBeGreaterThan(0)
  })

  it('the counted denominator is what the published benchmark used', () => {
    // Guards the wiring: if the registry changes and the committed benchmark is
    // not regenerated, the published DSR is deflated against a stale count.
    const c = readTrialCount(readFileSync(REGISTRY, 'utf8'))
    const bench = JSON.parse(readFileSync(join(ROOT, 'scripts/benchmark-results.json'), 'utf8'))
    expect(bench.tradeStats.nTrials.lower).toBe(c.lower)
    expect(bench.tradeStats.nTrials.upper).toBe(c.upper)
  })
})

describe('I5 — the published headline is the DEFLATED number on the HONEST sample', () => {
  const bench = JSON.parse(readFileSync(join(ROOT, 'scripts/benchmark-results.json'), 'utf8'))

  it('deflatedSharpe is computed on the non-overlapping sample, not the pooled one', () => {
    expect(bench.tradeStats.nTradesNonOverlapping).toBeLessThan(bench.tradeStats.nTrades)
    expect(bench.nonOverlapStats.nTrades).toBe(bench.tradeStats.nTradesNonOverlapping)
    // …and n_eff discounts it further for cross-sectional clustering.
    expect(bench.tradeStats.nEffective).toBeLessThan(bench.tradeStats.nTradesNonOverlapping)
  })

  it('the headline is not saturated — the old one was, which made nTrials inert', () => {
    // The pre-Q-081 headline was exactly 1.0000 and provably unmoved by nTrials
    // from 10 to 1e12. A statistic that cannot move is not a test.
    expect(bench.tradeStats.deflatedSharpe).toBeLessThan(1)
    expect(bench.tradeStats.supersededHeadlines.atOverlappingN).toBeGreaterThan(
      bench.tradeStats.deflatedSharpe,
    )
  })

  it('the band is ordered worst-first and brackets the headline', () => {
    const [atUpperTrials, atLowerTrials] = bench.tradeStats.deflatedSharpeBand
    expect(atUpperTrials).toBeLessThanOrEqual(atLowerTrials)
    expect(bench.tradeStats.deflatedSharpe).toBe(atUpperTrials)
  })

  it('the shipped result does NOT clear a conventional bar, and the record says so', () => {
    // Honest in both directions: if a future change pushes DSR above 0.95 this
    // fails and forces someone to re-read the claim rather than inherit it.
    expect(bench.tradeStats.deflatedSharpe).toBeLessThan(0.95)
    expect(bench.tradeStats.note).toMatch(/NOT A SKILL CERTIFICATION/)
  })

  it('the excess over an equal-weight hold of the same universe is the headline test', () => {
    // DSR tests SR>0, which a long-only survivor-list strategy in a bull window
    // clears by construction. This is the number that bears on SKILL.
    const x = bench.tradeStats.excessOverMarket
    expect(x.tStat).not.toBeNull()
    expect(Math.abs(x.tStat)).toBeLessThan(x.significanceBar)
  })

  it('the clustering discount is applied and recorded, not merely asserted', () => {
    const c = bench.tradeStats.clustering
    expect(c.designEffect).toBeGreaterThan(1)
    expect(c.intraClusterCorrelation).toBeGreaterThan(0)
    expect(c.occupiedBlocks).toBeGreaterThan(0)
  })
})
