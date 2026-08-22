import { describe, it, expect } from 'vitest'
import {
  probabilityOfBacktestOverfitting as pbo,
  pboFromBlockPerformance as blockPbo,
  combinations,
  relativeRank,
  sharpeOf,
} from '@/lib/quant/pbo'

/**
 * Seeded LCG. Nondeterministic fixtures have flipped this repo's mutation gate
 * before, and a statistical test that passes 90% of the time is a flake wearing
 * a lab coat.
 */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}
/** Box-Muller from the seeded stream. */
function normals(seed: number, n: number): number[] {
  const r = rng(seed)
  const out: number[] = []
  while (out.length < n) {
    const u = Math.max(r(), 1e-12)
    const v = r()
    out.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))
  }
  return out
}

const matrix = (T: number, N: number, cell: (t: number, n: number) => number) =>
  Array.from({ length: T }, (_, t) => Array.from({ length: N }, (_, n) => cell(t, n)))

describe('combinations', () => {
  it('enumerates C(n, k) without repetition', () => {
    expect(combinations(4, 2)).toEqual([
      [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
    ])
  })

  it('produces C(8, 4) = 70 splits, the CSCV default', () => {
    expect(combinations(8, 4)).toHaveLength(70)
  })

  it('produces C(10, 5) = 252', () => {
    expect(combinations(10, 5)).toHaveLength(252)
  })
})

describe('relativeRank', () => {
  it('is near 1 for the best and near 0 for the worst', () => {
    const v = [1, 2, 3, 4]
    expect(relativeRank(v, 3)).toBeGreaterThan(relativeRank(v, 0))
    expect(relativeRank(v, 3)).toBeCloseTo(4 / 5, 10)
  })

  it('averages ties instead of resolving by array order', () => {
    // Without tie-averaging, N identical configurations — the common case when
    // a grid is insensitive to a parameter — would make column 0 look
    // systematically better than column N-1.
    const v = [5, 5, 5, 5]
    const ranks = v.map((_, i) => relativeRank(v, i))
    expect(new Set(ranks).size).toBe(1)
  })

  it('stays strictly inside (0,1) so the logit is finite', () => {
    const v = [1, 2, 3]
    for (let i = 0; i < v.length; i++) {
      expect(relativeRank(v, i)).toBeGreaterThan(0)
      expect(relativeRank(v, i)).toBeLessThan(1)
    }
  })
})

describe('PBO — calibration against known ground truth', () => {
  it('GENUINE SKILL: one configuration dominant in every period -> PBO ~ 0', () => {
    // Config 0 has a real edge; the rest are noise. The in-sample winner is
    // config 0 on every split, and it is also the OOS winner, so the logit is
    // positive throughout.
    const noise = normals(42, 400 * 10)
    const m = matrix(400, 10, (t, n) => (n === 0 ? 0.02 : 0) + noise[t * 10 + n] * 0.01)
    const r = pbo(m, { blocks: 8 })
    expect(r.splits).toBe(70)
    expect(r.pbo).toBeLessThan(0.05)
  })

  it('NO SKILL: pure noise -> PBO ~ 0.5, the null this statistic exists to detect', () => {
    // Every configuration is i.i.d. noise, so the in-sample winner is chosen by
    // luck and lands on either side of the OOS median with equal probability.
    const noise = normals(7, 400 * 20)
    const m = matrix(400, 20, (t, n) => noise[t * 20 + n])
    const r = pbo(m, { blocks: 8 })
    expect(r.pbo).toBeGreaterThan(0.3)
    expect(r.pbo).toBeLessThan(0.7)
  })

  it('SYSTEMATIC OVERFITTING: each config spikes in one block only -> PBO ~ 1', () => {
    // The textbook overfit: every configuration looks superb on exactly one
    // block and mildly negative everywhere else. Whichever config spiked inside
    // the in-sample half is selected, and out-of-sample it is uniformly the
    // worst — so the logit is negative on every split.
    const T = 400
    const blockSize = T / 8
    const m = matrix(T, 8, (t, n) => (Math.floor(t / blockSize) === n ? 0.1 : -0.02))
    expect(pbo(m, { blocks: 8 }).pbo).toBe(1)
  })

  it('a mid-sample regime flip is only PARTLY caught — and that is CSCV working', () => {
    // My first attempt at the test above used a config that dominates the first
    // half and collapses in the second, and it scored BELOW 0.5. The reason is
    // worth keeping: CSCV is symmetric, so most splits mix early and late
    // blocks, the flip averages out in-sample, and the doomed config is never
    // selected. Only the splits trained mostly on the early half are punished.
    //
    // Read positively: CSCV measures overfitting of the SELECTION PROCEDURE, not
    // regime instability. A statistic that conflated the two would be worse.
    const T = 400
    const m = matrix(T, 8, (t, n) =>
      n === 0 ? (t < T / 2 ? 0.05 : -0.05) : 0.001 * (((t * 7 + n * 13) % 11) - 5),
    )
    const r = pbo(m, { blocks: 8 })
    expect(r.pbo).toBeGreaterThan(0.5)
  })

  it('is deterministic — same input, same PBO', () => {
    const noise = normals(3, 200 * 6)
    const m = matrix(200, 6, (t, n) => noise[t * 6 + n])
    expect(pbo(m).pbo).toBe(pbo(m).pbo)
  })
})

describe('PBO — fails closed rather than returning a meaningless number', () => {
  it('refuses a single configuration', () => {
    // PBO measures whether SELECTING among candidates overfits. One candidate
    // has no PBO, and returning 0 would read as "no overfitting".
    expect(() => pbo(matrix(100, 1, () => 1))).toThrow(/at least 2 configurations/)
  })

  it('refuses an odd or too-small block count', () => {
    expect(() => pbo(matrix(100, 4, () => 1), { blocks: 7 })).toThrow(/even integer/)
    expect(() => pbo(matrix(100, 4, () => 1), { blocks: 1 })).toThrow(/even integer/)
  })

  it('refuses when the sample cannot fill the blocks', () => {
    expect(() => pbo(matrix(8, 4, () => 1), { blocks: 8 })).toThrow(/cannot fill/)
  })

  it('refuses a ragged matrix', () => {
    const ragged = [[1, 2], [1]] as number[][]
    expect(() => pbo(ragged, { blocks: 2 })).toThrow(/same length/)
  })

  it('refuses an empty matrix', () => {
    expect(() => pbo([], { blocks: 2 })).toThrow(/empty/)
  })
})

describe('PBO — reported shape', () => {
  it('truncates to a whole number of blocks and says how many it used', () => {
    const m = matrix(103, 5, (t, n) => (n + t) % 7)
    const r = pbo(m, { blocks: 8 })
    expect(r.observations).toBe(96) // floor(103/8) * 8
    expect(r.blocks).toBe(8)
    expect(r.configurations).toBe(5)
    expect(r.logits).toHaveLength(r.splits)
  })

  it('sharpeOf returns 0 for a constant series rather than dividing by zero', () => {
    expect(sharpeOf([2, 2, 2])).toBe(0)
  })
})

describe('pboFromBlockPerformance — CSCV on block-level performance', () => {
  it('GENUINE SKILL: one config best in every block -> PBO 0', () => {
    const perf = Array.from({ length: 4 }, (_, b) =>
      Array.from({ length: 5 }, (_, n) => (n === 0 ? 1 : 0.1 * ((b + n) % 3))),
    )
    expect(blockPbo(perf).pbo).toBe(0)
  })

  it('SYSTEMATIC OVERFITTING: each config best in exactly one block -> PBO 1', () => {
    const perf = Array.from({ length: 4 }, (_, b) =>
      Array.from({ length: 4 }, (_, n) => (b === n ? 1 : -0.2)),
    )
    expect(blockPbo(perf).pbo).toBe(1)
  })

  it('IDENTICAL COLUMNS tie to omega = 0.5, so PBO is 1 — a DEGENERATE grid, not a finding', () => {
    // This is the artifact that made the first PBO producer report 1 on a grid
    // whose parameters the evaluator never read. The statistic is behaving
    // correctly; the INPUT was meaningless. The producer now refuses to publish
    // when the columns are not distinct.
    const perf = Array.from({ length: 4 }, () => [0.5, 0.5, 0.5, 0.5])
    const r = blockPbo(perf)
    expect(r.pbo).toBe(1)
    expect(r.logits.every((l) => l === 0)).toBe(true)
  })

  it('produces C(4,2) = 6 splits for 4 blocks', () => {
    const perf = Array.from({ length: 4 }, (_, b) => [b, 4 - b, 2])
    expect(blockPbo(perf).splits).toBe(6)
  })

  it('refuses an odd block count and a single configuration', () => {
    expect(() => blockPbo([[1, 2], [2, 1], [1, 2]])).toThrow(/even number of blocks/)
    expect(() => blockPbo([[1], [2]])).toThrow(/at least 2 configurations/)
  })
})
