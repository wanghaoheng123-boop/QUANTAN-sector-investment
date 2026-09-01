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
 * @param {object} input
 * @param {string} input.workflow    workflow file name, e.g. 'refresh-data.yml'
 * @param {'success'|'failure'|'cancelled'|'skipped'} input.conclusion
 * @param {{number:number}|null} input.openIssue  existing open alert issue, if any
 * @param {string} input.runUrl
 * @param {string} [input.detail]    one line of context, e.g. the quarantine reason
 * @returns {{action:'create'|'comment'|'close'|'none', title?:string, body?:string, issue?:number}}
 */
export function decideAlert({ workflow, conclusion, openIssue, runUrl, detail }) {
  const failed = conclusion === 'failure'

  if (!failed) {
    // `cancelled` and `skipped` deliberately do NOT close an open alert: a
    // cancelled run is not evidence the pipeline recovered, and treating it as
    // recovery would silently clear a live outage.
    if (conclusion === 'success' && openIssue) {
      return {
        action: 'close',
        issue: openIssue.number,
        body:
          `Recovered — \`${workflow}\` succeeded.\n\n${runUrl}\n\n` +
          'Closing automatically. If this reopens weekly, the underlying cause is not fixed; ' +
          'read the run history rather than the latest run.',
      }
    }
    return { action: 'none' }
  }

  const context = detail ? `\n\n**What the run said:** ${detail}\n` : '\n'
  const body =
    `${ALERT_MARKER}\n\n` +
    `\`${workflow}\` failed.\n\n${runUrl}\n${context}\n` +
    '---\n\n' +
    'This issue exists because a scheduled workflow can fail silently for weeks. ' +
    '`refresh-data.yml` did exactly that between 2026-08-23 and 2026-08-30 — the data ' +
    'pipeline was dead and the benchmark went on reading frozen fixtures.\n\n' +
    '**It will close itself when the workflow next succeeds.** Repeated failures comment ' +
    'here rather than opening new issues, so if this thread is long, the problem is old.'

  if (openIssue) return { action: 'comment', issue: openIssue.number, body }
  return { action: 'create', title: alertTitle(workflow), body }
}
