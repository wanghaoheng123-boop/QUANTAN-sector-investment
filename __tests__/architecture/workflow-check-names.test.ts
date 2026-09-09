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
import {
  calleeOf, checkNames, collisions, jobBlocks, normalise, requirable, scalar,
  triggerFilters, triggers, unsafeToRequire, type WorkflowFile,
} from './workflowCheckNames'

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
const OBSERVED_RAW = [
  'alert / alert',
  'axe',
  'benchmark',
  'coverage',
  'pytest',
  'refresh',
  'smoke',
  'stryker (backtest)',
  'stryker (options)',
  'stryker (quant-indicators)',
  'stryker (quant-rest)',
  'test',
  'typecheck',
  'workflows',
]

/**
 * The four `stryker (…)` names are one template. Collapsing them HERE, with the
 * same public `normalise` the derivation uses, keeps the frozen list raw GitHub
 * output — red-team's F7 was that the list already carried the pre-cooked
 * `stryker (*)`, i.e. one of eleven entries was the model asserted against
 * itself, in the very branch that had no reachable instances.
 */
const OBSERVED_BEFORE_THIS_FIX = [...new Set(
  OBSERVED_RAW.map((n) => n.replace(/\((?!\*\))[^)]*\)/, '(*)')),
)].sort()

/** The workflow files the snapshot above was measured over. */
const MEASURED_OVER = [
  'a11y-axe.yml', 'ci.yml', 'nightly-backtest.yml',
  'refresh-data.yml', 'scheduled-failure-alert.yml', 'stryker-weekly.yml',
]

/** The sources as they stood before this package renamed anything. */
const preFix: WorkflowFile[] = files.map((f) => ({
  path: f.path,
  source: f.source.replace(/^ {4}name: (?:nightly-benchmark|alert-[a-z-]+)\n/gm, ''),
}))

// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-O4 — the derivation reproduces what GitHub actually emits', () => {
  it('reads every workflow file, not a corner of them', () => {
    expect(files.length).toBe(6)
    expect(files.map((f) => f.path)).toContain('scheduled-failure-alert.yml')
  })

  it('finds the jobs in every workflow', () => {
    for (const f of files) expect(jobBlocks(f.source).size).toBeGreaterThan(0)
  })

  it('the oracle is scoped to the workflows it was measured over', () => {
    // F5: the frozen list is a SNAPSHOT. Adding a seventh workflow must not force
    // an author to invent a never-observed name and paste it into a list
    // documented as GitHub's output — that is how an oracle quietly becomes a
    // second copy of the model. The comparison below is restricted to the six
    // files the snapshot covers, so a new file fails the COLLISION and REQUIRABLE
    // checks (where it belongs) and not this one.
    expect(MEASURED_OVER.every((f) => files.some((x) => x.path === f))).toBe(true)
  })

  it('derives the historical name set EXACTLY from the pre-fix sources', () => {
    // The positive control on the DERIVATION. Every job below is reproduced from
    // the source text as it stood before this commit, so the expected value is
    // GitHub's own output rather than a restatement of the model. A version that
    // dropped the composite or the matrix suffix fails here.
    const before: WorkflowFile[] = preFix.filter((f) => MEASURED_OVER.includes(f.path))
    expect([...new Set(checkNames(before).map((c) => c.name))].sort()).toEqual(OBSERVED_BEFORE_THIS_FIX)
  })

  it('and those pre-fix sources DO collide, which is the finding', () => {
    // Watched it fail, kept as a test. `alert / alert` was produced by three
    // workflows; commit 50bbab4 carries two of them on one SHA. `benchmark` was
    // produced by ci.yml and nightly-backtest.yml.
    const c = collisions(checkNames(preFix))
    expect([...c.keys()].sort()).toEqual(['alert / alert', 'benchmark'])
    expect(c.get('alert / alert')?.map((x) => x.workflow).sort()).toEqual([
      'nightly-backtest.yml', 'refresh-data.yml', 'stryker-weekly.yml',
    ])
    expect(c.get('benchmark')?.map((x) => x.workflow).sort()).toEqual(['ci.yml', 'nightly-backtest.yml'])
  })

  it('reproduces the names GitHub emitted for the RENAMED workflow, measured after the fix', () => {
    // The second oracle, and the only proof that `name:` on a `uses:` job moves
    // the first half of the composite — that is GitHub behaviour this repository
    // does not control and cannot derive from a specification.
    //
    // MEASURED: nightly-backtest.yml dispatched against this branch at head
    // 83b5245, run 34368245585, `actions/runs/<id>/jobs` returned exactly
    // "nightly-benchmark" and "alert-nightly-benchmark / alert". Before the fix
    // the same workflow emitted "benchmark" and "alert / alert".
    const emitted = names.filter((c) => c.workflow === 'nightly-backtest.yml').map((c) => c.name).sort()
    expect(emitted).toEqual(['alert-nightly-benchmark / alert', 'nightly-benchmark'])
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
    // The permanent-block foot-gun, named rather than described. It is a
    // DIFFERENT failure from ambiguity, and the Q107-O4 row conflates them.
    //
    // CORRECTION, kept because it went the flattering way first: an earlier draft
    // called `benchmark` merely ambiguous and "latent", on two sampled commits.
    // Measured across 200 CI and 41 nightly runs, the two workflows share 12
    // commits and ELEVEN carry two or more `benchmark` check runs — f0fda05 has
    // run 33096354980 (Nightly, schedule) and 32982665852 (CI, push). Live, and
    // the row's severity was right. Two samples are not a "never".
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
// Escapes found by adversarial review. Each shipped GREEN in the first version.
// ─────────────────────────────────────────────────────────────────────────────
describe('Q107-O4 — the escapes red-team found', () => {
  const wf = (path: string, source: string): WorkflowFile => ({ path, source })
  const CI_HEAD = 'name: X\non:\n  pull_request:\n    branches: [main]\njobs:\n'

  it('F2: two jobs in ONE workflow sharing a name is a collision', () => {
    // The first version keyed collisions on WORKFLOW, so a second ci.yml job
    // named `test` was invisible and `test` was still recommended as requirable.
    // A re-run is a different run of the SAME job, which (workflow, jobId)
    // collapses anyway — the rationale never supported the code.
    const f = [wf('ci.yml', CI_HEAD + '  test:\n    runs-on: u\n  test-e2e:\n    name: test\n    runs-on: u\n')]
    expect([...collisions(checkNames(f)).keys()]).toEqual(['test'])
    expect(requirable(f)).not.toContain('test')
  })

  it('F1: a path-filtered pull_request trigger makes every name unrequirable', () => {
    // GitHub does not report a job skipped by a path filter AT ALL, so a required
    // check sits pending forever on a docs-only PR — and this repo merges
    // chore(state) PRs constantly. The name looks safe on the PR where it ran.
    const f = [wf('ci.yml', "name: X\non:\n  pull_request:\n    paths: ['app/**']\njobs:\n  test:\n    runs-on: u\n")]
    expect(triggerFilters(f[0].source, 'pull_request')).toContain('paths')
    expect(requirable(f)).toEqual([])
    expect(unsafeToRequire(f)[0].reason).toMatch(/filters pull_request by path/)
  })

  it('F1: a job-level if: makes that one name unrequirable', () => {
    const f = [wf('ci.yml', CI_HEAD + "  always:\n    runs-on: u\n  sometimes:\n    if: github.actor != 'bot'\n    runs-on: u\n")]
    expect(requirable(f)).toEqual(['always'])
    expect(unsafeToRequire(f).map((u) => u.name)).toEqual(['sometimes'])
  })

  it('F1: the real ci.yml has neither, which is why its seven names are safe', () => {
    const ci = files.find((f) => f.path === 'ci.yml')!
    expect(triggerFilters(ci.source, 'pull_request')).toEqual(new Set(['branches']))
    expect([...jobBlocks(ci.source).values()].some((b) => b.some((l) => /^ {4}if:/.test(l)))).toBe(false)
  })

  it('F4: a REMOTE reusable workflow is unresolvable, not an ordinary job', () => {
    // The first version matched only an unquoted local `./…` path, so its
    // "unresolvable" branch could fire on nothing actionlint would pass — correct
    // and unreachable, inside the guard written to close a reachability defect.
    // A remote call derived the bare caller name where GitHub emits a composite.
    const f = [wf('x.yml', CI_HEAD + '  call:\n    uses: octo/repo/.github/workflows/w.yml@v1\n')]
    expect(calleeOf(['    uses: octo/repo/.github/workflows/w.yml@v1'])).toEqual({ kind: 'remote', ref: 'octo/repo/.github/workflows/w.yml@v1' })
    expect(checkNames(f)[0].name).toContain('<UNRESOLVED')
    expect(requirable(f)).toEqual([])
  })

  it('F6: a trailing comment on a job header no longer loses TWO jobs', () => {
    // It lost the commented job AND appended its body to the job above, renaming
    // that one. Two jobs corrupted by one comment.
    const b = jobBlocks(CI_HEAD + '  first:\n    runs-on: u\n  deploy: # later\n    name: shipped\n    runs-on: u\n')
    expect([...b.keys()]).toEqual(['first', 'deploy'])
    expect(checkNames([wf('x.yml', CI_HEAD + '  first:\n    runs-on: u\n  deploy: # later\n    name: shipped\n    runs-on: u\n')]).map((c) => c.name))
      .toEqual(['first', 'shipped'])
  })

  it('F6: a trailing comment on a name is not part of the name', () => {
    // Deriving `builder # x` where GitHub emits `builder` would have had the
    // guard MANUFACTURING a never-emitted name and recommending it as requirable.
    expect(scalar('builder # x')).toBe('builder')
    expect(scalar('"release #1"')).toBe('release #1')
    expect(scalar("'quoted'")).toBe('quoted')
  })

  it('F6: a quoted uses: still resolves the composite', () => {
    expect(calleeOf(["    uses: './.github/workflows/scheduled-failure-alert.yml'"]))
      .toEqual({ kind: 'local', ref: 'scheduled-failure-alert.yml' })
  })

  it('F6: flow-style and quoted on: are parsed, not silently emptied', () => {
    // An empty trigger set would drop a whole workflow out of the requirable
    // calculation without failing anything.
    expect(triggers('on: [push, pull_request]\njobs:\n')).toEqual(new Set(['push', 'pull_request']))
    expect(triggers('"on":\n  pull_request:\njobs:\n')).toEqual(new Set(['pull_request']))
    expect(triggers('on: push\njobs:\n')).toEqual(new Set(['push']))
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
