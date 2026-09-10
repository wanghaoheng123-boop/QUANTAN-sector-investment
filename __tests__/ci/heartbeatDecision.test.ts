/**
 * Q107-A22 — the alerting could not report its own failure to start.
 *
 * `Q107-O2`'s alert job lives inside the workflow it watches. A `startup_failure`
 * produces ZERO jobs, so the alert never runs. Measured: `nightly-backtest`
 * startup_failed on 2026-09-03 and 2026-09-04 with nothing notified, and across
 * the last 60 runs of each workflow there are four such instances. The probe
 * under test here is the out-of-band half.
 *
 * ## REACHABILITY FIRST, and here the risk is the CRON PARSER
 *
 * Every verdict below is downstream of "when was this due". A parser that throws
 * on the real expressions would make every workflow `unparseable`; one that
 * silently mis-computes would move the due time and quietly make the probe
 * agree with whatever it found. So the first block runs the REAL crons from
 * `.github/workflows/` against fixed clocks, with the expected instants written
 * as literals a reader can check by hand.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseCron, previousFire, extractCrons } from '../../scripts/ci/cronSchedule.mjs'
import { assessWorkflow, toAlertConclusion, GRACE_HOURS, GRACE_MS } from '../../scripts/ci/heartbeatDecision.mjs'
import { decideAlert } from '../../scripts/ci/alertDecision.mjs'

const DIR = join(__dirname, '../../.github/workflows')
const workflows = readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, source: readFileSync(join(DIR, f), 'utf8') }))
const scheduled = workflows
  .map((w) => ({ file: w.file, crons: extractCrons(w.source) as string[] }))
  .filter((w) => w.crons.length > 0)

const iso = (d: Date | null) => (d === null ? null : d.toISOString())
const run = (createdAt: string, conclusion: string | null, status = 'completed') => ({ createdAt, status, conclusion })

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-A22 — the cadence parser is reachable on the real tree', () => {
  it('finds every scheduled workflow, and the set is not empty', () => {
    // If this scanner returned nothing, the probe would watch nothing and exit
    // healthy — an alerter that is silent because it is blind, which is the
    // defect being closed. The runner also hard-exits on an empty set.
    expect(scheduled.map((s) => s.file).sort()).toEqual([
      'a11y-axe.yml', 'nightly-backtest.yml', 'refresh-data.yml',
      'stryker-weekly.yml', 'workflow-heartbeat.yml',
    ])
  })

  it('parses every cron currently in the repository', () => {
    // Fail closed means an unmodellable cadence is a violation, not a skip — so
    // the rule needs reachable instances on the REAL tree, not only in fixtures.
    for (const s of scheduled) for (const c of s.crons) expect(() => parseCron(c)).not.toThrow()
  })

  it.each([
    // due time computed by hand from the cron, against a fixed clock
    ['nightly-backtest.yml', '0 6 * * 1-5', '2026-09-09T14:00:00Z', '2026-09-09T06:00:00.000Z'],
    ['nightly-backtest.yml weekend rollback', '0 6 * * 1-5', '2026-09-13T14:00:00Z', '2026-09-11T06:00:00.000Z'],
    ['refresh-data.yml', '0 22 * * 0', '2026-09-09T14:00:00Z', '2026-09-06T22:00:00.000Z'],
    ['a11y-axe.yml', '0 1 * * 1', '2026-09-09T14:00:00Z', '2026-09-07T01:00:00.000Z'],
    ['stryker-weekly.yml', '0 8 * * 0', '2026-09-09T14:00:00Z', '2026-09-06T08:00:00.000Z'],
    ['heartbeat itself', '0 14 * * *', '2026-09-09T13:59:00Z', '2026-09-08T14:00:00.000Z'],
  ])('computes the previous fire for %s', (_what, cron, now, expected) => {
    expect(iso(previousFire(cron, new Date(now)))).toBe(expected)
  })

  it('refuses a cadence it cannot model rather than guessing', () => {
    for (const bad of ['0 1 * * MON', '0 1 * *', '0 1 * * 1 2', '0 1 L * *', '99 1 * * *']) {
      expect(() => parseCron(bad)).toThrow()
    }
    // …but does support the ordinary forms, so refusal is narrow.
    for (const ok of ['*/15 * * * *', '0 0,12 * * *', '0 6 1-5 * *', '0 8 * * 7']) {
      expect(() => parseCron(ok)).not.toThrow()
    }
  })

  it('implements cron\'s OR rule when BOTH dom and dow are restricted', () => {
    // No instance in this repo — every cron here leaves dom as `*`. Covered by
    // fixture so that adding one does not silently change what "due" means.
    // 2026-09-09 is a Wednesday; dom=1 or dow=3 both match this week.
    expect(iso(previousFire('0 0 1 * 3', new Date('2026-09-09T12:00:00Z')))).toBe('2026-09-09T00:00:00.000Z')
    expect(iso(previousFire('0 0 1 * 3', new Date('2026-09-08T12:00:00Z')))).toBe('2026-09-02T00:00:00.000Z')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-A22 — the states the in-workflow alerter cannot reach', () => {
  const nightly = { file: 'nightly-backtest.yml', crons: ['0 6 * * 1-5'] }
  // Judged fire with an 18h grace at this clock is Tue 2026-09-08T06:00Z.
  const now = new Date('2026-09-09T14:00:00Z')

  it('THE FINDING: a startup_failure is reported', () => {
    // The case that produced zero jobs, so the workflow's own alert could not
    // run. This probe is the only thing that can see it.
    const r = assessWorkflow({ ...nightly, runs: [run('2026-09-08T06:20:00Z', 'startup_failure')], now })
    expect(r.state).toBe('unhealthy')
    expect(r.detail).toContain('startup_failure produces zero jobs')
    expect(toAlertConclusion(r.state, r.conclusion)).toBe('startup_failure')
  })

  it('THE OTHER FINDING: no run at all is reported, not read as healthy', () => {
    // GitHub disables scheduled triggers after 60 days of inactivity and creates
    // NO run record. A conclusion-based check reads the last old run, finds it
    // green, and reports health forever. Distinct input from a stale conclusion:
    // the run list is EMPTY, and only the due-time framing sees it.
    const r = assessWorkflow({ ...nightly, runs: [], now })
    expect(r.state).toBe('missing')
    expect(r.detail).toContain('disabled')
    expect(toAlertConclusion(r.state)).toBe('failure')
  })

  it('an old successful run does NOT satisfy a newer due time', () => {
    const r = assessWorkflow({ ...nightly, runs: [run('2026-08-01T06:10:00Z', 'success')], now })
    expect(r.state).toBe('missing')
  })

  it('a successful run since the due time is healthy', () => {
    const r = assessWorkflow({ ...nightly, runs: [run('2026-09-08T07:10:00Z', 'success')], now })
    expect(r.state).toBe('healthy')
    expect(toAlertConclusion(r.state)).toBe('success')
  })

  it('an in-flight run is NO INFORMATION — neither alert nor clear', () => {
    // stryker-weekly takes ~2.5h. Alerting on slowness would be the alert-fatigue
    // failure; clearing on it would be worse.
    const r = assessWorkflow({ ...nightly, runs: [run('2026-09-08T06:05:00Z', null, 'in_progress')], now })
    expect(r.state).toBe('in-flight')
    expect(toAlertConclusion(r.state)).toBe('skipped')
    expect(decideAlert({ workflow: 'x', conclusion: 'skipped', openIssue: { number: 7 }, runUrl: '' }).action).toBe('none')
  })

  it('an unmodellable cadence is a VIOLATION, never a silent skip', () => {
    const r = assessWorkflow({ file: 'x.yml', crons: ['0 1 * * MON'], runs: [], now })
    expect(r.state).toBe('unparseable')
    expect(toAlertConclusion(r.state)).toBe('failure')
  })

  it('a workflow GitHub has never registered is a finding, not a crash', () => {
    // FOUND BY RUNNING IT. The first dry run died with an unhandled 404, because
    // the probe's own file was on disk and not yet on the default branch.
    // Reading the code would not have shown it, and the state is real beyond the
    // bootstrap case: a scheduled workflow Actions has no record of will never
    // fire, which is precisely what this probe exists to notice.
    expect(toAlertConclusion('unregistered')).toBe('failure')
  })

  it('a cron that can never fire is not silently treated as healthy', () => {
    // previousFire returns null rather than throwing for a well-formed
    // expression that simply never matches. 30 February parses fine and fires
    // never; without this branch it would fall through to a due of `null`.
    const r = assessWorkflow({ file: 'x.yml', crons: ['0 0 30 2 *'], runs: [], now: new Date('2026-09-09T14:00:00Z') })
    expect(r.state).toBe('too-early')
    expect(toAlertConclusion(r.state)).toBe('skipped')
  })

  it('an unknown state speaks rather than staying silent', () => {
    // Fail closed, the same way alertDecision's HEALTHY set does. A state added
    // later must not default to silence.
    expect(toAlertConclusion('something-new-and-unhandled' as never)).toBe('failure')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-A22 — the grace window is measured, and both its bounds bite', () => {
  const nightly = { file: 'nightly-backtest.yml', crons: ['0 6 * * 1-5'] }

  it('is wider than the worst dispatch lateness actually observed', () => {
    // Measured across 65 scheduled runs, 2026-08/09: max 11.85h (nightly),
    // medians 0.95-3.43h. The first draft of this constant was 2h, which would
    // have fired on a routine week. Measure the null before setting a threshold.
    expect(GRACE_HOURS).toBeGreaterThan(12)
  })

  it('is narrower than the shortest gap between two due times', () => {
    // At or above 24h a missed weekday nightly is never judged before the next
    // one falls due, and the probe reports healthy silence forever.
    expect(GRACE_HOURS).toBeLessThan(24)
  })

  it('a run dispatched 11.8 hours late is healthy, not an alert', () => {
    const r = assessWorkflow({ ...nightly, runs: [run('2026-09-08T17:51:00Z', 'success')], now: new Date('2026-09-09T14:00:00Z') })
    expect(r.state).toBe('healthy')
  })

  it('ALWAYS has a judgeable fire — the too-early hole is closed', () => {
    // The obvious formulation (take the latest due, bail if inside grace) reports
    // `too-early` EVERY day once grace approaches the cadence: the weekday-06:00
    // nightly is always within 18h at a 14:00 probe, so nothing would ever be
    // judged and the silence would read as health. Shifting the clock back by the
    // grace makes the judged fire the previous one, and there is always one.
    for (const hour of [0, 6, 7, 13, 14, 23]) {
      const r = assessWorkflow({ ...nightly, runs: [], now: new Date(`2026-09-09T${String(hour).padStart(2, '0')}:00:00Z`) })
      expect(r.state).not.toBe('too-early')
      expect(r.due).toBeDefined()
    }
  })

  it('the judged fire really is the PREVIOUS one, not the one inside grace', () => {
    const r = assessWorkflow({ ...nightly, runs: [], now: new Date('2026-09-09T14:00:00Z') })
    expect(r.due).toBe('2026-09-08T06:00:00.000Z')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-A22 — both mechanisms share ONE issue per workflow', () => {
  const title = 'Scheduled workflow failing: nightly-backtest.yml'

  it('the probe comments on an existing thread rather than opening a second', () => {
    const d = decideAlert({
      workflow: 'nightly-backtest.yml', conclusion: 'startup_failure',
      openIssue: { number: 42 }, runUrl: 'u', eventName: 'schedule',
    })
    expect(d.action).toBe('comment')
    expect(d.issue).toBe(42)
  })

  it('the probe may CLOSE a thread the in-workflow alerter opened', () => {
    // Both answer "is this workflow healthy", so either may clear it. This is
    // also what makes a probe false positive self-correcting: the workflow's own
    // next success closes it.
    const d = decideAlert({
      workflow: 'nightly-backtest.yml', conclusion: 'success',
      openIssue: { number: 42 }, runUrl: 'u', eventName: 'schedule',
    })
    expect(d.action).toBe('close')
  })

  it('and it opens under the SAME title the in-workflow alerter uses', () => {
    const d = decideAlert({ workflow: 'nightly-backtest.yml', conclusion: 'failure', openIssue: null, runUrl: 'u', eventName: 'schedule' })
    expect(d.title).toBe(title)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What this probe CANNOT do — passing tests, so a green run is never a proof.
// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-A22 — what this probe CANNOT do', () => {
  it('CANNOT report its own PERMANENT failure — nothing watches the watchman', () => {
    // Stated rather than closed. The probe watches itself along with the rest, so
    // an INTERMITTENT gap is reported by its own next successful run; a permanent
    // one is not reported at all. Closing this needs a second, independent
    // system, which this repository does not have and which would have the same
    // residual one level up.
    expect(scheduled.map((s) => s.file)).toContain('workflow-heartbeat.yml')
  })

  it('CANNOT distinguish a hung run from a slow one WITHIN one period', () => {
    // `in-flight` is no-information by design, so a run stuck inside the period
    // currently being judged reads as no-information. Bounding that needs a
    // per-workflow expected duration — the enumerated table this package
    // deliberately avoided, because such a table goes stale silently.
    const r = assessWorkflow({
      file: 'stryker-weekly.yml', crons: ['0 8 * * 0'],
      runs: [{ createdAt: '2026-09-06T08:30:00Z', status: 'in_progress', conclusion: null }],
      now: new Date('2026-09-08T14:00:00Z'),
    })
    expect(r.state).toBe('in-flight')
  })

  it('but a hung run does NOT mask later missed fires — I understated this', () => {
    // The first draft of the test above used a `now` weeks later and asserted
    // `in-flight`, claiming a hung run silences the probe forever. That was
    // wrong, and wrong in the PESSIMISTIC direction: the judged due advances with
    // the clock, so a run hung three weeks ago no longer counts for the fire
    // being judged and the absence of a newer one is reported. Recording it
    // because a CANNOT-do block that overstates the gap is as misleading as one
    // that hides it — and this one would have taught the next reader to build a
    // duration table they do not need.
    const r = assessWorkflow({
      file: 'stryker-weekly.yml', crons: ['0 8 * * 0'],
      runs: [{ createdAt: '2026-09-06T08:30:00Z', status: 'in_progress', conclusion: null }],
      now: new Date('2026-10-01T14:00:00Z'),
    })
    expect(r.state).toBe('missing')
  })

  it('CANNOT see a workflow that declares no schedule', () => {
    // ci.yml runs on push/pull_request and is out of scope by construction: there
    // is no cadence to be late against.
    expect(scheduled.map((s) => s.file)).not.toContain('ci.yml')
  })

  it('CANNOT tell whether the WORK was correct, only that a run completed green', () => {
    const r = assessWorkflow({
      file: 'refresh-data.yml', crons: ['0 22 * * 0'],
      runs: [{ createdAt: '2026-09-07T00:00:00Z', status: 'completed', conclusion: 'success' }],
      now: new Date('2026-09-09T14:00:00Z'),
    })
    expect(r.state).toBe('healthy')
  })

  it('CANNOT be relied on while GRACE_MS and the probe cadence disagree', () => {
    // Detection latency is bounded by the probe's own cron (daily) plus the
    // grace, so a missed weekday nightly surfaces roughly 32h later, not
    // immediately. That is the trade for not crying wolf; it is not zero.
    expect(GRACE_MS).toBe(GRACE_HOURS * 3_600_000)
  })
})
