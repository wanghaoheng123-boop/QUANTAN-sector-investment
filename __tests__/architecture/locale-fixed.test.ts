/**
 * Red-team H1 (2026-10-17) — every number and date formats in ONE locale.
 *
 * A bare `toLocaleString()` formats in the locale of whatever process runs it.
 * `/portfolio` server-renders `TailRiskBanner`, which printed
 * `portfolioVegaUsd.toLocaleString()`: "-600,000" from the en-US server, then
 * "-600.000" in a German browser and "-600 000" in a French one at hydration —
 * React error #418, the class Q-142 fixed for time zones. Q-142's test varied
 * the zone only, so it could not see a locale.
 *
 * The rule is structural rather than "only on SSR'd paths": whether a
 * component is server-rendered is a property of its importers, which change,
 * and a client-only site still showed one number three ways. Pass `UI_LOCALE`
 * (lib/format.ts) or use formatLocalTime / formatLocalDateTime / formatEtDateTime.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from './syntheticContainment'

const ROOT = join(__dirname, '..', '..')

/** A locale-dependent call with no locale argument. */
export const BARE_LOCALE =
  /\.toLocale(?:String|DateString|TimeString)\(\s*\)|new Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules)\(\s*(?:\)|undefined\b)/g

const files = execSync('git ls-files -z app components hooks lib', { cwd: ROOT }).toString().split('\0')
  .filter((p) => /\.(?:tsx?|jsx?|mjs)$/.test(p) && !p.endsWith('.d.ts'))

const offenders = files.flatMap((p) => {
  const src = stripComments(readFileSync(join(ROOT, p), 'utf8'))
  return [...src.matchAll(BARE_LOCALE)].map((m) => `${p}: ${m[0]}`)
})

describe('UI formatting uses a fixed locale (red-team H1)', () => {
  it('visited the product tree, including the component that failed', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('components/risk/TailRiskBanner.tsx')
    expect(files).toContain('lib/portfolio/tailRiskAlerts.ts')
  })

  it('flags every bare form (positive control)', () => {
    for (const s of ['n.toLocaleString()', 'd.toLocaleTimeString( )', 'd.toLocaleDateString()', 'new Intl.NumberFormat()', 'new Intl.DateTimeFormat(undefined, {})']) {
      expect(s.match(BARE_LOCALE), s).not.toBeNull()
    }
    for (const s of ["n.toLocaleString('en-US')", 'd.toLocaleTimeString(UI_LOCALE, { timeZoneName: "short" })', "new Intl.NumberFormat('en-US')"]) {
      expect(s.match(BARE_LOCALE), s).toBeNull()
    }
  })

  it('no product file formats in the viewer\'s locale', () => {
    expect(offenders).toEqual([])
  })
})
