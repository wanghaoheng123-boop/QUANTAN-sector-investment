import { describe, it, expect } from 'vitest'
import { CODEX_FRAMEWORKS } from '@/lib/quant/frameworks'

describe('CODEX_FRAMEWORKS', () => {
  it('exports non-empty pillar list with required fields', () => {
    expect(CODEX_FRAMEWORKS.length).toBeGreaterThan(0)
    for (const pillar of CODEX_FRAMEWORKS) {
      expect(pillar.id).toMatch(/^[a-z-]+$/)
      expect(pillar.title.length).toBeGreaterThan(0)
      expect(pillar.themes.length).toBeGreaterThan(0)
      expect(pillar.checklist.length).toBeGreaterThan(0)
    }
  })
})
