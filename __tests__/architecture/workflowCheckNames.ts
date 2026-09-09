/**
 * Q107-O4 — which check-run names this repository can produce, and whether any
 * name identifies more than one job.
 *
 * A required status check under `Q-097` is matched by NAME. So a name produced by
 * two different workflows is ambiguous, and a name produced by NO
 * `pull_request`-triggered workflow can never be satisfied on a pull request —
 * requiring it would block every PR permanently. Those are two different
 * foot-guns and the ledger row for `Q107-O4` conflates them; both are checked
 * here, separately.
 *
 * ## What was actually measured, because the row's example was the weaker case
 *
 * The row names the `benchmark` collision between `ci.yml` and
 * `nightly-backtest.yml`. Real check-run data says that one is **latent**: only
 * `ci.yml` fires on `pull_request`, and the two have never co-occurred on a
 * commit. Three `benchmark` runs on `77cc18e` looked like a collision and were
 * not — same run ids as the three `alert / alert` runs beside them, i.e. ONE
 * workflow re-running on an unmoved `main` across three weekdays, which GitHub
 * supersedes by design.
 *
 * The **live** collision is `alert / alert`. Commit `50bbab4` carries two check
 * runs with that name, from *Weekly Data Refresh* (`34066964667`) and *Stryker
 * Weekly* (`34031930047`) — different workflows, one commit, one name. All three
 * callers of `scheduled-failure-alert.yml` used the job id `alert`, and a
 * reusable-workflow call reports as `<caller job> / <called job>`.
 *
 * Counting run ids before believing a duplicate is the lesson: a repeated name on
 * one commit is a collision only if the runs come from different workflows.
 *
 * ## The naming rules modelled here
 *
 * 1. A job's check-run name is its `name:` if present, else its job id.
 * 2. A job calling a reusable workflow reports one check per job in the CALLEE,
 *    named `<caller display name> / <callee job display name>`.
 * 3. A matrix job's name carries the matrix values in parentheses.
 *
 * Rule 3 is modelled by NORMALISATION rather than expansion: `${{ … }}` becomes
 * `*`, so `stryker (${{ matrix.shard.name }})` is the template `stryker (*)`
 * which the four real names all instantiate. Two jobs whose templates are equal
 * CAN collide, which is the question being asked. The cost is that two jobs whose
 * templates differ only inside an expression are not distinguished — asserted as
 * a CANNOT-do test rather than left implied.
 *
 * ## Why there is a hand-written parser here and not a YAML library
 *
 * `js-yaml` is present in `node_modules` only transitively; declaring it would
 * add a dependency that the I8 vendor-licence register would then require a row
 * for, to read four fields out of six files. `scripts/ci/lint-workflows.sh` runs
 * pinned actionlint over these files and is the schema authority, and its own
 * comment records the danger of a lenient proxy parser. The defence adopted here
 * is different and stronger for this purpose: the derivation is asserted against
 * the check-run names GitHub ACTUALLY emitted. A parser that silently drops the
 * `/` composite or the matrix suffix fails that comparison.
 */

export interface WorkflowFile {
  /** Base name, e.g. `ci.yml`. */
  path: string
  source: string
}

export interface CheckName {
  /** Normalised name, `${{ … }}` collapsed to `*`. */
  name: string
  workflow: string
  jobId: string
}

/** Collapse expressions so a matrix template compares as one name. */
export const normalise = (s: string): string => s.replace(/\$\{\{[^}]*\}\}/g, '*').trim()

/**
 * Job id -> the lines of that job's block.
 *
 * Jobs sit at two-space indent under `jobs:`; anything more deeply indented
 * belongs to the job above. Deliberately tolerant of comment and blank lines,
 * which every workflow in this repository is full of.
 */
export function jobBlocks(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const lines = source.split('\n')
  let inJobs = false
  let current: string | null = null
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    // A non-indented, non-blank line ends the jobs mapping.
    if (/^\S/.test(line)) {
      inJobs = false
      current = null
      continue
    }
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (header) {
      current = header[1]
      out.set(current, [])
      continue
    }
    if (current) out.get(current)?.push(line)
  }
  return out
}

/** The events a workflow triggers on. */
export function triggers(source: string): Set<string> {
  const out = new Set<string>()
  const lines = source.split('\n')
  let inOn = false
  for (const line of lines) {
    if (/^on:\s*$/.test(line)) {
      inOn = true
      continue
    }
    if (!inOn) continue
    if (/^\S/.test(line)) break
    const m = /^ {2}([A-Za-z_]+):/.exec(line)
    if (m) out.add(m[1])
  }
  return out
}

const jobName = (id: string, block: string[]): string => {
  const named = block.map((l) => /^ {4}name:\s*(.+?)\s*$/.exec(l)).find(Boolean)
  return named ? normalise(named[1].replace(/^['"]|['"]$/g, '')) : id
}

const calleeOf = (block: string[]): string | null => {
  const m = block.map((l) => /^ {4}uses:\s*\.\/\.github\/workflows\/(\S+)\s*$/.exec(l)).find(Boolean)
  return m ? m[1] : null
}

const isMatrix = (block: string[]): boolean => block.some((l) => /^ {6}matrix:\s*$/.test(l))

/**
 * Every check-run name this set of workflows can produce.
 *
 * A workflow whose only trigger is `workflow_call` produces no check of its own —
 * it is always reported under its caller — so it contributes nothing directly.
 * Getting that wrong would invent a phantom `alert` name that GitHub never emits,
 * and the oracle test would catch it.
 */
export function checkNames(files: readonly WorkflowFile[]): CheckName[] {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const out: CheckName[] = []

  for (const file of files) {
    const on = triggers(file.source)
    if (on.size === 1 && on.has('workflow_call')) continue

    for (const [id, block] of jobBlocks(file.source)) {
      const base = jobName(id, block)
      const callee = calleeOf(block)

      if (callee !== null) {
        const target = byPath.get(callee)
        // An unresolvable callee is not silently skipped: dropping the edge is
        // how a rule ends up with zero instances. It is surfaced as a name so the
        // caller can assert on it.
        if (!target) {
          out.push({ name: `${base} / <UNRESOLVED ${callee}>`, workflow: file.path, jobId: id })
          continue
        }
        for (const [innerId, innerBlock] of jobBlocks(target.source)) {
          out.push({
            name: `${base} / ${jobName(innerId, innerBlock)}`,
            workflow: file.path,
            jobId: `${id} -> ${innerId}`,
          })
        }
        continue
      }

      const suffix = isMatrix(block) && !base.includes('*') ? ' (*)' : ''
      out.push({ name: base + suffix, workflow: file.path, jobId: id })
    }
  }
  return out
}

/**
 * Names produced by more than one WORKFLOW.
 *
 * Keyed on workflow rather than on job, because two runs of the same workflow
 * carrying the same name are re-runs, which GitHub supersedes. Treating those as
 * collisions is the misreading that the measurement above corrects.
 */
export function collisions(names: readonly CheckName[]): Map<string, CheckName[]> {
  const byName = new Map<string, CheckName[]>()
  for (const c of names) {
    const bucket = byName.get(c.name)
    if (bucket) bucket.push(c)
    else byName.set(c.name, [c])
  }
  return new Map(
    [...byName].filter(([, v]) => new Set(v.map((c) => c.workflow)).size > 1),
  )
}

/**
 * Names it is SAFE to require as a status check under `Q-097`.
 *
 * Both conditions must hold, and they are different failures. A name no
 * PR-triggered workflow emits can never go green on a pull request, so requiring
 * it blocks every merge permanently — that is the sharp edge the `Q107-O4` row
 * describes, and it applies to `axe`, `refresh`, `stryker (*)` and every alert
 * composite, NOT to `benchmark`.
 */
export function requirable(files: readonly WorkflowFile[]): string[] {
  const prFiles = files.filter((f) => triggers(f.source).has('pull_request'))
  const prNames = checkNames(prFiles)
  const ambiguous = collisions(checkNames(files))
  return [...new Set(prNames.map((c) => c.name))].filter((n) => !ambiguous.has(n)).sort()
}
