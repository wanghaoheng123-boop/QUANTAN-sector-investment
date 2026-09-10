/**
 * When was a scheduled workflow last DUE to run? (Q107-A22)
 *
 * The alerting built by `Q107-O2` lives *inside* the workflow it watches, so it
 * cannot fire when that workflow fails to start: a `startup_failure` produces
 * ZERO jobs, so no job of any kind runs — including the alert job. Measured:
 * `nightly-backtest` ran `startup_failure` on 2026-09-03 and 2026-09-04 and
 * nothing notified anyone; across the last 60 runs of each workflow there are
 * four such instances (nightly-backtest ×2, refresh-data ×2). It was found by a
 * human reading run history during an unrelated review.
 *
 * Closing that needs an OUT-OF-BAND check, and the check has to be framed on
 * **when a run was DUE**, not on the conclusions of the runs that exist. The
 * reason is a failure mode that leaves no run record at all: **GitHub disables
 * `schedule` triggers after 60 days of repository inactivity.** A conclusion-based
 * check reads the last old run, finds it green, and reports health forever. Only
 * "there should have been a run by now, and there was not" sees it.
 *
 * So this module answers one question — given a cron expression and a moment,
 * when should it most recently have fired? — and is pure so that every branch is
 * a unit test rather than something only an outage can exercise.
 *
 * All times are UTC, because GitHub Actions cron is UTC and nothing here should
 * inherit a runner's locale.
 */

/**
 * Fields this parser models. Anything else is REFUSED rather than guessed.
 *
 * Fail closed: an expression we cannot model is a cadence we cannot watch, and
 * silently skipping it would leave the rule with zero instances for that
 * workflow — the guard-reachability defect this repository has now shipped
 * seven times. The caller turns a parse failure into a violation, and a test
 * asserts every cron currently in `.github/workflows/` parses, so the rule has
 * reachable instances on the real tree and not only in fixtures.
 *
 * Named months and weekdays (`JAN`, `MON`), `?`, `L`, `W` and `#` are refused.
 * GitHub itself rejects some of those, but refusing is the safe direction for
 * all of them.
 */
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 6 },
]

/** Parse one field into a Set of matching values, or throw. */
function parseField(raw, { name, min, max }) {
  const wildcard = raw === '*'
  const out = new Set()
  for (const part of raw.split(',')) {
    const step = /^(.+)\/(\d+)$/.exec(part)
    const body = step ? step[1] : part
    const stride = step ? Number(step[2]) : 1
    if (stride < 1) throw new Error(`cron ${name}: step must be >= 1 in "${part}"`)

    let lo
    let hi
    if (body === '*') {
      lo = min
      hi = max
    } else {
      const range = /^(\d+)-(\d+)$/.exec(body)
      if (range) {
        lo = Number(range[1])
        hi = Number(range[2])
      } else if (/^\d+$/.test(body)) {
        lo = Number(body)
        hi = lo
      } else {
        throw new Error(`cron ${name}: unsupported syntax "${part}"`)
      }
    }
    // Sunday is 0; GitHub also accepts 7 for Sunday.
    if (name === 'dow' && lo === 7) lo = 0
    if (name === 'dow' && hi === 7) hi = 0
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron ${name}: "${part}" out of range ${min}-${max}`)
    }
    for (let v = lo; v <= hi; v += stride) out.add(v)
  }
  return { values: out, wildcard }
}

/** Parse a 5-field cron expression. Throws on anything it cannot model. */
export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron: expected 5 fields, got ${parts.length} in "${expr}"`)
  const parsed = {}
  parts.forEach((raw, i) => {
    parsed[FIELDS[i].name] = parseField(raw, FIELDS[i])
  })
  return parsed
}

/** Does this UTC date match the day part of the cron? */
function dayMatches(cron, date) {
  if (!cron.month.values.has(date.getUTCMonth() + 1)) return false
  const domOk = cron.dom.values.has(date.getUTCDate())
  const dowOk = cron.dow.values.has(date.getUTCDay())
  // Cron's oddest rule, implemented rather than assumed: when BOTH day-of-month
  // and day-of-week are restricted, they are OR-ed, not AND-ed. Every cron in
  // this repository leaves dom as `*`, so this branch has no instance here — it
  // is covered by a fixture test so that adding one does not silently change
  // what "due" means.
  if (cron.dom.wildcard && cron.dow.wildcard) return true
  if (cron.dom.wildcard) return dowOk
  if (cron.dow.wildcard) return domOk
  return domOk || dowOk
}

/** How far back to search before declaring no prior fire. */
const MAX_LOOKBACK_DAYS = 400

/**
 * The most recent instant at or before `now` at which this cron was due.
 *
 * Returns `null` if it was not due within {@link MAX_LOOKBACK_DAYS} — which for
 * every cadence in this repository means something is wrong with the expression
 * rather than with the schedule.
 */
export function previousFire(expr, now) {
  const cron = parseCron(expr)
  const hours = [...cron.hour.values].sort((a, b) => b - a)
  const minutes = [...cron.minute.values].sort((a, b) => b - a)

  for (let back = 0; back <= MAX_LOOKBACK_DAYS; back++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    day.setUTCDate(day.getUTCDate() - back)
    if (!dayMatches(cron, day)) continue
    for (const h of hours) {
      for (const m of minutes) {
        const when = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m))
        if (when.getTime() <= now.getTime()) return when
      }
    }
  }
  return null
}

/**
 * Every `- cron:` expression in a workflow source.
 *
 * Text-scanned rather than YAML-parsed for the same reason as
 * `__tests__/architecture/workflowCheckNames.ts`: adding a YAML dependency to
 * read one key would oblige an I8 vendor-licence register row. `actionlint`
 * (`npm run lint:workflows`) is the schema authority, and a test asserts this
 * scanner finds every cron actually present in `.github/workflows/`.
 */
export function extractCrons(source) {
  const out = []
  let inSchedule = false
  for (const line of String(source).replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*schedule:\s*(?:#.*)?$/.test(line)) {
      inSchedule = true
      continue
    }
    if (!inSchedule) continue
    if (/^\s*(?:#.*)?$/.test(line)) continue
    const m = /^\s*-\s*cron:\s*(.+?)\s*$/.exec(line)
    if (m) {
      out.push(m[1].replace(/\s+#.*$/, '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2'))
      continue
    }
    // Any other non-blank line at or below the schedule key ends the block.
    inSchedule = false
  }
  return out
}
