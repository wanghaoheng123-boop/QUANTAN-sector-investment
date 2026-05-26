import { describe, it, expect, vi } from 'vitest'
import { useEnhancedCombinedSignal } from '@/lib/featureFlags'

describe('featureFlags (Q-009)', () => {
  it('defaults enhanced off in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.QUANTAN_USE_ENHANCED_SIGNAL
    expect(useEnhancedCombinedSignal()).toBe(false)
    vi.unstubAllEnvs()
  })
})
