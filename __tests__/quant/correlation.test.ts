import { describe, it, expect } from 'vitest'
import {
  pearsonCorrelation,
  maxCorrelationVsPeers,
  correlationAdjustedKelly,
} from '@/lib/quant/correlation'

describe('pearsonCorrelation', () => {
  it('returns null for length mismatch', () => {
    expect(pearsonCorrelation([1, 2, 3], [1, 2])).toBeNull()
  })

  it('returns null for length < 2', () => {
    expect(pearsonCorrelation([1], [1])).toBeNull()
  })

  it('returns null when either series has zero variance', () => {
    expect(pearsonCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull()
    expect(pearsonCorrelation([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull()
  })

  it('returns 1.0 for perfectly correlated series', () => {
    const a = [1, 2, 3, 4, 5]
    const b = [2, 4, 6, 8, 10] // 2x scale
    expect(pearsonCorrelation(a, b)).toBeCloseTo(1.0, 6)
  })

  it('returns -1.0 for perfectly anti-correlated series', () => {
    const a = [1, 2, 3, 4, 5]
    const b = [5, 4, 3, 2, 1]
    expect(pearsonCorrelation(a, b)).toBeCloseTo(-1.0, 6)
  })

  it('returns ~0 for uncorrelated series', () => {
    // Independent enough samples (n=8) that |rho| should be small
    const a = [1, -1, 1, -1, 1, -1, 1, -1]
    const b = [1, 1, -1, -1, 1, 1, -1, -1]
    const r = pearsonCorrelation(a, b)
    expect(r).not.toBeNull()
    if (r != null) expect(Math.abs(r)).toBeLessThan(0.1)
  })

  it('clamps result to [-1, 1] for floating-point edge', () => {
    const a = Array.from({ length: 100 }, (_, i) => i * 0.01)
    const b = a.slice() // identical
    const r = pearsonCorrelation(a, b)
    expect(r).not.toBeNull()
    if (r != null) expect(r).toBeLessThanOrEqual(1)
  })
})

describe('maxCorrelationVsPeers', () => {
  // Updated contract: fail-CLOSED when correlation can't be measured against
  // peers that ARE present. Previously returned 0 (fail-OPEN), letting a
  // candidate we couldn't characterize collect full Kelly — a risk-management
  // anti-pattern. Only returns 0 when peers.length === 0 (genuinely-isolated
  // first position, where there's nothing to correlate against).
  it('returns null when candidate has insufficient data', () => {
    const candidate = [0.01, 0.02]
    const peers = [Array.from({ length: 100 }, () => 0.01)]
    expect(maxCorrelationVsPeers(candidate, peers, 20)).toBeNull()
  })

  it('returns null when no peers have enough data', () => {
    const candidate = Array.from({ length: 50 }, (_, i) => i * 0.001)
    const peers = [[0.01], [0.02, 0.03]]
    expect(maxCorrelationVsPeers(candidate, peers, 20)).toBeNull()
  })

  it('returns 0 when peers array is empty (no positions to correlate against)', () => {
    const candidate = Array.from({ length: 50 }, (_, i) => i * 0.001)
    expect(maxCorrelationVsPeers(candidate, [], 20)).toBe(0)
  })

  it('finds highest |rho| across peers', () => {
    const candidate = Array.from({ length: 50 }, (_, i) => i * 0.001)
    const perfectPeer = candidate.slice() // rho = 1
    const inversePeer = candidate.map((x) => -x) // rho = -1, |rho| = 1
    const noisePeer = Array.from({ length: 50 }, (_, i) => (i % 7) * 0.01)
    const result = maxCorrelationVsPeers(candidate, [noisePeer, perfectPeer, inversePeer], 20)
    expect(result).toBeCloseTo(1.0, 6)
  })

  it('aligns tails when peer is longer', () => {
    const candidate = Array.from({ length: 30 }, (_, i) => i * 0.001)
    const longerPeer = [
      ...Array.from({ length: 100 }, () => 0.005), // older noise
      ...candidate, // recent tail matches candidate exactly
    ]
    const result = maxCorrelationVsPeers(candidate, [longerPeer], 20)
    expect(result).toBeCloseTo(1.0, 5)
  })
})

describe('correlationAdjustedKelly', () => {
  it('returns 0 for invalid kelly', () => {
    expect(correlationAdjustedKelly(0, 0.5)).toBe(0)
    expect(correlationAdjustedKelly(-0.1, 0.5)).toBe(0)
    expect(correlationAdjustedKelly(NaN, 0.5)).toBe(0)
  })

  it('passes kelly through when correlation is below gate', () => {
    expect(correlationAdjustedKelly(0.25, 0.10, 0.20)).toBe(0.25)
    expect(correlationAdjustedKelly(0.25, 0.20, 0.20)).toBe(0.25) // == gate, no shrink
  })

  it('shrinks Kelly proportionally above the gate (continuous at gate)', () => {
    // Continuous-at-gate semantics: shrink_factor = (1 - rho) / (1 - gate)
    // rho=0.8, gate=0.20 → factor = (1-0.8)/(1-0.2) = 0.25 → kelly * 0.25
    expect(correlationAdjustedKelly(0.25, 0.8, 0.20)).toBeCloseTo(0.25 * 0.25, 6)
    // Continuity check: at rho exactly at gate, factor === 1 (no jump).
    expect(correlationAdjustedKelly(0.25, 0.20, 0.20)).toBeCloseTo(0.25, 6)
    // Just-above-gate should produce factor ≈ 1, not factor ≈ 0.80 (old bug).
    const justAbove = correlationAdjustedKelly(0.25, 0.21, 0.20)
    expect(justAbove).toBeGreaterThan(0.24) // not the old 0.20
    expect(justAbove).toBeLessThan(0.25)
  })

  it('returns 0 at perfect correlation', () => {
    expect(correlationAdjustedKelly(0.25, 1.0, 0.20)).toBe(0)
  })

  it('handles negative correlations via |rho|', () => {
    // Caller is expected to pass max|rho|, but if a raw negative slips in we
    // pass it through (kelly unchanged since -0.8 <= gate=0.20).
    expect(correlationAdjustedKelly(0.25, -0.8, 0.20)).toBe(0.25)
  })

  // Fail-closed contract: null maxRho means "unmeasured" — risk-mgmt
  // code must not assume favourable correlation. Previously the function
  // didn't accept null; callers passing 0 got full Kelly under uncertainty.
  it('returns 0 when maxRho is null (fail-closed on unmeasurable correlation)', () => {
    expect(correlationAdjustedKelly(0.25, null, 0.20)).toBe(0)
  })
})
