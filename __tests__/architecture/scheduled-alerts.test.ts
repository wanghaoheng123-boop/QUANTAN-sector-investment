/**
 * Q107-O2 — the WIRING, which no other gate in this repository can check.
 *
 * `tsc` and `vitest` cannot read GitHub Actions YAML, so a workflow that is wired
 * wrongly ships green. The first version of this file proved the point in the
 * worst way: red-team ran TEN mutations against it and every one survived. You
 * could DELETE the entire alerting mechanism and CI stayed green, because the
 * suite enumerated only files containing `schedule:` — and the mechanism itself,
 * `scheduled-failure-alert.yml`, is a `workflow_call` and has no schedule.
 *
 * The rule was fine. It never visited the thing it governed. Sixth time.
 *
 * And it missed a live break: `refresh-data.yml` shipped with a NESTED
 * `${{ ${{ … }} }}`, which is a compile error for the whole file. GitHub logged
 * three runs named after the file path with zero jobs — its signature for an
 * unparseable workflow — while every check in this repo stayed green. The weekly
 * refresh was dead again, in the very package meant to make failures visible.
 *
 * So this file now checks the MECHANISM, not just its callers.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../..')
const DIR = join(ROOT, '.github/workflows')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')

/** `.yaml` counts too — an extension allowlist is how a whole file type hides. */
const all = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))
const scheduled = all.filter((f) => /^\s*schedule:/m.test(read(f)))
/**
 * Jobs in a workflow, split by their own indentation.
 *
 * The first version tested `continue-on-error: true` against the WHOLE FILE, so a
 * workflow with one exempt job and one failable job read as "cannot fail" —
 * red-team added exactly that to `a11y-axe.yml` and the suite stayed green. A
 * file-level answer to a per-job question is an approximation wearing a
 * property's clothes.
 *
 * Regex rather than a YAML parse because this repo has no YAML dependency and
 * adding one to a test is its own risk; the shape it relies on (two-space job
 * keys under `jobs:`) is asserted below so a reformat cannot silently defeat it.
 */
function jobBlocks(f: string): Record<string, string> {
  const lines = read(f).split('\n')
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (start === -1) return {}
  const out: Record<string, string> = {}
  let name: string | null = null
  for (const line of lines.slice(start + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (m) { name = m[1]; out[name] = ''; continue }
    if (/^\S/.test(line) && line.trim() !== '') break // left the jobs: block
    if (name) out[name] += line + '\n'
  }
  return out
}

/** A job-level `continue-on-error: true` forces THAT job's result to `success`. */
const failableJobs = (f: string) =>
  Object.entries(jobBlocks(f))
    .filter(([, body]) => !/^\s*continue-on-error:\s*true/m.test(body))
    .map(([n]) => n)

const canFail = (f: string) => failableJobs(f).length > 0
const wired = (f: string) => read(f).includes('uses: ./.github/workflows/scheduled-failure-alert.yml')

const MECHANISM = 'scheduled-failure-alert.yml'
const RUNNER = 'scripts/ci/notify-scheduled-failure.mjs'

describe('Q107-O2 — the alerting mechanism itself exists and is intact', () => {
  it('the reusable workflow is present', () => {
    // M11: deleting this file survived the previous suite completely.
    expect(all).toContain(MECHANISM)
  })

  it('it invokes the runner, and the runner exists on disk', () => {
    // M12/M13: deleting the script, or replacing the `run:` with `echo`, both
    // survived. A workflow that runs nothing is indistinguishable from one that
    // works, until an outage.
    expect(read(MECHANISM)).toContain(`run: node ${RUNNER}`)
    expect(existsSync(join(ROOT, RUNNER))).toBe(true)
  })

  it('every local `uses: ./` target in every workflow exists', () => {
    const missing: string[] = []
    for (const f of all) {
      for (const m of read(f).matchAll(/uses:\s*\.\/(\S+)/g)) {
        if (!existsSync(join(ROOT, m[1]))) missing.push(`${f} -> ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('the alert job can read the repo it checks out', () => {
    // Naming a permissions block ZEROES every scope not listed, and this job runs
    // actions/checkout. `contents: read` is required, not tidiness.
    const s = read(MECHANISM)
    expect(s).toMatch(/contents:\s*read/)
    expect(s).toMatch(/issues:\s*write/)
  })
})

describe('Q107-O2 — no workflow in this repo is unparseable', () => {
  it.each(all)('%s has no nested ${{ }} expression', (f) => {
    // THE ONE THAT WOULD HAVE CAUGHT THE LIVE BREAK. Actions expressions do not
    // nest; a nested one is a compile error for the ENTIRE file, and GitHub
    // reports it as a run named after the file path with zero jobs — which no
    // check-run query in this repo was looking at.
    const offenders = read(f)
      .split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /\$\{\{[^}]*\$\{\{/.test(l))
      .map(([n, l]) => `${f}:${n} ${l.trim().slice(0, 60)}`)
    expect(offenders).toEqual([])
  })

  it.each(all)('%s balances its ${{ and }} delimiters', (f) => {
    const s = read(f)
    expect((s.match(/\$\{\{/g) ?? []).length).toBe((s.match(/\}\}/g) ?? []).length)
  })
})

describe('Q107-O2 — every scheduled workflow that can fail raises an alert', () => {
  it('finds the scheduled workflows at all', () => {
    // Reachability first: an empty list makes everything below vacuous.
    expect(scheduled.length).toBeGreaterThanOrEqual(4)
  })

  it('leaves no failable scheduled workflow unwired', () => {
    // M2: adding a NEW failable scheduled workflow survived, because the suite
    // asserted a hardcoded list of three names instead of the property.
    expect(scheduled.filter((f) => canFail(f) && !wired(f))).toEqual([])
  })

  it('wires only workflows that can actually fail', () => {
    // The mirror: an alert on a job that can never report failure is decoration.
    expect(scheduled.filter((f) => !canFail(f) && wired(f))).toEqual([])
  })

  it.each(['refresh-data.yml', 'nightly-backtest.yml', 'stryker-weekly.yml'])(
    '%s is wired',
    (f) => expect(wired(f)).toBe(true),
  )

  it('every alert job runs with always(), not success() or failure()', () => {
    // A dependent job is SKIPPED when its `needs` job fails unless re-admitted.
    // always() also lets the success path close the issue.
    for (const f of all.filter(wired)) {
      expect(read(f).slice(read(f).indexOf('  alert:')), f).toMatch(/if:\s*always\(\)/)
    }
  })

  it('each caller reports its OWN filename, not another workflow’s', () => {
    // M16: pointing stryker's alert at refresh-data.yml survived, which would
    // merge two independent outages into one issue and clear both on either
    // recovery.
    for (const f of all.filter(wired)) {
      const block = read(f).slice(read(f).indexOf('  alert:'))
      expect(block, f).toMatch(new RegExp(`workflow:\\s*${f.replace('.', '\\.')}\\b`))
    }
  })

  it('each caller passes a conclusion derived from its own job result', () => {
    // M15: breaking the expression so `conclusion` is always empty survived. It
    // is now also survivable-proof at runtime — an unrecognised conclusion
    // ALERTS — but a silently empty input should still be caught here.
    for (const f of all.filter(wired)) {
      const block = read(f).slice(read(f).indexOf('  alert:'))
      expect(block, f).toMatch(/conclusion:\s*\$\{\{\s*needs\.[A-Za-z0-9_-]+\.result\s*\}\}/)
    }
  })

  it('no wired job is itself continue-on-error', () => {
    // M14: making the WIRED job continue-on-error survived. Its result would then
    // always be `success` and the alert could never fire — decoration again, one
    // level in.
    for (const f of all.filter(wired)) {
      expect(canFail(f), `${f} is wired but cannot report failure`).toBe(true)
    }
  })

  it('refresh-data tells the alert whether the red was a quarantine', () => {
    const s = read('refresh-data.yml')
    expect(s).toMatch(/outputs:\s*\n\s*(#[^\n]*\n\s*)*quarantine:/)
    expect(s).toContain('QUARANTINED')
  })
})

/**
 * Top-level `permissions:` scopes, if the workflow declares a block at all.
 *
 * Returns `null` when there is no block — which is NOT the same as an empty one.
 * No block means the job inherits the repository default and may request what it
 * likes; an empty-but-present block would be a ceiling of nothing.
 */
function workflowPermissions(f: string): Set<string> | null {
  const lines = read(f).split('\n')
  const at = lines.findIndex((l) => /^permissions:\s*$/.test(l))
  if (at === -1) return null
  const out = new Set<string>()
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break
    const m = /^\s+([a-z-]+):\s*\S+/.exec(line)
    if (m) out.add(m[1])
  }
  return out
}

/** Scopes the alert job asks for in a caller. */
function alertPermissions(f: string): string[] {
  const block = jobBlocks(f)['alert'] ?? ''
  const at = block.indexOf('permissions:')
  if (at === -1) return []
  return [...block.slice(at).matchAll(/^\s+([a-z-]+):\s*(read|write)\s*$/gm)].map((m) => m[1])
}

describe('Q107-O2 — a workflow-level permissions block is a CEILING', () => {
  it.each(['refresh-data.yml', 'nightly-backtest.yml', 'stryker-weekly.yml'])(
    '%s allows every scope its alert job requests',
    (f) => {
      // THIS COST A LIVE BREAK, twice over. A top-level `permissions:` block is a
      // ceiling, not a default: a job may narrow it and may never exceed it.
      // `refresh-data.yml` declared `contents: write` at workflow level while the
      // alert job asked for `issues: write`, so GitHub rejected the ENTIRE FILE —
      // `startup_failure`, zero jobs, verified live on run 33646555241. The weekly
      // refresh was dead on `main` for the third time in this package.
      //
      // The previous test asserted the alert job HAD `issues: write`. It did. What
      // was never checked is whether the workflow permitted it to take effect —
      // presence without reachability, one more time.
      const ceiling = workflowPermissions(f)
      if (ceiling === null) return // no block: the job inherits the repo default
      const missing = alertPermissions(f).filter((p) => !ceiling.has(p))
      expect(missing, `${f}: alert requests scopes outside the workflow ceiling`).toEqual([])
    },
  )

  it('reads the ceiling and the request, rather than passing vacuously', () => {
    // Reachability: if either extractor returned nothing the assertion above is
    // empty-minus-empty and can never fail.
    expect(workflowPermissions('refresh-data.yml')).not.toBeNull()
    expect(workflowPermissions('refresh-data.yml')?.has('contents')).toBe(true)
    expect(alertPermissions('refresh-data.yml')).toContain('issues')
  })
})

describe('Q107-O2 — job parsing is real, not assumed', () => {
  it('finds the jobs in every workflow', () => {
    // Reachability: if jobBlocks returned {} the failable-job property collapses
    // to "nothing can fail" and every wiring assertion passes vacuously.
    for (const f of all) expect(Object.keys(jobBlocks(f)).length, f).toBeGreaterThan(0)
  })

  it('sees a11y as exempt today, by its ONE job carrying the flag', () => {
    expect(Object.keys(jobBlocks('a11y-axe.yml'))).toEqual(['axe'])
    expect(failableJobs('a11y-axe.yml')).toEqual([])
  })

  it('would see a second, unflagged job as failable', () => {
    // The mutation that survived the previous version: one exempt job plus one
    // failable job read as "cannot fail" because the flag was matched file-wide.
    expect(failableJobs('refresh-data.yml').length).toBeGreaterThan(0)
  })
})

describe('Q107-O2 — a11y is unwired only while it cannot fail', () => {
  it('says so if that ever changes', () => {
    // Covered by the property tests above too; kept explicit because the
    // exclusion is a judgement someone will revisit.
    const a11y = 'a11y-axe.yml'
    if (canFail(a11y)) expect(read(a11y)).toContain(MECHANISM)
    else expect(read(a11y)).not.toContain(MECHANISM)
  })
})
