/**
 * lib/optimize/sectorProfiles.ts tests (Q-051-NEW continuation).
 *
 * Covers SECTOR_PROFILES integrity + the two lookup helpers. These profiles
 * directly feed enhancedCombinedSignal's sector-aware thresholds, so an
 * accidental sign-flip / typo / duplicate ticker would silently change
 * production signals.
 */
import { describe, it, expect } from 'vitest'
import {
  SECTOR_PROFILES,
  getProfileForTicker,
  getProfileForSector,
} from '@/lib/optimize/sectorProfiles'

describe('SECTOR_PROFILES', () => {
  const sectorNames = Object.keys(SECTOR_PROFILES)

  it('defines at least 9 GICS sectors', () => {
    // 11 GICS sectors total; some research codebases bundle a few. Floor at 9.
    expect(sectorNames.length).toBeGreaterThanOrEqual(9)
  })

  it('every profile has the canonical fields populated', () => {
    for (const [name, p] of Object.entries(SECTOR_PROFILES)) {
      expect(p.sector, `sector field for ${name}`).toBeTruthy()
      expect(Array.isArray(p.tickers), `tickers array for ${name}`).toBe(true)
      expect(p.tickers.length, `tickers non-empty for ${name}`).toBeGreaterThan(0)
      expect(['trend_following', 'mean_reversion', 'hybrid'])
        .toContain(p.strategyBias)
      // Numeric thresholds finite
      for (const num of [
        p.buyWScoreThreshold, p.sellWScoreThreshold, p.slopeThreshold,
        p.maxHoldDays, p.confidenceThreshold, p.atrStopMultiplier,
      ]) {
        expect(Number.isFinite(num), `numeric finite check for ${name}`).toBe(true)
      }
    }
  })

  it('sellWScoreThreshold is always negative (sell direction)', () => {
    for (const [name, p] of Object.entries(SECTOR_PROFILES)) {
      expect(p.sellWScoreThreshold, `sell threshold sign for ${name}`).toBeLessThan(0)
    }
  })

  it('buyWScoreThreshold is always positive', () => {
    for (const [name, p] of Object.entries(SECTOR_PROFILES)) {
      expect(p.buyWScoreThreshold, `buy threshold sign for ${name}`).toBeGreaterThan(0)
    }
  })

  it('maxVixForBuy is null or > 10 (sane VIX ceiling)', () => {
    for (const [name, p] of Object.entries(SECTOR_PROFILES)) {
      if (p.maxVixForBuy !== null) {
        expect(p.maxVixForBuy, `VIX ceiling for ${name}`).toBeGreaterThan(10)
      }
    }
  })

  it('atrStopMultiplier is in a sensible band (0.5–5×)', () => {
    for (const [name, p] of Object.entries(SECTOR_PROFILES)) {
      expect(p.atrStopMultiplier, `ATR mult for ${name}`).toBeGreaterThan(0.5)
      expect(p.atrStopMultiplier, `ATR mult for ${name}`).toBeLessThan(5)
    }
  })

  it('no ticker is assigned to multiple sectors', () => {
    const seen = new Map<string, string>()
    for (const [sectorName, p] of Object.entries(SECTOR_PROFILES)) {
      for (const t of p.tickers) {
        const prior = seen.get(t)
        if (prior) {
          throw new Error(`Ticker ${t} appears in both ${prior} and ${sectorName}`)
        }
        seen.set(t, sectorName)
      }
    }
  })

  it('Technology profile has goldenCrossGate enabled (per docstring research)', () => {
    const tech = SECTOR_PROFILES['Technology']
    if (tech) {
      expect(tech.goldenCrossGate).toBe(true)
    }
  })
})

describe('getProfileForTicker', () => {
  it('returns the correct profile for a known ticker', () => {
    // Find any ticker from any profile and verify lookup.
    const firstSector = Object.values(SECTOR_PROFILES)[0]
    const knownTicker = firstSector.tickers[0]
    const result = getProfileForTicker(knownTicker)
    expect(result.sector).toBe(firstSector.sector)
    expect(result.tickers).toContain(knownTicker)
  })

  it('handles BRK-B / BRK.B variant', () => {
    // The profile uses BRK.B; lookups for BRK-B should still find it.
    // Either the profile contains BRK.B and BRK-B works, or no profile has
    // either and we get the Unknown default. Verify both paths produce
    // a defined result with no throw.
    const dotForm = getProfileForTicker('BRK.B')
    const dashForm = getProfileForTicker('BRK-B')
    expect(dotForm).toBeDefined()
    expect(dashForm).toBeDefined()
    // If a Financials profile contains BRK.B, both lookups return same sector.
    if (dotForm.sector !== 'Unknown') {
      expect(dashForm.sector).toBe(dotForm.sector)
    }
  })

  it('returns the Unknown default profile for unmapped tickers', () => {
    const result = getProfileForTicker('NOT_A_REAL_TICKER_XYZ')
    expect(result.sector).toBe('Unknown')
    expect(result.tickers).toEqual([])
    expect(result.optimizationNotes).toContain('No profile')
    // Defaults should be conservative.
    expect(result.goldenCrossGate).toBe(false)
    expect(result.tlrGate).toBe(false)
  })
})

describe('getProfileForSector', () => {
  it('returns the profile for a known sector', () => {
    const firstName = Object.keys(SECTOR_PROFILES)[0]
    const profile = getProfileForSector(firstName)
    expect(profile).not.toBeNull()
    expect(profile!.sector).toBe(firstName)
  })

  it('returns null for an unknown sector', () => {
    expect(getProfileForSector('NotASector')).toBeNull()
  })
})
