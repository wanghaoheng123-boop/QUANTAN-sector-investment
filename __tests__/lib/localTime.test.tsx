/**
 * Red-team R2-243-2/-3 — viewer-zone times.
 *
 * The helpers name the viewer's zone, so they must never reach server-rendered
 * markup directly; <LocalTime> renders "—" until mounted, which makes the
 * server's text zone-independent by construction. And a missing value is "—",
 * never the epoch (I2: missing shown as data).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocalTime } from '@/components/LocalTime'
import { formatLocalDateTime, formatLocalTime } from '@/lib/format'
import { formatNySessionStamp } from '@/lib/api/marketHours'

const ORIGINAL_TZ = process.env.TZ
afterEach(() => { process.env.TZ = ORIGINAL_TZ })

describe('formatLocalTime / formatLocalDateTime fail closed', () => {
  it.each([null, undefined, '', 'garbage', Number.NaN])('%s renders "—", not a date', (v) => {
    expect(formatLocalTime(v as never)).toBe('—')
    expect(formatLocalDateTime(v as never)).toBe('—')
  })

  it('a real stamp renders with its zone named', () => {
    process.env.TZ = 'UTC'
    expect(formatLocalTime('2026-10-01T15:15:00Z')).toMatch(/3:15:00\s?PM UTC/)
  })
})

describe('<LocalTime> server markup does not depend on the viewer zone', () => {
  it.each(['UTC', 'Asia/Singapore', 'America/New_York'])('renders the same "—" under %s', (tz) => {
    process.env.TZ = tz
    expect(renderToStaticMarkup(<LocalTime value="2026-10-01T15:15:00Z" withDate />)).toBe('—')
    expect(renderToStaticMarkup(<LocalTime value="2026-10-01T15:15:00Z" />)).toBe('—')
  })
})

describe('formatNySessionStamp names EDT or EST (red-team R2-243-4)', () => {
  it('tells the two instants of the fall-back hour apart', () => {
    expect(formatNySessionStamp(new Date('2026-11-01T05:30:00Z'))).toBe('Sun 01:30 EDT')
    expect(formatNySessionStamp(new Date('2026-11-01T06:30:00Z'))).toBe('Sun 01:30 EST')
  })
})
