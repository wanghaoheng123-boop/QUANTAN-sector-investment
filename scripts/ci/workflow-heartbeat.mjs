#!/usr/bin/env node
/**
 * Out-of-band probe for scheduled workflows (Q107-A22).
 *
 * `Q107-O2`'s alerting lives INSIDE the workflow it watches. A `startup_failure`
 * produces zero jobs, so the alert job never runs and the outage is silent —
 * measured on `nightly-backtest` on 2026-09-03 and 2026-09-04, found days later
 * by a human reading run history. This runs somewhere else and asks a question
 * the inside cannot: was a run DUE, and did one happen?
 *
 * All decisions live in `heartbeatDecision.mjs` and `cronSchedule.mjs` and are
 * unit tested; this file is the I/O shell, kept thin so there is little here a
 * test cannot see. It reuses `alertDecision.mjs` so both mechanisms share ONE
 * issue per workflow and either can close it.
 *
 * WHO WATCHES THE WATCHMAN: nothing does, and this file does not pretend
 * otherwise. It watches itself along with everything else, which means an
 * INTERMITTENT failure of this probe is reported by its own next successful run;
 * a PERMANENT one is not reported at all. The compensating properties are that
 * it is small, has no dependencies beyond the API, and shares no trigger with the
 * workflows it watches — so the correlated failure that made Q107-A22 possible
 * (the alert dying with the thing it watched) cannot recur in the same way.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { extractCrons } from './cronSchedule.mjs'
import { assessAll, toAlertConclusion } from './heartbeatDecision.mjs'
import { decideAlert, alertTitle, alertKeyFor, readThread, ALERT_MARKER } from './alertDecision.mjs'
import { makeGh } from './githubApi.mjs'

/**
 * One API workflow run, as the decision code reads it. Exported so the attempt
 * mapping is tested (red-team R2-236-1: `attempt: undefined` here left every
 * test green and silenced the probe on a re-run).
 */
export const toWatchedRun = (r) => ({
  createdAt: r.created_at,
  status: r.status,
  conclusion: r.conclusion,
  url: r.html_url,
  attempt: r.run_attempt,
})

/**
 * Act on assessed results: open, comment on, or close each workflow's alert
 * issue. Exported with its I/O injected so a test can drive it (red-team A1).
 *
 * One workflow's failure does not stop the rest (red-team A3): before, a single
 * failed GET on one thread aborted the loop, so later workflows were neither
 * alerted nor closed on recovery that day. Errors are collected and returned,
 * and the caller exits non-zero.
 *
 * @param {{
 *   results: Array<Record<string, any>>,
 *   gh: (path: string, init?: { method?: string, body?: string }) => Promise<any>,
 *   repo: string,
 *   runUrl: string,
 *   log?: Pick<Console, 'log' | 'warn' | 'error'>,
 * }} args
 */
export async function actOnResults({ results, gh, repo, runUrl, log = console }) {
  // Paginated, and pull requests excluded — /issues returns BOTH, and a PR whose
  // title happened to match would be "commented on" as if it were the alert
  // thread. `notify-scheduled-failure.mjs` does both and documents them as
  // verified against this repo.
  const openIssues = []
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`)
    openIssues.push(...batch.filter((i) => !i.pull_request))
    if (batch.length < 100) break
  }
  const findIssue = (title) =>
    openIssues.find((i) => i.title === title && (i.body ?? '').includes(ALERT_MARKER)) ?? null

  const acted = []
  const errors = []
  for (const r of results) {
    try {
      const conclusion = toAlertConclusion(r.state, r.conclusion)
      const openIssue = findIssue(alertTitle(r.file))
      let thread = []
      if (conclusion !== 'success' && openIssue) {
        const read = await readThread(gh, repo, openIssue)
        if (read.error) log.warn(`could not read #${openIssue.number}'s thread (${read.error}); reporting ${r.file} without dedupe`)
        thread = read.thread
      }
      const decision = decideAlert({
        workflow: r.file,
        conclusion,
        openIssue,
        // Q-113: key the alert to the failing run and attempt (the same key the
        // in-workflow notifier derives), or to the missed fire, so the same
        // weekly failure is not re-reported every day by this daily probe.
        dedupeKey: alertKeyFor(r.runUrl, r.runAttempt) ?? (r.due ? `${r.state}:${r.file}:${r.due}` : undefined),
        thread,
        runUrl,
        detail: `[heartbeat] ${r.detail}`,
        // This probe runs on a schedule, so it is permitted to close a recovered
        // alert — including one the in-workflow alerter opened. Both mechanisms
        // answer "is this workflow healthy", so either may clear it.
        eventName: 'schedule',
      })

      if (decision.action === 'none') {
        if (decision.reason) log.log(`no comment for ${r.file}: ${decision.reason}`)
        continue
      }
      if (decision.action === 'create') {
        const created = await gh(`/repos/${repo}/issues`, {
          method: 'POST',
          body: JSON.stringify({ title: decision.title, body: decision.body }),
        })
        log.log(`opened #${created.number} for ${r.file}`)
      } else if (decision.action === 'comment') {
        await gh(`/repos/${repo}/issues/${decision.issue}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: decision.body }),
        })
        log.log(`commented on #${decision.issue} for ${r.file}`)
      } else if (decision.action === 'close') {
        await gh(`/repos/${repo}/issues/${decision.issue}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: decision.body }),
        })
        await gh(`/repos/${repo}/issues/${decision.issue}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed' }),
        })
        log.log(`closed #${decision.issue} for ${r.file}`)
      }
      acted.push({ file: r.file, action: decision.action })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error(`workflow-heartbeat: could not act on ${r.file}: ${msg}`)
      errors.push({ file: r.file, error: msg })
    }
  }
  return { acted, errors }
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const dryRun = process.env.HEARTBEAT_DRY_RUN === '1'

  if (!token || !repo) {
    console.error('workflow-heartbeat: missing GITHUB_TOKEN / GITHUB_REPOSITORY')
    process.exit(1)
  }

  const gh = makeGh(token)

  // ── what to watch ────────────────────────────────────────────────────────────
  // Derived from the tree, never enumerated: any workflow declaring a `schedule:`
  // is watched, so a scheduled workflow added later is covered without an edit
  // here. An enumerated list is the artifact that goes stale silently.
  const DIR = '.github/workflows'
  const watched = readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, source: readFileSync(join(DIR, f), 'utf8') }))
    // A workflow that DECLARES a schedule is watched even if no cron could be read
    // from it — dropping those made the `unparseable` state unreachable in
    // production, so a scheduled workflow with a cron this scanner cannot see was
    // silently unwatched while the suite stayed green. Membership is decided by the
    // `schedule:` key, which is the thing that makes GitHub run it; the crons are
    // what we then try to model.
    .filter((w) => /^\s*schedule:\s*(?:#.*)?$/m.test(w.source))
    .map((w) => ({ file: w.file, crons: extractCrons(w.source) }))

  if (watched.length === 0) {
    console.error('workflow-heartbeat: found NO scheduled workflows — the probe has nothing to watch, which is a defect in the probe, not health')
    process.exit(1)
  }

  const now = new Date()

  // When GitHub first registered each workflow, so a newly merged one is not
  // alerted on for fires that predate its existence. One request, not one per
  // workflow.
  const registry = new Map()
  for (const w of (await gh(`/repos/${repo}/actions/workflows?per_page=100`)).workflows ?? []) {
    registry.set(w.path.replace(/^\.github\/workflows\//, ''), w.created_at)
  }

  const withRuns = []
  const unregistered = []
  for (const w of watched) {
    let data
    try {
      data = await gh(`/repos/${repo}/actions/workflows/${encodeURIComponent(w.file)}/runs?per_page=20&event=schedule`)
    } catch (err) {
      // A scheduled workflow GitHub has never heard of will never run, so this is
      // a finding rather than an error to crash on — FOUND BY RUNNING IT: the first
      // dry run died on exactly this, because the probe's own file was on disk and
      // not yet on the default branch. Reading the code would not have shown it.
      //
      // It resolves itself once the file is merged and registered, and alerting
      // meanwhile is the safe direction: the alternative is a scheduled workflow
      // nobody watches because the watcher could not see it.
      if (!String(err.message).includes('-> 404')) throw err
      unregistered.push({
        file: w.file,
        state: 'unregistered',
        detail:
          'GitHub Actions has no record of this workflow, so its schedule cannot fire. ' +
          'Expected on a branch before the file reaches the default branch; a finding anywhere else.',
      })
      continue
    }
    withRuns.push({
      ...w,
      registeredAt: registry.get(w.file) ?? null,
      runs: (data.workflow_runs ?? []).map(toWatchedRun),
    })
  }

  const results = [...assessAll({ workflows: withRuns, now }), ...unregistered]

  // ── report, then act ─────────────────────────────────────────────────────────
  let unhealthy = 0
  for (const r of results) {
    const flag = ['missing', 'unhealthy', 'unparseable', 'unregistered'].includes(r.state) ? 'ALERT ' : '      '
    console.log(`${flag}${r.state.padEnd(12)} ${r.file.padEnd(28)} ${r.detail}`)
    if (flag.trim()) unhealthy++
  }
  console.log(`\nwatched ${results.length} scheduled workflow(s); ${unhealthy} need attention`)

  if (dryRun) {
    console.log('HEARTBEAT_DRY_RUN=1 — no issues written')
    process.exit(0)
  }

  const runUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`
  const { errors } = await actOnResults({ results, gh, repo, runUrl })

  // The probe itself must be loud when it cannot do its job. An unparseable
  // cadence is a workflow nobody is watching, and exiting 0 on it would make this
  // the second silent alerter in the same repository.
  const broken = results.filter((r) => r.state === 'unparseable')
  if (broken.length > 0) {
    console.error(`\nworkflow-heartbeat: ${broken.length} workflow(s) have a cadence this probe cannot model — they are UNWATCHED`)
    process.exit(1)
  }
  if (errors.length > 0) {
    console.error(`\nworkflow-heartbeat: could not act on ${errors.length} workflow(s): ${errors.map((e) => e.file).join(', ')}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
