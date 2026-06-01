import { describe, it, expect, vi, afterEach } from 'vitest'
import { readCsrfToken, csrfHeaders } from '@/lib/api/csrfClient'
import { csrfCookieName, csrfHeaderName } from '@/lib/api/csrf'

const COOKIE = csrfCookieName() // 'quantan_csrf'
const HEADER = csrfHeaderName() // 'x-quantan-csrf'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('csrfClient (double-submit header helper)', () => {
  it('returns empty during SSR (document undefined)', () => {
    vi.stubGlobal('document', undefined)
    expect(readCsrfToken()).toBe('')
    expect(csrfHeaders()).toEqual({})
  })

  it('reads the token from among multiple cookies', () => {
    vi.stubGlobal('document', { cookie: `foo=1; ${COOKIE}=abc123; bar=2` })
    expect(readCsrfToken()).toBe('abc123')
  })

  it('reads the token when it is the first cookie (no leading space)', () => {
    vi.stubGlobal('document', { cookie: `${COOKIE}=lead` })
    expect(readCsrfToken()).toBe('lead')
  })

  it('returns empty when the cookie is absent', () => {
    vi.stubGlobal('document', { cookie: 'session=x; theme=dark' })
    expect(readCsrfToken()).toBe('')
    expect(csrfHeaders()).toEqual({})
  })

  it('does not false-match a cookie whose name is a prefix of ours', () => {
    vi.stubGlobal('document', { cookie: `${COOKIE}_other=nope` })
    expect(readCsrfToken()).toBe('')
  })

  it('URL-decodes the cookie value (mirrors server parseCookie)', () => {
    vi.stubGlobal('document', { cookie: `${COOKIE}=a%20b` })
    expect(readCsrfToken()).toBe('a b')
  })

  it('csrfHeaders() emits the x-quantan-csrf header when a token is present', () => {
    vi.stubGlobal('document', { cookie: `${COOKIE}=tok` })
    expect(csrfHeaders()).toEqual({ [HEADER]: 'tok' })
  })
})
