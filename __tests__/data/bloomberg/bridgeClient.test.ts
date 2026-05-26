import { describe, it, expect } from 'vitest'
import { bridgeSecretMatches } from '@/lib/data/bloomberg/bridgeClient'

describe('bridgeSecretMatches', () => {
  it('allows any provided secret when expected is unset', () => {
    expect(bridgeSecretMatches('anything', '')).toBe(true)
    expect(bridgeSecretMatches(undefined, undefined)).toBe(true)
  })

  it('rejects missing or wrong-length secrets', () => {
    expect(bridgeSecretMatches(undefined, 'secret')).toBe(false)
    expect(bridgeSecretMatches('short', 'longer-secret')).toBe(false)
  })

  it('accepts exact match and rejects mismatch (same length)', () => {
    expect(bridgeSecretMatches('my-shared-secret', 'my-shared-secret')).toBe(true)
    expect(bridgeSecretMatches('my-shared-secrex', 'my-shared-secret')).toBe(false)
  })
})
