/**
 * Q107-O4 — a required status check must name exactly one job, and must be a
 * name a pull request can actually produce.
 *
 * `Q-097` is owner action: `main` has no branch protection and an empty
 * required-check set, so every check in this repository is advisory. When the
 * owner does click, the names they pick are matched as strings. This file makes
 * that list a measured artifact rather than something read off a dropdown.
 *
 * ## REACHABILITY FIRST, and here the risk is a PARSER
 *
 * The derivation models GitHub's naming rules. A model can be wrong in the quiet
 * direction — drop the `/` composite, or the matrix suffix, and the collision
 * check goes green having examined fewer names than exist. So the first block
 * asserts the derivation reproduces the check-run names GitHub ACTUALLY EMITTED,
 * pulled from the API on 2026-09-09. The oracle is the consumer's own output, not
 * a second copy of the model — the defect Q110-T2 found in the sanitize fuzz test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { checkNames, collisions, jobBlocks, normalise, requirable, triggers, type WorkflowFile } from './workflowCheckNames'

const DIR = join(__dirname, '../../.github/workflows')
const files: WorkflowFile[] = readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ path: f, source: readFileSync(join(DIR, f), 'utf8') }))

const names = checkNames(files)
const nameSet = [...new Set(names.map((c) => c.name))].sort()

/**
 * Observed on 2026-09-09 via `repos/:owner/:repo/commits/<sha>/check-runs`, over
 * commits `50bbab4` (a push, so CI ran) and `77cc18e` (a bot push, so it did not).
 * The four concrete `stryker (…)` names are one template. `Vercel` is a commit
 * STATUS rather than a check run and so is not derivable from these files at all;
 * it is named in the requirable list below instead.
 */
const OBSERVED_BEFORE_THIS_FIX = [
  'alert / alert',
  'axe',
  'benchmark',
  'coverage',
  'pytest',
  'refresh',
  'smoke',
  'stryker (*)',
  'test',
  'typecheck',
  'workflows',
].sort()

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-O4 — the derivation reproduces what GitHub actually emits', () => {
  it('reads every workflow file, not a corner of them', () => {
    expect(files.length).toBe(6)
    expect(files.map((f) => f.path)).toContain('scheduled-failure-alert.yml')
  })

  it('finds the jobs in every workflow', () => {
    for (const f of files) expect(jobBlocks(f.source).size).toBeGreaterThan(0)
  })

  it('derives the historical name set EXACTLY from the pre-fix sources', () => {
    // The positive control on the DERIVATION. Every job below is reproduced from
    // the source text as it stood before this commit, so the expected value is
    // GitHub's own output rather than a restatement of the model. A version that
    // dropped the composite or the matrix suffix fails here.
    const before: WorkflowFile[] = files.map((f) => ({
      path: f.path,
      source: f.source
        .replace(/^ {4}name: nightly-benchmark\n/m, '')
        .replace(/^ {4}name: alert-nightly-benchmark\n/m, '')
        .replace(/^ {4}name: alert-weekly-refresh\n/m, '')
        .replace(/^ {4}name: alert-stryker-weekly\n/m, ''),
    }))
    expect([...new Set(checkNames(before).map((c) => c.name))].sort()).toEqual(OBSERVED_BEFORE_THIS_FIX)
  })

  it('and those pre-fix sources DO collide, which is the finding', () => {
    // Watched it fail, kept as a test. `alert / alert` was produced by three
    // workflows; commit 50bbab4 carries two of them on one SHA. `benchmark` was
    // produced by ci.yml and nightly-backtest.yml.
    const before: WorkflowFile[] = files.map((f) => ({
      path: f.path,
      source: f.source.replace(/^ {4}name: (?:nightly-benchmark|alert-[a-z-]+)\n/gm, ''),
    }))
    const c = collisions(checkNames(before))
    expect([...c.keys()].sort()).toEqual(['alert / alert', 'benchmark'])
    expect(c.get('alert / alert')?.map((x) => x.workflow).sort()).toEqual([
      'nightly-backtest.yml', 'refresh-data.yml', 'stryker-weekly.yml',
    ])
    expect(c.get('benchmark')?.map((x) => x.workflow).sort()).toEqual(['ci.yml', 'nightly-backtest.yml'])
  })

  it('appends the matrix suffix for a matrix job whose name carries no expression', () => {
    // REACHABILITY, and this branch had NONE. Mutation M-2 deleted the suffix
    // entirely and the whole suite stayed green: `stryker` already carries
    // `${{ matrix.shard.name }}` in its own `name:`, so it normalises to
    // `stryker (*)` via the expression and the suffix never fires. A rule correct
    // and unreachable — in the guard written to close a reachability defect,
    // which is why it is caught here rather than shipped as decoration.
    const virtual: WorkflowFile[] = [{
      path: 'm.yml',
      source: 'name: M\non:\n  schedule:\n    - cron: 0 0 * * *\njobs:\n  shard:\n    strategy:\n      matrix:\n        os: [a, b]\n    runs-on: ubuntu-latest\n',
    }]
    expect(checkNames(virtual).map((c) => c.name)).toEqual(['shard (*)'])
  })

  it('does not double-suffix a matrix job that already interpolates the matrix', () => {
    // The real shape. Guards the other direction of the same branch: `stryker
    // (*) (*)` would be a name GitHub never emits, and the oracle above would
    // catch it only because stryker happens to exist.
    expect(nameSet.filter((n) => n.startsWith('stryker'))).toEqual(['stryker (*)'])
  })

  it('does not invent a check for the reusable workflow itself', () => {
    // scheduled-failure-alert.yml is workflow_call only: it is always reported
    // under its caller. Emitting a bare `alert` here would be a phantom name.
    expect(nameSet).not.toContain('alert')
    expect(triggers(files.find((f) => f.path === 'scheduled-failure-alert.yml')!.source))
      .toEqual(new Set(['workflow_call']))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-O4 — no check-run name identifies more than one job', () => {
  it('has no cross-workflow collision', () => {
    const found = [...collisions(names)].map(
      ([n, v]) => `"${n}" <- ${v.map((c) => `${c.workflow}:${c.jobId}`).join(', ')}`,
    )
    expect(found).toEqual([])
  })

  it('kept the job IDS, so needs: and the alert-permission checks still resolve', () => {
    // The fix adds `name:`; renaming ids would have broken `needs: [benchmark]`
    // and `alertPermissions()`, which looks the caller job up as `alert`.
    const nightly = files.find((f) => f.path === 'nightly-backtest.yml')!
    expect([...jobBlocks(nightly.source).keys()]).toEqual(['benchmark', 'alert'])
    for (const f of ['nightly-backtest.yml', 'refresh-data.yml', 'stryker-weekly.yml']) {
      expect([...jobBlocks(files.find((x) => x.path === f)!.source).keys()]).toContain('alert')
    }
  })

  it('every alert composite is distinct and says which workflow it came from', () => {
    const composites = nameSet.filter((n) => n.includes(' / '))
    expect(composites.sort()).toEqual([
      'alert-nightly-benchmark / alert',
      'alert-stryker-weekly / alert',
      'alert-weekly-refresh / alert',
    ])
  })

  it('resolves every reusable-workflow target', () => {
    expect(nameSet.filter((n) => n.includes('UNRESOLVED'))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-O4 — what is SAFE to require when Q-097 lands', () => {
  /**
   * The artifact this package exists to produce. A name absent from here either
   * identifies two jobs, or is emitted by no `pull_request`-triggered workflow —
   * and requiring the latter blocks every pull request permanently, because
   * nothing on a PR head will ever report it.
   */
  const SAFE_TO_REQUIRE = ['benchmark', 'coverage', 'pytest', 'smoke', 'test', 'typecheck', 'workflows']

  it('is exactly the ci.yml job set', () => {
    expect(requirable(files)).toEqual(SAFE_TO_REQUIRE.sort())
  })

  it('excludes every name a pull request can never produce', () => {
    // The permanent-block foot-gun, named rather than described. NOTE this is a
    // DIFFERENT failure from ambiguity, and the Q107-O4 ledger row conflates
    // them: `benchmark` was ambiguous but never a permanent block, because
    // ci.yml does emit it on PR heads.
    for (const n of ['axe', 'refresh', 'stryker (*)', 'alert-nightly-benchmark / alert']) {
      expect(nameSet).toContain(n)
      expect(requirable(files)).not.toContain(n)
    }
  })

  it('only ci.yml runs on pull_request, which is why the list is what it is', () => {
    const prWorkflows = files.filter((f) => triggers(f.source).has('pull_request')).map((f) => f.path)
    expect(prWorkflows).toEqual(['ci.yml'])
  })

  it('would drop a name that became ambiguous, rather than keep recommending it', () => {
    const poisoned: WorkflowFile[] = [
      ...files,
      { path: 'rogue.yml', source: 'name: Rogue\non:\n  schedule:\n    - cron: 0 0 * * *\njobs:\n  typecheck:\n    runs-on: ubuntu-latest\n' },
    ]
    expect(requirable(poisoned)).not.toContain('typecheck')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What this guard CANNOT do — passing tests, so a green run is never a proof.
// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-O4 — what this guard CANNOT do', () => {
  it('CANNOT distinguish two matrix jobs whose names differ only inside an expression', () => {
    // Normalisation is what lets one template stand for four real names; the cost
    // is here. Two such jobs are reported as colliding when their concrete names
    // may never overlap — a FALSE POSITIVE, which is the safe direction for a
    // gate that asks "is this name unambiguous".
    expect(normalise('stryker (${{ matrix.shard.name }})')).toBe('stryker (*)')
    expect(normalise('stryker (${{ matrix.other.thing }})')).toBe('stryker (*)')
  })

  it('CANNOT see the Vercel status, which is not a check run at all', () => {
    // Vercel posts a commit STATUS. It is requirable and green on every PR in this
    // repo, and nothing in .github/workflows can tell you that.
    expect(nameSet).not.toContain('Vercel')
  })

  it('CANNOT know whether GitHub composes a reusable call as caller/callee', () => {
    // The naming rules are modelled from observation, not from a specification
    // this repository controls. `alert / alert` in the API response is the
    // evidence for the composite form; the renamed halves are verified by
    // dispatching the workflow and reading the emitted name, not by this file.
    expect(OBSERVED_BEFORE_THIS_FIX).toContain('alert / alert')
  })

  it('CANNOT enforce anything — Q-097 is owner action and the list is advisory', () => {
    // Stated so a green run here is never mistaken for branch protection existing.
    // Until the owner sets the required-check set, this file records what SHOULD
    // be required and nothing consumes it.
    expect(requirable(files).length).toBeGreaterThan(0)
  })
})
