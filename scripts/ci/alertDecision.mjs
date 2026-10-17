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
 * 2b. **One comment per failure, not per look (Q-113).** The daily heartbeat
 *    probe re-assesses every workflow every day, so a weekly workflow that
 *    stayed broken drew a comment a DAY about the same failed run — issue #177
 *    collected 44 comments in 41 days for a handful of distinct weekly
 *    failures. A comment now carries a dedupe key (the failing run's URL, or the
 *    missed fire's due time), and a key already present in the thread is not
 *    reported again. No throttle period is invented: the "period" is the
 *    workflow's own cadence, because a new failure is a new run.
 *    Not every state has a key: `unparseable` and `unregistered` have no failing
 *    run and no due time, so the probe still comments on them on every look.
 *    That is deliberate — each is a workflow nobody is watching, and the remedy
 *    is a code change, not patience.
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
 * The dedupe key for a failing run: its URL, plus the attempt when it was re-run.
 *
 * Red-team A2 (2026-10-17): a re-run keeps its run id, so a re-run that failed a
 * DIFFERENT way was suppressed as "already reported" and the thread kept showing
 * the first cause as live. A first attempt keeps the bare URL, so every comment
 * written before this change still matches.
 *
 * Red-team A4: undefined when the URL carries no run id — an empty id
 * (`…/actions/runs/`) is a prefix of every run URL and would match them all.
 */
export function alertKeyFor(runUrl, attempt) {
  if (typeof runUrl !== 'string' || !/\/actions\/runs\/\d+$/.test(runUrl)) return undefined
  const n = Number(attempt)
  return Number.isInteger(n) && n > 1 ? `${runUrl}#attempt-${n}` : runUrl
}

/** The marker a comment carries so a later look can find its key exactly. */
export const keyToken = (key) => `<!-- alert-key: ${key} -->`

/**
 * Whether a thread already reports `key` — as a DELIMITED token, not a substring
 * (red-team A4): `…/runs/111` must not match `…/runs/1111`, and the bare first
 * attempt must not match `…#attempt-2`. Comments written before keys were
 * embedded carry the run URL in their text, which the delimited match still finds.
 */
export function threadHasKey(thread, key) {
  if (!key) return false
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bare = new RegExp(`${esc}(?![\\w/#-])`)
  return (thread ?? []).some((t) => typeof t === 'string' && (t.includes(keyToken(key)) || bare.test(t)))
}

/** Comments per page when reading a thread, and the most pages read. */
export const THREAD_PAGE_SIZE = 100
export const THREAD_MAX_PAGES = 10

/**
 * An alert issue's body and comments, NEWEST pages first.
 *
 * Shared by both runners so the behaviour is tested once (red-team A1: the
 * dedupe was wired only in untested runner code). Two properties:
 *
 * - On ANY error it returns an empty thread with the error, so the caller SPEAKS
 *   — a possible duplicate — rather than stalling (red-team A3: one failed read
 *   stopped every later workflow, recovery closes included). For an alerter the
 *   fail-closed direction is to talk.
 * - GitHub lists comments oldest first; `issue.comments` gives the count, so the
 *   newest pages are read and a long thread does not hide its latest keys (A4).
 */
export async function readThread(gh, repo, issue) {
  if (!issue) return { thread: [], error: null }
  const thread = [issue.body ?? '']
  const count = Number.isInteger(issue.comments) ? issue.comments : null
  const last = count === null ? null : Math.max(1, Math.ceil(count / THREAD_PAGE_SIZE))
  try {
    for (let i = 0; i < THREAD_MAX_PAGES; i++) {
      const page = last === null ? i + 1 : last - i
      if (page < 1) break
      const batch = await gh(`/repos/${repo}/issues/${issue.number}/comments?per_page=${THREAD_PAGE_SIZE}&page=${page}`)
      if (!Array.isArray(batch)) throw new Error(`comments page ${page} was not a list`)
      thread.push(...batch.map((c) => (c && typeof c.body === 'string' ? c.body : '')))
      if (last === null && batch.length < THREAD_PAGE_SIZE) break
    }
    return { thread, error: null }
  } catch (e) {
    return { thread: [], error: e instanceof Error ? e.message : String(e) }
  }
}

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
 * @param {string} [input.dedupeKey] identifies THIS failure (e.g. the failing run's URL)
 * @param {string[]} [input.thread] the open issue's body and comment bodies
 * @returns {{action:'create'|'comment'|'close'|'none', title?:string, body?:string, issue?:number, reason?:string}}
 */
export function decideAlert({ workflow, conclusion, openIssue, runUrl, detail, eventName, dedupeKey, thread }) {
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

  // Every alert carries its key as an exact token, so the next look matches it
  // exactly rather than by substring (red-team A4).
  const keyed = dedupeKey ? `${body}\n\n${keyToken(dedupeKey)}` : body
  if (openIssue) {
    // Q-113: this failure is already on the thread — say nothing new.
    if (threadHasKey(thread, dedupeKey)) return { action: 'none', reason: 'already reported' }
    return { action: 'comment', issue: openIssue.number, body: keyed }
  }
  return { action: 'create', title: alertTitle(workflow), body: keyed }
}
