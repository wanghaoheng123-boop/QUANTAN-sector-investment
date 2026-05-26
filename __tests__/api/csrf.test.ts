import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateCsrf, generateCsrfToken } from '@/lib/api/csrf'

describe('csrf (Q-036)', () => {
  it('rejects missing token', () => {
    const req = new Request('http://localhost/api/backtest', { method: 'POST' })
    expect(validateCsrf(req)).toBe(false)
  })

  it('accepts matching header and cookie', () => {
    const token = generateCsrfToken()
    const req = new Request('http://localhost/api/backtest', {
      method: 'POST',
      headers: {
        'x-quantan-csrf': token,
        cookie: `quantan_csrf=${token}`,
      },
    })
    expect(validateCsrf(req)).toBe(true)
  })
})
