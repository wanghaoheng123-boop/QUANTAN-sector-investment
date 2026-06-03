/**
 * Architecture guard — canonical module boundaries (Wave 12).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

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
