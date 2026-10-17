/**
 * Q-113 red-team (2026-10-17) — the alert RUNNERS, driven end to end.
 *
 * A1 was that every Q-113 test exercised the pure `decideAlert`, while the dedupe
 * key and thread were built only in the runner shells: setting `dedupeKey:
 * undefined` in both runners left 102/102 green. These tests drive
 * `runNotifier` and `actOnResults` against an in-memory GitHub, so what the
 * runners actually pass is what is tested.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runNotifier, notifierEnvFrom } from '../../scripts/ci/notify-scheduled-failure.mjs'
import { actOnResults, toWatchedRun } from '../../scripts/ci/workflow-heartbeat.mjs'
import { assessWorkflow } from '../../scripts/ci/heartbeatDecision.mjs'
import { alertTitle, ALERT_MARKER, readThread, THREAD_PAGE_SIZE } from '../../scripts/ci/alertDecision.mjs'

const REPO = 'o/r'
const run = (id: number) => `https://github.com/${REPO}/actions/runs/${id}`
const quiet = { log: () => {}, warn: () => {}, error: () => {} }

interface Issue { number: number; title: string; body: string; state: 'open' | 'closed'; comments: string[] }

/** A GitHub that holds issues in memory and can be told to fail a path. */
function fakeGitHub(issues: Issue[] = [], failOn: (method: string, path: string) => boolean = () => false) {
  const calls: string[] = []
  const gh = async (path: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'GET'
    calls.push(`${method} ${path}`)
    if (failOn(method, path)) throw new Error(`${method} ${path} -> 500 boom`)
    const url = new URL(`https://api.github.com${path}`)
    const page = Number(url.searchParams.get('page') ?? '1')
    const per = Number(url.searchParams.get('per_page') ?? '100')
    let m: RegExpMatchArray | null
    if (method === 'GET' && url.pathname === `/repos/${REPO}/issues`) {
      const open = issues.filter((i) => i.state === 'open')
      return open.slice((page - 1) * per, page * per)
        .map((i) => ({ number: i.number, title: i.title, body: i.body, comments: i.comments.length }))
    }
    if ((m = url.pathname.match(/\/issues\/(\d+)\/comments$/))) {
      const issue = issues.find((i) => i.number === Number(m![1]))!
      if (method === 'POST') { issue.comments.push(JSON.parse(init.body!).body); return {} }
      return issue.comments.slice((page - 1) * per, page * per).map((body) => ({ body }))
    }
    if (method === 'POST' && url.pathname === `/repos/${REPO}/issues`) {
      const { title, body } = JSON.parse(init.body!)
      const issue: Issue = { number: issues.length + 1, title, body, state: 'open', comments: [] }
      issues.push(issue)
      return { number: issue.number }
    }
    if (method === 'PATCH' && (m = url.pathname.match(/\/issues\/(\d+)$/))) {
      issues.find((i) => i.number === Number(m![1]))!.state = 'closed'
      return {}
    }
    throw new Error(`fake GitHub: unhandled ${method} ${path}`)
  }
  return { gh, calls, issues }
}

const openAlert = (workflow: string, number = 1, comments: string[] = []): Issue =>
  ({ number, title: alertTitle(workflow), body: `${ALERT_MARKER}\n\nfirst failure`, state: 'open', comments })

const notifierEnv = (id: number, attempt = 1, conclusion = 'failure', detail = '') => ({
  GITHUB_REPOSITORY: REPO,
  ALERT_WORKFLOW: 'refresh-data.yml',
  ALERT_CONCLUSION: conclusion,
  ALERT_RUN_URL: run(id),
  ALERT_RUN_ATTEMPT: String(attempt),
  ALERT_DETAIL: detail,
  ALERT_EVENT: 'schedule',
})

describe('runNotifier — what the in-workflow runner actually does', () => {
  it('A1: does not comment on a run already on the thread', async () => {
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml', 1, [`earlier … ${run(111)}\n`])])
    const d = await runNotifier({ env: notifierEnv(111), gh, log: quiet })
    expect(d).toEqual({ action: 'none', reason: 'already reported' })
    expect(issues[0].comments).toHaveLength(1)
  })

  it('A1: comments once on a new run, carrying the key as an exact token', async () => {
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml')])
    await runNotifier({ env: notifierEnv(222), gh, log: quiet })
    expect(issues[0].comments).toHaveLength(1)
    expect(issues[0].comments[0]).toContain(`<!-- alert-key: ${run(222)} -->`)
    await runNotifier({ env: notifierEnv(222), gh, log: quiet })
    expect(issues[0].comments).toHaveLength(1)
  })

  it('A2: a re-run that fails again is reported, once per attempt', async () => {
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml')])
    await runNotifier({ env: notifierEnv(333, 1, 'failure', 'BTC quarantined'), gh, log: quiet })
    await runNotifier({ env: notifierEnv(333, 2, 'failure', 'ETH quarantined'), gh, log: quiet })
    await runNotifier({ env: notifierEnv(333, 2, 'failure', 'ETH quarantined'), gh, log: quiet })
    expect(issues[0].comments).toHaveLength(2)
    expect(issues[0].comments[1]).toContain('ETH quarantined')
    expect(issues[0].comments[1]).toContain(`<!-- alert-key: ${run(333)}#attempt-2 -->`)
  })

  it('A3: a thread it cannot read makes it SPEAK, not drop the alert', async () => {
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml', 1, [run(444)])], (m, p) => m === 'GET' && p.includes('/comments'))
    const d = await runNotifier({ env: notifierEnv(444), gh, log: quiet })
    expect(d.action).toBe('comment')
    expect(issues[0].comments).toHaveLength(2)
  })
})

const unhealthy = (file: string, id: number, attempt = 1) => ({
  file, state: 'unhealthy', conclusion: 'failure', due: '2026-10-11T22:00:00.000Z',
  runUrl: run(id), runAttempt: attempt, detail: `the run concluded failure ${run(id)}`,
})
const healthy = (file: string) => ({ file, state: 'healthy', due: '2026-10-11T22:00:00.000Z', detail: 'succeeded' })
const PROBE = run(900)

describe('actOnResults — what the daily probe actually does', () => {
  it('A1: does not re-report a run the notifier already reported', async () => {
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml')])
    await runNotifier({ env: notifierEnv(555), gh, log: quiet })
    const { acted } = await actOnResults({ results: [unhealthy('refresh-data.yml', 555)], gh, repo: REPO, runUrl: PROBE, log: quiet })
    expect(acted).toEqual([])
    expect(issues[0].comments).toHaveLength(1)
  })

  it('A3: one workflow failing does not stop the next — it is alerted and recovery still closes', async () => {
    const { gh, issues } = fakeGitHub(
      [openAlert('a.yml', 1), openAlert('b.yml', 2)],
      (m, p) => m === 'POST' && p.endsWith('/issues/1/comments'),
    )
    const { acted, errors } = await actOnResults({
      results: [unhealthy('a.yml', 600), healthy('b.yml')], gh, repo: REPO, runUrl: PROBE, log: quiet,
    })
    expect(errors.map((e: { file: string }) => e.file)).toEqual(['a.yml'])
    expect(acted).toEqual([{ file: 'b.yml', action: 'close' }])
    expect(issues[1].state).toBe('closed')
  })

  it('A3: a thread it cannot read makes it speak for that workflow and carry on', async () => {
    const { gh, issues } = fakeGitHub(
      [openAlert('a.yml', 1, [run(700)]), openAlert('b.yml', 2)],
      (m, p) => m === 'GET' && p.includes('/issues/1/comments'),
    )
    const { acted, errors } = await actOnResults({
      results: [unhealthy('a.yml', 700), unhealthy('b.yml', 701)], gh, repo: REPO, runUrl: PROBE, log: quiet,
    })
    expect(errors).toEqual([])
    expect(acted).toEqual([{ file: 'a.yml', action: 'comment' }, { file: 'b.yml', action: 'comment' }])
    expect(issues[0].comments).toHaveLength(2)
  })
})

describe('A5: #177 replayed through BOTH runners, as they interleave', () => {
  it('six weekly failures and 41 daily looks make six comments, not one a day', async () => {
    // What makes this 6 rather than 12 is that the notifier's key (from
    // ALERT_RUN_URL + ALERT_RUN_ATTEMPT) and the probe's key (from the API's
    // html_url + run_attempt) are the SAME string. Six distinct strings through
    // decideAlert alone, which the old test did, would give six whatever the
    // runners passed.
    const weekly = [34066964667, 34790929873, 35545800543, 36361648320, 37247468640, 38189996112]
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml', 177)])
    for (let day = 0; day < 41; day++) {
      const week = Math.min(weekly.length - 1, Math.floor(day / 7))
      if (day % 7 === 0 && day / 7 < weekly.length) {
        await runNotifier({ env: notifierEnv(weekly[week]), gh, log: quiet })
      }
      await actOnResults({ results: [unhealthy('refresh-data.yml', weekly[week])], gh, repo: REPO, runUrl: PROBE, log: quiet })
    }
    expect(issues[0].comments).toHaveLength(weekly.length)
  })
})

describe('readThread — newest pages first (A4)', () => {
  it('finds a key on the newest comment of a thread longer than the page budget', async () => {
    const comments = Array.from({ length: 10 * THREAD_PAGE_SIZE + 50 }, (_, i) => `comment ${i}`)
    comments[comments.length - 1] = `latest ${run(999)}`
    const { gh, calls } = fakeGitHub([openAlert('x.yml', 1, comments)])
    const issue = { number: 1, body: 'b', comments: comments.length }
    const { thread, error } = await readThread(gh, REPO, issue)
    expect(error).toBeNull()
    expect(thread.some((t: string) => t.includes(run(999)))).toBe(true)
    expect(calls[0]).toContain('page=11')
  })
})

// Red-team R2-236-1: the attempt reached the key through three production
// links no test executed — the workflow's env, the runner's env mapping, and
// the probe's API-run mapping. Each mutation left 113/113 green. Each link is
// now exercised.
describe('the run attempt survives every hop to the key', () => {
  it('the reusable workflow passes github.run_attempt to the notifier', () => {
    const wf = readFileSync(join(__dirname, '../../.github/workflows/scheduled-failure-alert.yml'), 'utf8')
    expect(wf).toMatch(/^\s+ALERT_RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}\s*$/m)
  })

  it("the notifier's env mapping carries ALERT_RUN_ATTEMPT, and a re-run is reported", async () => {
    const env = notifierEnvFrom({ ...notifierEnv(800), ALERT_RUN_ATTEMPT: '2', UNRELATED: 'x' })
    expect(env.ALERT_RUN_ATTEMPT).toBe('2')
    expect('UNRELATED' in env).toBe(false)
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml', 1, [`attempt 1 … ${run(800)}\n`])])
    const d = await runNotifier({ env, gh, log: quiet })
    expect(d.action).toBe('comment')
    expect(issues[0].comments[1]).toContain(`${run(800)}#attempt-2`)
  })

  it("the probe's API mapping carries run_attempt into the assessed result", () => {
    const apiRun = { created_at: '2026-10-12T08:00:00Z', status: 'completed', conclusion: 'failure', html_url: run(801), run_attempt: 2 }
    expect(toWatchedRun(apiRun).attempt).toBe(2)
    const r = assessWorkflow({ file: 'refresh-data.yml', crons: ['0 22 * * 0'], runs: [toWatchedRun(apiRun)], now: new Date('2026-10-13T00:00:00Z') })
    expect(r.state).toBe('unhealthy')
    expect(r.runAttempt).toBe(2)
  })

  it('the probe reports attempt 2 when only attempt 1 is on the thread (the backstop case)', async () => {
    const { gh, issues } = fakeGitHub([openAlert('refresh-data.yml', 1, [`attempt 1 … ${run(802)}\n`])])
    const { acted } = await actOnResults({ results: [unhealthy('refresh-data.yml', 802, 2)], gh, repo: REPO, runUrl: PROBE, log: quiet })
    expect(acted).toEqual([{ file: 'refresh-data.yml', action: 'comment' }])
    expect(issues[0].comments[1]).toContain(`${run(802)}#attempt-2`)
  })
})
