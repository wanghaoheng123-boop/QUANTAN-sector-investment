#!/usr/bin/env node
/**
 * Runner for the scheduled-workflow alert (Q107-O2).
 *
 * All decisions live in `alertDecision.mjs` and are unit tested; this file is the
 * I/O shell, kept deliberately thin so there is little here that a test cannot see.
 *
 * Uses the built-in GITHUB_TOKEN, so there is nothing for an owner to provision —
 * that mattered more than the choice of channel. Requires `issues: write`.
 */
import { decideAlert, alertTitle, ALERT_MARKER } from './alertDecision.mjs'

const API = 'https://api.github.com'
const token = process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY
const workflow = process.env.ALERT_WORKFLOW
const conclusion = process.env.ALERT_CONCLUSION
const runUrl = process.env.ALERT_RUN_URL ?? ''
const detail = process.env.ALERT_DETAIL ?? ''
const eventName = process.env.ALERT_EVENT ?? undefined

if (!token || !repo || !workflow || !conclusion) {
  console.error('notify-scheduled-failure: missing GITHUB_TOKEN / GITHUB_REPOSITORY / ALERT_WORKFLOW / ALERT_CONCLUSION')
  process.exit(1)
}

const gh = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

/**
 * Find this workflow's open alert issue.
 *
 * Matched on TITLE plus the body marker rather than a label, because a label has
 * to exist first and a missing label would make the whole mechanism silently
 * no-op — the failure mode this package exists to remove.
 *
 * Two things the obvious one-liner gets wrong, both verified against this repo:
 *
 * - **`/issues` RETURNS PULL REQUESTS.** GitHub's issues endpoint includes PRs,
 *   and right now every open item on this repository is a PR. They are filtered
 *   explicitly; relying on the title+marker pair to exclude them would work by
 *   luck rather than by rule.
 * - **One page is not all pages.** Capped at 100, a busy backlog would hide the
 *   existing alert and the runner would open a duplicate every week — the alert
 *   fatigue this design exists to avoid. Paginated, with a bound so a runaway
 *   listing cannot hang the job.
 */
const MAX_PAGES = 10

const findOpen = async () => {
  const want = alertTitle(workflow)
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await gh(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`)
    if (!Array.isArray(batch) || batch.length === 0) return null
    const hit = batch.find(
      (i) => !i.pull_request && i.title === want && (i.body ?? '').includes(ALERT_MARKER),
    )
    if (hit) return hit
    if (batch.length < 100) return null
  }
  // Bounded rather than infinite, and LOUD about it: silently giving up here
  // would open a duplicate issue and look like the mechanism working.
  console.warn(`findOpen: scanned ${MAX_PAGES} pages without finding an existing alert; may create a duplicate`)
  return null
}

const openIssue = await findOpen()
const d = decideAlert({ workflow, conclusion, openIssue, runUrl, detail, eventName })
console.log(`alert decision for ${workflow} (${conclusion}): ${d.action}`)

if (d.action === 'create') {
  const made = await gh(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: d.title, body: d.body }),
  })
  console.log(`opened #${made.number}`)
} else if (d.action === 'comment') {
  await gh(`/repos/${repo}/issues/${d.issue}/comments`, { method: 'POST', body: JSON.stringify({ body: d.body }) })
  console.log(`commented on #${d.issue}`)
} else if (d.action === 'close') {
  await gh(`/repos/${repo}/issues/${d.issue}/comments`, { method: 'POST', body: JSON.stringify({ body: d.body }) })
  await gh(`/repos/${repo}/issues/${d.issue}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })
  console.log(`closed #${d.issue}`)
}
