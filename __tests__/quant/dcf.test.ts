import { describe, it, expect } from 'vitest'
import { runDcf } from '@/lib/quant/dcf'

describe('DCF Model', () => {
  const baseInput = {
    fcf0: 1_000_000,
    shares: 100_000,
    wacc: 0.10,
    terminalGrowth: 0.03,
    explicitGrowth: 0.08,
  }

  it('returns valid result for reasonable inputs', () => {
    const result = runDcf(baseInput)
    expect(result).not.toBeNull()
    expect(result!.valuePerShare).toBeGreaterThan(0)
    expect(result!.enterpriseValue).toBeGreaterThan(0)
    expect(result!.pvExplicit).toBeGreaterThan(0)
    expect(result!.pvTerminal).toBeGreaterThan(0)
  })

  it('enterprise value = pvExplicit + pvTerminal', () => {
    const result = runDcf(baseInput)!
    expect(result.enterpriseValue).toBeCloseTo(result.pvExplicit + result.pvTerminal, 5)
  })

  it('valuePerShare = enterpriseValue / shares', () => {
    const result = runDcf(baseInput)!
    expect(result.valuePerShare).toBeCloseTo(result.enterpriseValue / baseInput.shares, 5)
  })

  it('returns null when wacc <= terminalGrowth', () => {
    expect(runDcf({ ...baseInput, wacc: 0.03, terminalGrowth: 0.03 })).toBeNull()
    expect(runDcf({ ...baseInput, wacc: 0.02, terminalGrowth: 0.03 })).toBeNull()
  })

  it('returns null for negative shares', () => {
    expect(runDcf({ ...baseInput, shares: 0 })).toBeNull()
    expect(runDcf({ ...baseInput, shares: -100 })).toBeNull()
  })

  it('returns null for extreme wacc', () => {
    expect(runDcf({ ...baseInput, wacc: 0 })).toBeNull()
    expect(runDcf({ ...baseInput, wacc: 0.55 })).toBeNull()
  })

  it('returns null for out-of-range terminal growth', () => {
    expect(runDcf({ ...baseInput, terminalGrowth: -0.05 })).toBeNull()
    expect(runDcf({ ...baseInput, terminalGrowth: 0.08 })).toBeNull()
  })

  it('returns null for out-of-range explicit growth', () => {
    expect(runDcf({ ...baseInput, explicitGrowth: -0.35 })).toBeNull()
    expect(runDcf({ ...baseInput, explicitGrowth: 0.50 })).toBeNull()
  })

  it('returns null for non-finite fcf0', () => {
    expect(runDcf({ ...baseInput, fcf0: NaN })).toBeNull()
    expect(runDcf({ ...baseInput, fcf0: Infinity })).toBeNull()
  })

  it('handles custom explicitYears', () => {
    const result10 = runDcf({ ...baseInput, explicitYears: 10 })
    const result5 = runDcf(baseInput) // default 5
    expect(result10).not.toBeNull()
    // More explicit years should give higher pvExplicit
    expect(result10!.pvExplicit).toBeGreaterThan(result5!.pvExplicit)
  })

  it('higher growth leads to higher valuation', () => {
    const low = runDcf({ ...baseInput, explicitGrowth: 0.05 })!
    const high = runDcf({ ...baseInput, explicitGrowth: 0.15 })!
    expect(high.valuePerShare).toBeGreaterThan(low.valuePerShare)
  })

  it('higher wacc leads to lower valuation', () => {
    const low = runDcf({ ...baseInput, wacc: 0.08 })!
    const high = runDcf({ ...baseInput, wacc: 0.15 })!
    expect(low.valuePerShare).toBeGreaterThan(high.valuePerShare)
  })

  it('handles negative FCF (declining value)', () => {
    const result = runDcf({ ...baseInput, fcf0: -500_000 })
    // Negative FCF with positive growth leads to more negative → null (valuePerShare <= 0)
    expect(result).toBeNull()
  })
})
