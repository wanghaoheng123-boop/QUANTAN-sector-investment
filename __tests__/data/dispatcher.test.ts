import { describe, it, expect } from 'vitest'
import { getActiveProvider } from '@/lib/data/providers/dispatcher'

describe('provider dispatcher (Q-048)', () => {
  it('defaults to yahoo without polygon key', () => {
    const info = getActiveProvider('equity-eod')
    expect(info.name).toBe('yahoo')
  })
})
