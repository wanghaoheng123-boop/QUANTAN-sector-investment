/**
 * Is each scheduled workflow actually running? (Q107-A22)
 *
 * `Q107-O2`'s alerting lives inside the workflow it watches, and a
 * `startup_failure` produces zero jobs — so the alert job never runs and the
 * outage is silent. This decides the same question from OUTSIDE, on the only
 * evidence available to an observer: when a run was due, and what happened since.
 *
 * Pure, like `alertDecision.mjs` beside it, so every branch below is a unit test
 * rather than something only a real outage can exercise.
 */
import { previousFire } from './cronSchedule.mjs'

/**
 * How late a scheduled run may be before its absence is a finding.
 *
 * MEASURED, not guessed — and the first draft of this constant was 2 hours,
 * which would have cried wolf on a routine week. GitHub queues scheduled
 * workflows and dispatches them late under load. Actual lateness across 65
 * scheduled runs of the four watched workflows, 2026-08/09:
 *
 *   workflow               n   max late   median late
 *   nightly-backtest      24     11.85h         1.13h
 *   refresh-data          18      2.19h         0.95h
 *   a11y-axe               9      5.53h         3.43h
 *   stryker-weekly        14      5.69h         2.34h
 *
 * So the null this has to clear is ~12 hours, not two. The same lesson as the
 * benchmark floors: **measure the null before setting a threshold**, or the gate
 * fires on normal behaviour and gets learned-ignored — which for an alerter is
 * worse than not existing, because `alertDecision`'s own doctrine is that alert
 * fatigue is how the next outage goes unread.
 *
 * 18 hours is 1.5x the worst observed lateness and still strictly less than the
 * shortest cadence between two due times (24h, weekday nightly), so a missed fire
 * is always judged before the next one falls due. Both bounds are load-bearing:
 * below ~12h this produces false alerts, at or above 24h a missed nightly is
 * never judged at all.
 *
 * This grace is about the run STARTING. A long run that HAS started is handled by
 * the `in-flight` state, not by this number — `stryker-weekly` takes ~2.5 hours
 * and must not be alerted on merely for being slow.
 */
export const GRACE_HOURS = 18
export const GRACE_MS = GRACE_HOURS * 60 * 60 * 1000

/**
 * @typedef {Object} Run
 * @property {string} createdAt   ISO timestamp
 * @property {string} status      queued | in_progress | completed
 * @property {string|null} conclusion  success | failure | startup_failure | …
 * @property {string} [url]
 */

/**
 * Assess one workflow.
 *
 * States, and why each is separate:
 *  - `unparseable` — the cadence cannot be modelled, so nothing can be claimed.
 *    A violation, never a skip: skipping would leave this workflow unwatched
 *    while the suite stayed green.
 *  - `too-early`   — due, but within the grace window. No information yet.
 *  - `missing`     — due and past grace, and NO run exists at or after the due
 *    time. This is the branch that catches a schedule GitHub has DISABLED for
 *    inactivity, where no run record is ever created and a conclusion-based
 *    check reads the last old run and reports health forever.
 *  - `in-flight`   — a run started but has not completed. Neither alert nor
 *    clear, mirroring `alertDecision`'s INCONCLUSIVE set.
 *  - `unhealthy`   — the run completed and did not succeed. `startup_failure`
 *    lands here, which is the case the in-workflow alerter structurally cannot
 *    report on.
 *  - `healthy`     — a run completed successfully since it was due.
 *
 * @param {{
 *   file: string,
 *   crons: string[],
 *   runs?: Run[],
 *   now: Date,
 *   registeredAt?: string|null,
 *   graceMs?: number,
 * }} input
 */
export function assessWorkflow({ file, crons, runs, now, registeredAt = null, graceMs = GRACE_MS }) {
  if (!Array.isArray(crons) || crons.length === 0) {
    return { file, state: 'unparseable', detail: 'no cron expression found for a workflow listed as scheduled' }
  }

  // The most recent due time that is ALREADY past the grace window — not the most
  // recent due time full stop.
  //
  // The obvious formulation (take the latest due, then bail if it is inside
  // grace) has a hole that only appears once grace approaches the cadence: with
  // an 18h grace and a probe running daily, the weekday-06:00 nightly is ALWAYS
  // within grace at probe time, so it would report `too-early` every single day
  // and never judge anything — a guard with no reachable verdict, reported as
  // healthy silence. Shifting the clock back by the grace instead makes the
  // judged fire always the previous one, and there is always exactly one.
  const asOf = new Date(now.getTime() - graceMs)
  let due = null
  for (const expr of crons) {
    let fired
    try {
      fired = previousFire(expr, asOf)
    } catch (err) {
      return { file, state: 'unparseable', detail: `cannot model cadence "${expr}": ${err.message}` }
    }
    if (fired === null) {
      // A well-formed expression that never matches — 30 February parses fine and
      // fires never. This was `too-early`, i.e. SILENCE, ratified by a test whose
      // own title said it was not silently treated as healthy. A cadence that can
      // never fire is a workflow nobody is watching, which is a violation.
      return { file, state: 'unparseable', detail: `"${expr}" has no fire time within the lookback window — it can never run` }
    }
    // A workflow may declare several crons; the most recent one is what is owed.
    if (due === null || fired.getTime() > due.getTime()) due = fired
  }

  const dueIso = due.toISOString()

  // A workflow cannot have run before it existed.
  //
  // FOUND IN PRODUCTION, on this probe's own first CI run: it opened an alert
  // against ITSELF, correctly reporting no run since the previous 14:00 — the
  // workflow had been merged minutes earlier and had no scheduled history at
  // all. Technically true and operationally useless: every newly merged
  // scheduled workflow would raise a false alarm on day one, which is the alert
  // fatigue this whole design is trying to avoid. `registeredAt` comes from the
  // Actions API's own `created_at` for the workflow, so this is a measurement
  // rather than a heuristic about file age.
  if (registeredAt !== null) {
    const born = Date.parse(registeredAt)
    if (Number.isFinite(born) && born > due.getTime()) {
      return {
        file,
        state: 'too-early',
        due: dueIso,
        detail: `registered ${registeredAt}, after the fire due ${dueIso} — it did not exist yet`,
      }
    }
  }

  // The window is BOUNDED AT BOTH ENDS, and the first version was not.
  //
  // Opening it at `due` and taking the newest run looks right and is the
  // package's worst bug: because the clock is shifted back by the grace, the
  // open-ended window spans 32h and CONTAINS THE NEXT FIRE, whose run then
  // supplies the verdict for the fire under judgement. Measured on the committed
  // module — a missed Tuesday nightly with a healthy Wednesday returned
  // `healthy`, and an isolated `startup_failure` followed by a good day returned
  // `healthy` too. That is the exact case this package exists to catch, reported
  // as fine, by the probe built to catch it.
  //
  // It failed silently because every fixture in the first test suite supplied
  // only runs belonging to the judged fire, so the unbounded end was never
  // exercised: 33 tests green on a probe that could not see an isolated miss.
  // A run belongs to this fire only if it started within the grace it is allowed.
  const windowEnd = due.getTime() + graceMs
  const since = (runs ?? [])
    .filter((r) => {
      const t = Date.parse(r.createdAt)
      return t >= due.getTime() && t <= windowEnd
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  if (since.length === 0) {
    return {
      file,
      state: 'missing',
      due: dueIso,
      detail:
        `no run has been created since it was due at ${dueIso}. ` +
        `Either the schedule did not fire, or GitHub has disabled it — scheduled triggers are disabled ` +
        `after 60 days of repository inactivity, and that produces no run record at all.`,
    }
  }

  const latest = since[0]
  if (latest.status !== 'completed') {
    return { file, state: 'in-flight', due: dueIso, detail: `a run started ${latest.createdAt} and is ${latest.status}` }
  }
  if (latest.conclusion === 'success') {
    return { file, state: 'healthy', due: dueIso, detail: `succeeded ${latest.createdAt}` }
  }
  return {
    file,
    state: 'unhealthy',
    due: dueIso,
    conclusion: latest.conclusion,
    detail:
      `the run due ${dueIso} concluded \`${latest.conclusion || '(empty)'}\`` +
      (latest.conclusion === 'startup_failure'
        ? ' — a startup_failure produces zero jobs, so the workflow\'s own alert job could not run. This probe is the only thing that can report it.'
        : '') +
      (latest.url ? ` ${latest.url}` : ''),
  }
}

/**
 * Map an assessment onto the conclusion vocabulary `alertDecision` already
 * understands, so both mechanisms share ONE issue per workflow.
 *
 * That sharing is deliberate. `decideAlert` dedupes on title + marker, so a
 * watchdog finding and a real in-workflow failure land on the same thread, and
 * whichever mechanism next sees a success closes it. A distinct label per
 * mechanism would defeat the dedupe and produce two issues per outage.
 *
 * `too-early` and `in-flight` map to `skipped`, which `decideAlert` treats as
 * INCONCLUSIVE: it neither opens nor closes. Absence of information must not
 * read as recovery.
 */
export function toAlertConclusion(state, conclusion) {
  switch (state) {
    case 'healthy':
      return 'success'
    case 'too-early':
    case 'in-flight':
      return 'skipped'
    case 'missing':
      return 'failure'
    case 'unparseable':
      return 'failure'
    case 'unregistered':
      // GitHub Actions has no record of the workflow, so its schedule cannot
      // fire at all. Found by RUNNING the probe, not by reading it.
      return 'failure'
    case 'unhealthy':
      // Pass the real conclusion through — `startup_failure` is not `failure`,
      // and alertDecision reports an unrecognised conclusion rather than
      // swallowing it.
      return conclusion || 'failure'
    default:
      // A state this function does not know about must speak, not stay silent.
      return 'failure'
  }
}

/** Assess every watched workflow. */
export function assessAll({ workflows, now, graceMs = GRACE_MS }) {
  return workflows.map((w) => assessWorkflow({ ...w, now, graceMs }))
}
