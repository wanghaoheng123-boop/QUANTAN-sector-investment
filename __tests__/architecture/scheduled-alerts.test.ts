/**
 * Q107-O2 — the WIRING, which no other gate can check.
 *
 * `tsc` and `vitest` cannot validate GitHub Actions YAML, so a workflow that is
 * wired wrongly ships green. This asserts the two mistakes that would make the
 * alert exist and never fire.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DIR = join(__dirname, '../../.github/workflows')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml'))

const scheduled = files.filter((f) => /^\s*schedule:/m.test(read(f)))
/** A job-level `continue-on-error: true` forces the job result to `success`. */
const canFail = (f: string) => !/^\s{4}continue-on-error:\s*true/m.test(read(f))

describe('Q107-O2 — every scheduled workflow that can fail raises an alert', () => {
  it('finds the scheduled workflows at all', () => {
    // Reachability first: an empty list would make everything below vacuous.
    expect(scheduled.length).toBeGreaterThanOrEqual(4)
  })

  it.each(['refresh-data.yml', 'nightly-backtest.yml', 'stryker-weekly.yml'])(
    '%s calls the alert workflow',
    (f) => {
      expect(read(f)).toContain('uses: ./.github/workflows/scheduled-failure-alert.yml')
    },
  )

  it('every alert job runs with always(), not failure()', () => {
    // THE MISTAKE THAT WOULD MAKE THIS DECORATION. A dependent job is SKIPPED
    // when its `needs` job fails unless the condition re-admits it. `if: failure()`
    // looks right and works; `if: success()` or no condition at all silently
    // skips the alert in exactly the case it exists for. always() also lets the
    // success path close the issue.
    for (const f of scheduled.filter((x) => read(x).includes('scheduled-failure-alert.yml'))) {
      const alertBlock = read(f).slice(read(f).indexOf('  alert:'))
      expect(alertBlock, f).toMatch(/if:\s*always\(\)/)
    }
  })

  it('the alert job is granted issues: write', () => {
    for (const f of scheduled.filter((x) => read(x).includes('scheduled-failure-alert.yml'))) {
      expect(read(f).slice(read(f).indexOf('  alert:')), f).toMatch(/issues:\s*write/)
    }
  })

  it('a11y-axe is unwired ONLY while it cannot fail — and this says so if that changes', () => {
    // The exclusion is honest today: `continue-on-error: true` at job level makes
    // the job's result always `success`, so an alert could never fire and wiring
    // it would be decoration. If someone removes that flag, the workflow becomes
    // alertable and this test turns red to say so, instead of the exclusion
    // quietly outliving its reason.
    const a11y = 'a11y-axe.yml'
    if (canFail(a11y)) {
      expect(read(a11y), 'a11y-axe can now fail — wire it to the alert workflow').toContain(
        'scheduled-failure-alert.yml',
      )
    } else {
      expect(read(a11y)).not.toContain('scheduled-failure-alert.yml')
    }
  })

  it('refresh-data tells the alert whether the red was a quarantine', () => {
    // A deliberate red and a broken pipeline must not read identically.
    const s = read('refresh-data.yml')
    expect(s).toMatch(/outputs:\s*\n\s*(#[^\n]*\n\s*)*quarantine:/)
    expect(s).toContain('QUARANTINED')
  })
})
