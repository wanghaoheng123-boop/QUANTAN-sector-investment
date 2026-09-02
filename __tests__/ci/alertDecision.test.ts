/**
 * Q107-O2 — a scheduled workflow that fails silently.
 *
 * `refresh-data.yml` broke on 2026-08-23 and ran dead for a fortnight. Nothing
 * told anyone; it was found by an agent reading run history during an unrelated
 * review, by which point the benchmark had been reading frozen fixtures for two
 * weeks. These tests cover the decision that closes that gap.
 *
 * The decision is a pure function precisely so that every branch is exercised
 * here rather than only by a real outage — an alert path first executed during
 * an incident is an alert path nobody has tested.
 */
import { describe, it, expect } from 'vitest'
// Plain .mjs so the workflow can run it with no build step, same idiom as
// scripts/lib/dataVintage.mjs.
import { decideAlert, alertTitle, ALERT_MARKER } from '../../scripts/ci/alertDecision.mjs'

const base = { workflow: 'refresh-data.yml', runUrl: 'https://example/run/1' }

describe('scheduled failure alert — opens, dedupes, and clears itself', () => {
  it('opens an issue on the first failure', () => {
    const d = decideAlert({ ...base, conclusion: 'failure', openIssue: null })
    expect(d.action).toBe('create')
    expect(d.title).toBe(alertTitle('refresh-data.yml'))
    expect(d.body).toContain(ALERT_MARKER)
    expect(d.body).toContain(base.runUrl)
  })

  it('COMMENTS rather than opening a second issue when one is already open', () => {
    // A weekly cron would otherwise open 52 issues a year, and alert fatigue is
    // how the next outage goes unread.
    const d = decideAlert({ ...base, conclusion: 'failure', openIssue: { number: 7 } })
    expect(d.action).toBe('comment')
    expect(d.issue).toBe(7)
  })

  it('closes the issue when the workflow recovers', () => {
    // An alert that never clears is indistinguishable from a live one.
    const d = decideAlert({ ...base, conclusion: 'success', openIssue: { number: 7 } })
    expect(d.action).toBe('close')
    expect(d.issue).toBe(7)
    expect(d.body).toMatch(/Recovered/)
  })

  it('does nothing when a success has no open alert', () => {
    expect(decideAlert({ ...base, conclusion: 'success', openIssue: null }).action).toBe('none')
  })

  it.each(['cancelled', 'skipped'] as const)(
    'does NOT treat %s as recovery, even with an alert open',
    (conclusion) => {
      // A cancelled run is not evidence the pipeline came back. Closing on it
      // would silently clear a live outage — the exact failure being fixed.
      expect(decideAlert({ ...base, conclusion, openIssue: { number: 7 } }).action).toBe('none')
    },
  )

  it('carries the run detail into the body, so the issue says WHICH red this was', () => {
    const d = decideAlert({
      ...base,
      conclusion: 'failure',
      openIssue: null,
      detail: 'Instruments were QUARANTINED by the vintage guard. Clean fixtures WERE committed.',
    })
    expect(d.body).toContain('QUARANTINED')
  })

  it('gives each workflow its own issue title, so two outages do not merge', () => {
    // The previous version asserted alertTitle(a) !== alertTitle(b), which only
    // says string concatenation is injective — a tautology, not a property of
    // this system. What actually merges two outages is a CALLER passing the wrong
    // `workflow` input, and that is checked in the architecture suite (M16).
    // What belongs here is that the title carries the workflow identity, so a
    // reader and the dedupe lookup can both tell which pipeline is down.
    expect(alertTitle('refresh-data.yml')).toContain('refresh-data.yml')
    expect(alertTitle('stryker-weekly.yml')).toContain('stryker-weekly.yml')
  })

  it('ALERTS on a conclusion it does not recognise, rather than going quiet', () => {
    // Fail closed. The first version returned `none` for anything that was not
    // exactly 'failure', so timed_out, startup_failure and an empty string from a
    // broken expression all produced SILENCE from an alerter — the bug wearing
    // the fix's clothes.
    for (const conclusion of ['timed_out', 'startup_failure', 'action_required', '']) {
      expect(decideAlert({ ...base, conclusion, openIssue: null }).action, conclusion).toBe('create')
    }
  })

  it('only a SCHEDULED success closes the issue', () => {
    // A manual re-run succeeding says nothing about whether the schedule works.
    expect(decideAlert({ ...base, conclusion: 'success', openIssue: { number: 7 }, eventName: 'workflow_dispatch' }).action).toBe('none')
    expect(decideAlert({ ...base, conclusion: 'success', openIssue: { number: 7 }, eventName: 'schedule' }).action).toBe('close')
  })
})
