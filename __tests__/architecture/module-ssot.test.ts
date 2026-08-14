/**
 * Architecture guard — canonical module boundaries (Wave 12).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SECTOR_COLORS_BY_NAME, SECTOR_COLORS_BY_SLUG } from '@/lib/sectorColors'
import { SECTORS } from '@/lib/sectors'

const ROOT = join(__dirname, '../..')

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

describe('module SSOT — OhlcBar canonical import', () => {
  const backtestConsumers = [
    'lib/backtest/core.ts',
    'lib/backtest/dataLoader.ts',
    'lib/backtest/liveSignal.ts',
  ] as const

  for (const file of backtestConsumers) {
    it(`${file} imports OhlcBar from @/lib/quant/indicators`, () => {
      const src = readSource(file)
      expect(src).toMatch(/import type \{ OhlcBar \} from '@\/lib\/quant\/indicators'/)
      expect(src).not.toMatch(/OhlcBar.*from '@\/lib\/quant\/technicals'/)
    })
  }

  it('technicals.ts re-exports OhlcBar from indicators', () => {
    const src = readSource('lib/quant/technicals.ts')
    expect(src).toContain("export type { OhlcBar } from './indicators'")
  })

  it('indicators.ts defines OhlcBar interface', () => {
    const src = readSource('lib/quant/indicators.ts')
    expect(src).toMatch(/export interface OhlcBar/)
  })
})

/**
 * Sector color SSOT (added 2026-08-14).
 *
 * lib/sectorColors.ts was created in Phase 14 (R5-M-2) to end sector-color
 * duplication, and its docstring already named app/api/briefs/route.ts as a
 * consumer of SECTOR_COLORS_BY_SLUG. Only the backtest page was actually
 * migrated: the briefs route kept a hard-coded table, which then drifted on
 * four sectors — Real Estate reaching Energy's exact amber (#f59e0b), so two
 * sectors rendered identically in the briefs list.
 *
 * Writing the SSOT did not make the SSOT true. These tests assert the
 * *consumers*, so a re-introduced literal fails here in milliseconds instead
 * of surviving another audit as a color nobody re-checks.
 */
describe('module SSOT — sector colors', () => {
  const colorConsumers = [
    'app/api/briefs/route.ts',
    'app/backtest/page.tsx',
  ] as const

  for (const file of colorConsumers) {
    it(`${file} sources sector colors from lib/sectorColors, not literals`, () => {
      const src = readSource(file)
      expect(src).toMatch(/from '@\/lib\/sectorColors'/)
      // No `color: '#rrggbb'` object literal may reappear in a consumer.
      // Prose in comments is fine; an assigned literal is the defect.
      const assignedHex = src.match(/\bcolors?\s*:\s*'#[0-9a-fA-F]{3,8}'/g) ?? []
      expect(assignedHex).toEqual([])
    })
  }

  it('every sector color in the palette is unique', () => {
    // Real Estate and Energy both being #f59e0b is what made the drift visible;
    // identical colors make two sectors indistinguishable wherever they are
    // listed together.
    const byName = SECTOR_COLORS_BY_NAME
    const values = Object.values(byName).map(c => c.toLowerCase())
    expect(new Set(values).size).toBe(values.length)
  })

  it('the slug view and the name view agree with lib/sectors', () => {
    for (const s of SECTORS) {
      expect(SECTOR_COLORS_BY_SLUG[s.slug]).toBe(s.color)
      expect(SECTOR_COLORS_BY_NAME[s.name]).toBe(s.color)
    }
  })
})
