/**
 * What to do about a scheduled workflow run (Q107-O2).
 *
 * The finding this closes: NOTHING in this repository notified anyone when a
 * scheduled job failed. `refresh-data.yml` broke on 2026-08-23, refused 36 of 56
 * tickers, and ran dead for a fortnight while CI and the benchmark went on reading
 * frozen fixtures. It was found by an agent reading run history during an unrelated
 * review. GitHub's own email exists but had evidently not been acted on.
 *
 * Three design choices, each with a reason:
 *
 * 1. **A GitHub Issue, not a webhook.** A webhook needs an owner-provisioned
 *    secret, and this project has an open P0 (`Q-005`) that has been blocked on
 *    exactly that for months. An alert nobody can turn on is worse than none,
 *    because it looks handled.
 *
 * 2. **Deduplicated.** A weekly failure must not open 52 issues; the second and
 *    later failures comment on the first. Alert fatigue is how the next outage
 *    goes unread.
 *
 * 3. **Auto-closing on recovery.** An alert that never clears trains people to
 *    ignore it, and a stale open issue is indistinguishable from a live one. The
 *    close is the signal that the pipeline came back.
 *
 * Pure on purpose: the runner does the I/O, so every branch below is a unit test
 * rather than something only a real outage can exercise.
 */

/** Marker in the issue body so the runner can find its own issues without a label. */
export const ALERT_MARKER = '<!-- quantan-scheduled-alert -->'

export const alertTitle = (workflow) => `Scheduled workflow failing: ${workflow}`

/**
 * Conclusions that mean "healthy". Everything else alerts.
 *
 * FAIL CLOSED, and the first version did not. It tested `conclusion === 'failure'`
 * and returned `none` for anything else — so `timed_out`, `startup_failure`,
 * `action_required`, an empty string from a broken expression, or any state
 * GitHub adds later produced SILENCE from an alerting system. Silence is
 * indistinguishable from health, which is the entire defect this package exists
 * to fix; getting it backwards here would have been the bug wearing the fix's
 * clothes. I2 says fail closed, and for an alerter the closed state is ALERT.
 */
const HEALTHY = 'success'

/**
 * Conclusions that are neither health nor failure: the run did not report on the
 * pipeline at all. They must not alert (a cancelled run is not a broken one) and
 * must not clear (it is not evidence of recovery either).
 */
const INCONCLUSIVE = new Set(['cancelled', 'skipped'])

/**
 * @param {object} input
 * @param {string} input.workflow    workflow file name, e.g. 'refresh-data.yml'
 * @param {string} input.conclusion  success | failure | cancelled | skipped | timed_out | …
 * @param {{number:number}|null} input.openIssue  existing open alert issue, if any
 * @param {string} input.runUrl
 * @param {string} [input.detail]    one line of context, e.g. the quarantine reason
 * @param {string} [input.eventName] the triggering event; only a scheduled run may CLOSE
 * @returns {{action:'create'|'comment'|'close'|'none', title?:string, body?:string, issue?:number}}
 */
export function decideAlert({ workflow, conclusion, openIssue, runUrl, detail, eventName }) {
  if (conclusion === HEALTHY) {
    // Only a SCHEDULED run may close. A manual `workflow_dispatch` succeeds the
    // moment someone re-runs it by hand, which says nothing about whether the
    // schedule works — closing on it would clear a live outage on the strength of
    // a human poking it once.
    if (openIssue && (eventName === undefined || eventName === 'schedule')) {
      return {
        action: 'close',
        issue: openIssue.number,
        body:
          `Recovered — \`${workflow}\` succeeded on its schedule.\n\n${runUrl}\n\n` +
          'Closing automatically. If this reopens weekly, the underlying cause is not fixed; ' +
          'read the run history rather than the latest run.',
      }
    }
    return { action: 'none' }
  }

  if (INCONCLUSIVE.has(conclusion)) return { action: 'none' }

  const unknown = conclusion !== 'failure'
  const context = detail ? `\n\n**What the run said:** ${detail}\n` : '\n'
  const body =
    `${ALERT_MARKER}\n\n` +
    `\`${workflow}\` did not succeed — conclusion \`${conclusion || '(empty)'}\`.\n\n${runUrl}\n${context}\n` +
    (unknown
      ? '> This conclusion is not one this alerter recognises. It is reported rather than ignored, ' +
        'deliberately: for an alerting system the safe default is to speak.\n\n'
      : '') +
    '---\n\n' +
    'This issue exists because a scheduled workflow can fail silently for weeks. ' +
    '`refresh-data.yml` did exactly that between 2026-08-23 and 2026-08-30 — the data ' +
    'pipeline was dead and the benchmark went on reading frozen fixtures.\n\n' +
    '**It will close itself when the workflow next succeeds on schedule.** Repeated failures ' +
    'comment here rather than opening new issues, so if this thread is long, the problem is old.'

  if (openIssue) return { action: 'comment', issue: openIssue.number, body }
  return { action: 'create', title: alertTitle(workflow), body }
}
