import { describe, it, expect, afterEach, vi } from 'vitest'
import { appBaseUrl } from '@/lib/appUrl'

describe('appBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers NEXT_PUBLIC_APP_URL when set', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test/app/'
    process.env.VERCEL_URL = 'ignored.vercel.app'
    expect(appBaseUrl()).toBe('https://example.test/app')
  })

  it('uses VERCEL_URL when app url unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    process.env.VERCEL_URL = 'preview-abc.vercel.app'
    expect(appBaseUrl()).toBe('https://preview-abc.vercel.app')
  })

  it('uses localhost in development when env unset', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PORT', '3001')
    expect(appBaseUrl()).toBe('http://127.0.0.1:3001')
  })

  it('falls back to production host outside dev', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(appBaseUrl()).toBe('https://quantan.vercel.app')
  })
})
