/**
 * Q107-O4 — which check-run names this repository can produce, and whether any
 * name identifies more than one job.
 *
 * A required status check under `Q-097` is matched by NAME. Three ways that goes
 * wrong, and they are genuinely different failures:
 *
 *   (a) AMBIGUITY   — one name, more than one job
 *   (b) NEVER-EMITTED — requiring a name no `pull_request`-triggered workflow
 *       produces; nothing on a PR head ever reports it, so the PR is blocked
 *       permanently
 *   (c) SKIPPABLE   — a name whose job CAN be skipped on a given PR. GitHub does
 *       not report a skipped-by-filter job at all, so a required check sits
 *       pending forever. This is (b) wearing a disguise, and it is the one an
 *       author is most likely to miss, because the name looks safe on the PR
 *       where the job did run.
 *
 * The `Q107-O4` ledger row describes only (a), and names it "blocks every PR
 * permanently", which is (b)'s mechanism rather than (a)'s.
 *
 * ## The measurement, and a correction that went the WRONG way first
 *
 * The row cites the `benchmark` collision between `ci.yml` and
 * `nightly-backtest.yml`. The first version of this file called that **latent**,
 * on the strength of two sampled commits where the two had not co-occurred.
 * **That was false, and it downgraded the row's severity in the flattering
 * direction.** Measured properly across 200 CI runs and 41 nightly runs: the two
 * workflows share **12 commits**, and **11 of those carry two or more check runs
 * named `benchmark`** — e.g. `f0fda05`, with run 33096354980 (Nightly Benchmark,
 * schedule) and 32982665852 (CI, push). It is live, and at least as live as the
 * other one. Two samples are not a "never".
 *
 * The other live collision is `alert / alert`: commit `50bbab4` carries two check
 * runs with that name, from *Weekly Data Refresh* (`34066964667`) and *Stryker
 * Weekly* (`34031930047`). All three callers of `scheduled-failure-alert.yml`
 * used the job id `alert`, and a reusable call reports as
 * `<caller job> / <called job>`. The ledger row does not mention it at all.
 *
 * A separate reading trap, worth keeping: three `benchmark` runs on `77cc18e`
 * looked like a collision and were not — same run ids as the three `alert / alert`
 * runs beside them, i.e. ONE workflow re-running on an unmoved `main` across
 * three weekdays, which GitHub supersedes by design. **Count the run ids and the
 * workflows before believing a duplicate name, in either direction.**
 *
 * ## The naming rules modelled here
 *
 * 1. A job's check-run name is its `name:` if present, else its job id.
 * 2. A job calling a reusable workflow reports one check per job in the CALLEE,
 *    named `<caller display name> / <callee job display name>`.
 * 3. A matrix job's name carries the matrix values in parentheses.
 *
 * Rule 2 is verified rather than assumed: `nightly-backtest.yml` was dispatched
 * against this branch (run 34368245585) and `actions/runs/<id>/jobs` returned
 * `nightly-benchmark` and `alert-nightly-benchmark / alert`.
 *
 * Rule 3 is modelled by NORMALISATION rather than expansion: `${{ … }}` becomes
 * `*`, so `stryker (${{ matrix.shard.name }})` is the template `stryker (*)`
 * which the four real names all instantiate.
 *
 * ## Why there is a hand-written parser here and not a YAML library
 *
 * `js-yaml` is present in `node_modules` only transitively; declaring it would
 * add a dependency the I8 vendor-licence register would then require a row for,
 * to read five fields out of six files. `scripts/ci/lint-workflows.sh` runs
 * pinned actionlint over these files and is the schema authority. The defence
 * here is different: the derivation is asserted against the check-run names
 * GitHub ACTUALLY emitted, before and after the rename. A parser that drops the
 * composite or the matrix suffix fails that comparison.
 *
 * It is still a parser, and red-team broke four inputs it mis-modelled — trailing
 * comments on a job header (which lost the job AND renamed the one above it),
 * `name: x # c`, a quoted `uses:`, and flow-style `on:`. Those are fixed and
 * asserted. The residue is in the CANNOT-do block.
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
 * Strip a trailing `#` comment and surrounding quotes from a scalar.
 *
 * A `#` inside quotes is data, not a comment — `name: "release #1"` is a valid
 * job name. Handled by unquoting first and only stripping a comment from the
 * unquoted remainder.
 */
export function scalar(raw: string): string {
  const t = raw.trim()
  const quoted = /^(['"])([\s\S]*?)\1\s*(?:#.*)?$/.exec(t)
  if (quoted) return quoted[2]
  return t.replace(/\s+#.*$/, '').trim()
}

/**
 * Job id -> the lines of that job's block.
 *
 * Jobs sit at two-space indent under `jobs:`; anything more deeply indented
 * belongs to the job above. A trailing comment on the header is tolerated: the
 * first version required end-of-line after the colon, so `  deploy: # later`
 * was not recognised as a job header AND its body was appended to the PREVIOUS
 * job — losing one job and corrupting another.
 */
export function jobBlocks(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let inJobs = false
  let current: string | null = null
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (/^jobs:\s*(?:#.*)?$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    if (/^\s*(?:#.*)?$/.test(line)) {
      if (current) out.get(current)?.push(line)
      continue
    }
    // A non-indented line ends the jobs mapping.
    if (/^\S/.test(line)) {
      inJobs = false
      current = null
      continue
    }
    const header = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line)
    if (header) {
      current = header[1]
      out.set(current, [])
      continue
    }
    if (current) out.get(current)?.push(line)
  }
  return out
}

/**
 * The events a workflow triggers on.
 *
 * Handles the three spellings GitHub accepts: a block mapping, the flow sequence
 * `on: [push, pull_request]`, and a bare `on: push`. `on` is also YAML 1.1's
 * boolean `true`, so `"on":` is legal and appears in the wild. The first version
 * handled only the block mapping and returned an EMPTY set for the others —
 * which would have silently dropped a whole workflow out of the requirable
 * calculation rather than failing.
 */
export function triggers(source: string): Set<string> {
  const out = new Set<string>()
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let inOn = false
  for (const line of lines) {
    const head = /^(?:on|['"]on['"]):\s*(.*?)\s*(?:#.*)?$/.exec(line)
    if (head) {
      const inline = head[1]
      if (inline.startsWith('[')) {
        for (const p of inline.replace(/^\[|\]$/g, '').split(',')) {
          const v = scalar(p)
          if (v) out.add(v)
        }
        return out
      }
      if (inline) {
        out.add(scalar(inline))
        return out
      }
      inOn = true
      continue
    }
    if (!inOn) continue
    if (/^\s*(?:#.*)?$/.test(line)) continue
    if (/^\S/.test(line)) break
    const m = /^ {2}([A-Za-z_]+):/.exec(line)
    if (m) out.add(m[1])
  }
  return out
}

/**
 * Filters under a given trigger, e.g. `paths` / `paths-ignore` / `branches`.
 *
 * These sit at four-space indent under the event and were entirely invisible to
 * the first version, which collected only the two-space event keys. A `paths:`
 * filter on `pull_request` is how a required check becomes unsatisfiable on a
 * docs-only PR — foot-gun (c).
 */
export function triggerFilters(source: string, event: string): Set<string> {
  const out = new Set<string>()
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let inOn = false
  let inEvent = false
  for (const line of lines) {
    if (/^(?:on|['"]on['"]):\s*(?:#.*)?$/.test(line)) {
      inOn = true
      continue
    }
    if (!inOn) continue
    if (/^\S/.test(line)) break
    const ev = /^ {2}([A-Za-z_]+):/.exec(line)
    if (ev) {
      inEvent = ev[1] === event
      continue
    }
    if (!inEvent) continue
    const f = /^ {4}([A-Za-z-]+):/.exec(line)
    if (f) out.add(f[1])
  }
  return out
}

const jobName = (id: string, block: string[]): string => {
  const named = block.map((l) => /^ {4}name:\s*(.+)$/.exec(l)).find(Boolean)
  return named ? normalise(scalar(named[1])) : id
}

/**
 * The reusable workflow a job calls, or `'remote'` for one outside this repo.
 *
 * The first version matched only an unquoted LOCAL `./.github/workflows/…` path,
 * so its "unresolvable" branch could fire on nothing actionlint would let
 * through — correct and unreachable, in the guard written to close a
 * reachability defect. A remote `uses: owner/repo/.github/workflows/x.yml@v1`
 * returned null and was modelled as an ordinary job, deriving `alert` where
 * GitHub emits `alert / <callee>`.
 */
export function calleeOf(block: string[]): { kind: 'local' | 'remote'; ref: string } | null {
  const m = block.map((l) => /^ {4}uses:\s*(.+)$/.exec(l)).find(Boolean)
  if (!m) return null
  const ref = scalar(m[1])
  const local = /^\.\/\.github\/workflows\/(\S+)$/.exec(ref)
  return local ? { kind: 'local', ref: local[1] } : { kind: 'remote', ref }
}

const isMatrix = (block: string[]): boolean => block.some((l) => /^ {6}matrix:\s*(?:#.*)?$/.test(l))

const hasJobIf = (block: string[]): boolean => block.some((l) => /^ {4}if:\s*\S/.test(l))

/**
 * Every check-run name this set of workflows can produce.
 *
 * A workflow whose only trigger is `workflow_call` produces no check of its own —
 * it is always reported under its caller — so it contributes nothing directly.
 * Emitting a bare `alert` here would be a phantom name GitHub never sends.
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
        const target = callee.kind === 'local' ? byPath.get(callee.ref) : undefined
        // Not silently skipped: a dropped edge is how a rule reaches zero
        // instances. Surfaced as a name the caller can assert on.
        if (!target) {
          out.push({ name: `${base} / <UNRESOLVED ${callee.ref}>`, workflow: file.path, jobId: id })
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
 * Names produced by more than one JOB.
 *
 * Keyed on `(workflow, jobId)`, not on workflow. The first version keyed on
 * workflow alone, reasoning that same-workflow duplicates are re-runs — but a
 * re-run is a different RUN of the same job, which `(workflow, jobId)` collapses
 * anyway, whereas two DIFFERENT jobs in one workflow sharing a `name:` is a real
 * ambiguity that went undetected. Red-team added a second `ci.yml` job called
 * `test` and the suite stayed green.
 */
export function collisions(names: readonly CheckName[]): Map<string, CheckName[]> {
  const byName = new Map<string, CheckName[]>()
  for (const c of names) {
    const bucket = byName.get(c.name)
    if (bucket) bucket.push(c)
    else byName.set(c.name, [c])
  }
  return new Map(
    [...byName].filter(([, v]) => new Set(v.map((c) => `${c.workflow} ${c.jobId}`)).size > 1),
  )
}

/** Why a name must not be required, or `null` if it is safe. */
export type Unsafe = { name: string; reason: string }

/**
 * Names it is NOT safe to require as a status check under `Q-097`, with the
 * reason — which is the useful output, because the three failure modes have
 * different fixes.
 */
export function unsafeToRequire(files: readonly WorkflowFile[]): Unsafe[] {
  const out: Unsafe[] = []
  const all = checkNames(files)
  const ambiguous = collisions(all)
  for (const [name, hits] of ambiguous) {
    out.push({ name, reason: `ambiguous — ${hits.map((h) => `${h.workflow}:${h.jobId}`).join(', ')}` })
  }

  const prFiles = files.filter((f) => triggers(f.source).has('pull_request'))
  const prNames = new Set(checkNames(prFiles).map((c) => c.name))
  for (const name of new Set(all.map((c) => c.name))) {
    if (ambiguous.has(name)) continue
    // A name the derivation could not resolve is not a name to hand an owner:
    // the real check will be `<caller> / <something we cannot see>`, so requiring
    // this string would demand a check GitHub never sends.
    if (name.includes('<UNRESOLVED ')) {
      out.push({ name, reason: 'the reusable workflow it calls is outside this repository, so the real name is unknown' })
      continue
    }
    if (!prNames.has(name)) out.push({ name, reason: 'no pull_request-triggered workflow emits it' })
  }

  // Skippable: a path filter on the PR trigger, or a job-level `if:`. GitHub does
  // not report a job skipped this way, so the required check never arrives.
  for (const f of prFiles) {
    const filters = triggerFilters(f.source, 'pull_request')
    const pathFiltered = filters.has('paths') || filters.has('paths-ignore')
    for (const [id, block] of jobBlocks(f.source)) {
      const name = jobName(id, block) + (isMatrix(block) && !jobName(id, block).includes('*') ? ' (*)' : '')
      if (ambiguous.has(name)) continue
      if (pathFiltered) out.push({ name, reason: `${f.path} filters pull_request by path — the job can be skipped` })
      else if (hasJobIf(block)) out.push({ name, reason: `${f.path}:${id} has a job-level if: — the job can be skipped` })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Names it is SAFE to require as a status check when `Q-097` lands.
 *
 * The artifact this package exists to produce. Everything excluded is excluded
 * for one of the three stated reasons, and `unsafeToRequire` says which.
 */
export function requirable(files: readonly WorkflowFile[]): string[] {
  const unsafe = new Set(unsafeToRequire(files).map((u) => u.name))
  const prFiles = files.filter((f) => triggers(f.source).has('pull_request'))
  return [...new Set(checkNames(prFiles).map((c) => c.name))].filter((n) => !unsafe.has(n)).sort()
}
