/**
 * I8 — vendor egress detection.
 *
 * I8 says: "Before any feature exposes vendor data to end users, confirm the
 * licence permits it and record the finding." The Q-079 audit rated the RECORDING
 * half VIOLATED, and the reason was not that anyone disagreed with the rule — it
 * was that nothing anywhere asked the question. PR #147 turned the stock-page news
 * surface from synthetic to live Yahoo content, descends from the commit that
 * wrote I8, and shipped with no licence finding recorded.
 *
 * This module answers exactly one question: **what does this repository reach out
 * to?** It does not, and cannot, decide whether reaching out is permitted. That is
 * Q-082/Q-083 and it belongs to counsel. What it can do is make an unregistered
 * vendor a red test, so the question is forced BEFORE the feature ships rather
 * than a year afterwards.
 *
 * ## Why two kinds, and why that is the load-bearing decision
 *
 * The obvious implementation scans for URL literals. On this repo that finds
 * CoinGecko, Kraken, Coinbase, Bybit, OKX and FRED — and **misses Yahoo entirely**,
 * because `yahoo-finance2` is library-mediated across 21 files and never writes a
 * host. Yahoo is the vendor with the most surface area, the one PR #147 exposed,
 * and the one the audit names first. A URL-only guard would have been green on it.
 *
 * That is the reachability defect this repo has now hit in four packages: the rule
 * was right and the scan never visited the thing it governed. So the detector has
 * a second kind — every entry in `dependencies` AND `devDependencies` — and a
 * third for hosts assembled at runtime, which a literal scan structurally cannot
 * resolve.
 *
 * ## Pure function, deliberately
 *
 * Input is a virtual file set plus a manifest; there is no `fs` in here. Every
 * escape anyone thinks of becomes an executable test case instead of a paragraph
 * in a review document. See `vendor-licence-register.test.ts`.
 */

export type EgressKind =
  | 'http-host'
  | 'dynamic-host'
  | 'env-host'
  | 'npm-package'
  | 'pip-package'
  | 'published-data'

export interface EgressPoint {
  kind: EgressKind
  /**
   * `http-host` -> lowercased hostname.
   * `dynamic-host` -> the path of the file that builds a host at runtime.
   * `env-host`   -> the environment variable that supplies a host.
   * `npm-package` / `pip-package` -> the package name.
   * `published-data` -> a tracked path this repository REPUBLISHES.
   */
  id: string
  /** `path:line` for source hits, `package.json#<block>` for manifest hits. */
  where: string
}

export interface SourceFile {
  path: string
  source: string
}

export interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Comments stripped before matching, for the reason Q-101 recorded: a guard that
 * matches prose about the behaviour instead of the behaviour is green when the
 * behaviour is deleted. Here the direction is reversed — a host in a comment is
 * documentation, not egress, and registering documentation would bury the real
 * rows in noise.
 */
export const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * Loopback is excluded as a PROPERTY, not as a named allowlist.
 *
 * The distinction matters and this repo has paid for it twice: Q-098 found that an
 * allowlist of module names and then an allowlist of directories were the same
 * defect one level up. "Does not leave the machine" is a fact about the address.
 * "Is called `fonts.googleapis.com`" is a judgement about a vendor, and judgements
 * belong in the register where a reviewer sees them in the diff.
 */
const isLoopback = (host: string): boolean =>
  host === 'localhost' ||
  host === '0.0.0.0' ||
  host === '[::1]' ||
  /^127\.\d+\.\d+\.\d+$/.test(host) ||
  host.endsWith('.localhost')

/**
 * A hostname must contain a dot or be a bare label; anything with a template hole,
 * a quote or whitespace in it was never a hostname. Returning `null` here routes
 * the hit to `dynamic-host` rather than inventing a vendor called `${base}`.
 */
function hostnameOf(raw: string): string | null {
  const authority = raw.split(/[/?#]/)[0].toLowerCase()
  // Strip the port BEFORE anything else. Without this `http://localhost:3000`
  // fails the hostname shape (a colon is not a legal host character), returns
  // null, and is reported as a DYNAMIC host — so four loopback sites, including
  // a CI workflow and a FastAPI CORS list, became permanent register noise and a
  // genuine env-built host with a port would have been misfiled beside them.
  // Caught by widening the walk, not by reading the regex.
  const cut = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1) // IPv6 literal
    : authority.split(':')[0]
  if (cut === '' || /[${}'"`\s\\<>()]/.test(cut)) return null
  // Trailing punctuation from prose or a split string literal: "https://www." etc.
  const trimmed = cut.replace(/[.,;:]+$/, '')
  if (trimmed === '' || !/^[a-z0-9][a-z0-9.-]*$/.test(trimmed)) return null
  return trimmed
}

/**
 * Environment variables that can point this application at a host.
 *
 * THIS IS THE ROW THAT MATTERS MOST, and it exists because the first two kinds
 * were not enough. `lib/data/bloomberg/bridgeClient.ts` is a live, wired Bloomberg
 * data path consumed by `app/api/prices/route.ts` — and it contains **no URL and
 * no vendor package**. The host arrives entirely through `BLOOMBERG_BRIDGE_URL`.
 * A literal scan plus a manifest scan is green on the strictest-licensed vendor
 * in the industry.
 *
 * The name is the unit of registration, not the value: the value is deployment
 * configuration we cannot see, but "which variables can retarget this app" is a
 * fact about the source and is exactly the question I8 wants asked.
 *
 * Matched on the trailing token so `NEXT_PUBLIC_BASE_PATH` (a path, not a host)
 * does not qualify while `TRADING_AGENTS_BASE` does.
 */
const HOST_BEARING_NAME = /(?:^|_)(URL|URI|BASE|ENDPOINT|HOST|ORIGIN)$/

function envHostNames(source: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  source.split('\n').forEach((line, i) => {
    // JS/TS: process.env.NAME and process.env['NAME']
    // Python: os.environ.get("NAME"), os.environ["NAME"], os.getenv("NAME")
    const re = /(?:process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]|os\.environ(?:\.get)?\(?\[?['"]([A-Z0-9_]+)['"]|os\.getenv\(\s*['"]([A-Z0-9_]+)['"])/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4]
      if (name && HOST_BEARING_NAME.test(name)) out.push({ name, line: i + 1 })
    }
  })
  return out
}

/**
 * Python dependencies.
 *
 * Added after review, and the omission is instructive: this file already carried a
 * test named "catches a vendor client added to devDependencies" — the second block
 * of the manifest it read — while an entire SECOND MANIFEST went unvisited.
 * `requirements.txt` declares `yfinance`, `akshare` and `tradingagents`, all
 * vendor-bearing, none of them recorded. Reading one block of one manifest and
 * calling it "every dependency" is the reachability defect with a narrower scope,
 * not a different defect.
 */
function pipPackages(source: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  source.split('\n').forEach((raw, i) => {
    const line = raw.split('#')[0].trim()
    if (!line || line.startsWith('-')) return
    // `pkg`, `pkg>=1.2`, `pkg[extra]>=1.2`, `pkg==1.0`
    const m = /^([A-Za-z0-9._-]+)(\[[^\]]*\])?\s*([<>=!~].*)?$/.exec(line)
    if (m) out.push({ name: m[1].toLowerCase(), line: i + 1 })
  })
  return out
}

/**
 * Data this repository REPUBLISHES, as opposed to data it fetches.
 *
 * The mechanism above detects EGRESS. I8 governs EXPOSURE, and those are different
 * sets — the difference contains the largest redistribution act in this project.
 * `scripts/backtestData/` holds 57 tracked files, 13 MB of vendor-derived daily
 * OHLCV, in a repository `gh repo view` reports as PUBLIC, and
 * `.github/workflows/refresh-data.yml` stages and pushes a refreshed bulk copy
 * every week from a bot, with every prior vintage retained in git objects forever.
 *
 * No host is reached, no dependency added, no environment variable read — so every
 * earlier kind here is blind to it, while it is a more complete exposure of vendor
 * data to end users than any UI surface in the platform.
 *
 * Detected as a property of the workflow: a path staged with `git add` in a file
 * that also pushes.
 */
function publishedPaths(path: string, source: string): { target: string; line: number }[] {
  if (!/\.ya?ml$/.test(path) || !/git\s+push/.test(source)) return []
  const out: { target: string; line: number }[] = []
  source.split('\n').forEach((line, i) => {
    const m = /git\s+add\s+(?:-[A-Za-z]+\s+)*([^\s;&|]+)/.exec(line)
    if (m && m[1] !== '.' && m[1] !== '-A') out.push({ target: m[1], line: i + 1 })
  })
  return out
}

/**
 * Detect every point at which this repository reaches a host it does not own, and
 * every third-party package that could reach one on its behalf.
 *
 * Returns one point per DISTINCT (kind, id, where) so that a vendor used in ten
 * files produces ten pieces of evidence rather than one.
 */
export function detectEgress(files: SourceFile[], manifest: Manifest = {}): EgressPoint[] {
  const points: EgressPoint[] = []
  const seen = new Set<string>()

  const push = (p: EgressPoint) => {
    const key = `${p.kind}|${p.id}|${p.where}`
    if (seen.has(key)) return
    seen.add(key)
    points.push(p)
  }

  for (const file of files) {
    const lines = stripComments(file.source).split('\n')
    lines.forEach((line, i) => {
      const where = `${file.path}:${i + 1}`
      // Match the scheme plus everything up to the first delimiter that cannot
      // appear in a URL. Template holes are captured deliberately so they can be
      // classified as dynamic rather than silently dropped.
      const re = /\bhttps?:\/\/([^\s'"`)\],;<>]*)/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        const raw = m[1]
        const host = hostnameOf(raw)
        if (host === null) {
          // `https://${vercelHost}` and friends. The host is not knowable from
          // source, so the FILE is the unit that must be registered.
          push({ kind: 'dynamic-host', id: file.path, where })
          continue
        }
        if (isLoopback(host)) continue
        push({ kind: 'http-host', id: host, where })
      }
    })

    for (const { name, line } of envHostNames(stripComments(file.source))) {
      push({ kind: 'env-host', id: name, where: `${file.path}:${line}` })
    }

    if (/(^|\/)requirements[^/]*\.txt$/.test(file.path)) {
      for (const { name, line } of pipPackages(file.source)) {
        push({ kind: 'pip-package', id: name, where: `${file.path}:${line}` })
      }
    }

    for (const { target, line } of publishedPaths(file.path, file.source)) {
      push({ kind: 'published-data', id: target, where: `${file.path}:${line}` })
    }
  }

  // Both blocks. Reading only `dependencies` leaves a constructible hole: add a
  // vendor client to `devDependencies`, import it from `lib/`, ship green.
  for (const block of ['dependencies', 'devDependencies'] as const) {
    const names = Object.keys(manifest[block] ?? {}).sort()
    for (const name of names) {
      push({ kind: 'npm-package', id: name, where: `package.json#${block}` })
    }
  }

  return points
}

/** Collapse evidence so a register row is compared against one id, not N hits. */
export function distinctIds(points: EgressPoint[]): Map<string, EgressPoint[]> {
  const out = new Map<string, EgressPoint[]>()
  for (const p of points) {
    const key = `${p.kind}|${p.id}`
    const bucket = out.get(key)
    if (bucket) bucket.push(p)
    else out.set(key, [p])
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// The register comparator.
//
// Kept here, beside the detector and free of `fs`, so that the real tree and a
// three-line virtual file set travel through EXACTLY the same code. Q-079 left
// seven mutations described in a review document; Q-098 turned them into tests
// and found that three of them had never been reachable. Prose does not run.
// ─────────────────────────────────────────────────────────────────────────────

export type LicenceStatus =
  | 'NONE_NO_AGREEMENT'
  | 'PERMITTED'
  | 'RESTRICTED'
  | 'UNVERIFIED'
  | 'NOT_APPLICABLE'

export interface RegisterEntry {
  kind: EgressKind
  id: string
  lifecycle: 'active' | 'withdrawn'
  classification: string
  vendor: string
  end_user_exposed: boolean
  authenticated: boolean
  licence_status: LicenceStatus
  finding: string
  recorded_by: string
  recorded_on: string
  evidence?: string[]
  routes_to?: string[]
  /** Required when the row is end-user exposed: where the redistribution question stands. */
  redistribution_position?: string
  /** Required by `PERMITTED`: the document that permits it. */
  licence_evidence?: string
  withdrawn_on?: string
  withdrawn_reason?: string
  cross_reference?: string
}

export interface Violation {
  rule: string
  kind: EgressKind
  id: string
  detail: string
}

const key = (kind: EgressKind, id: string) => `${kind}|${id}`
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Compare what the repository reaches against what has been recorded.
 *
 * Returns every violation rather than throwing on the first, because the useful
 * output of a compliance gate is the whole list.
 */
export function checkRegister(points: EgressPoint[], entries: RegisterEntry[]): Violation[] {
  const v: Violation[] = []
  const byKey = new Map<string, RegisterEntry>()

  for (const e of entries) {
    const k = key(e.kind, e.id)
    if (byKey.has(k)) {
      v.push({ rule: 'duplicate-row', kind: e.kind, id: e.id, detail: 'the same (kind, id) is recorded twice; findings would disagree silently' })
      continue
    }
    byKey.set(k, e)
  }

  const detected = distinctIds(points)

  // 1. Anything reached must be recorded. This is the gate.
  for (const [k, hits] of detected) {
    if (byKey.has(k)) continue
    const [kind, ...rest] = k.split('|')
    v.push({
      rule: 'unregistered',
      kind: kind as EgressKind,
      id: rest.join('|'),
      detail:
        `reached from ${hits[0].where}${hits.length > 1 ? ` (+${hits.length - 1} more)` : ''} ` +
        `with no row in reviews/vendor-licence-register.json. I8: confirm the licence permits it AND record the finding.`,
    })
  }

  for (const e of entries) {
    const live = detected.has(key(e.kind, e.id))

    // 2. Lifecycle. A row whose surface is gone is marked withdrawn, NEVER deleted:
    //    withdrawing is the outcome I8 offers as the alternative to a finding, and
    //    if that turned the gate red, destroying the audit trail would be the way
    //    to green — the same shape as a floor that punishes logging more trials.
    if (e.lifecycle === 'active' && !live) {
      v.push({ rule: 'stale-active', kind: e.kind, id: e.id, detail: 'recorded active but nothing reaches it. Mark it withdrawn with a date and a reason — do not delete the row.' })
    }
    if (e.lifecycle === 'withdrawn') {
      if (live) {
        v.push({ rule: 'withdrawn-but-live', kind: e.kind, id: e.id, detail: 'recorded withdrawn, but the tree still reaches it. The claim and the code disagree.' })
      }
      if (!e.withdrawn_on || !ISO_DATE.test(e.withdrawn_on) || !e.withdrawn_reason?.trim()) {
        v.push({ rule: 'withdrawn-without-reason', kind: e.kind, id: e.id, detail: 'withdrawn rows need withdrawn_on (YYYY-MM-DD) and withdrawn_reason' })
      }
    }

    // 3. The finding must actually be a finding.
    if (!e.finding?.trim()) v.push({ rule: 'missing-finding', kind: e.kind, id: e.id, detail: 'a row with no finding records nothing' })
    if (!e.recorded_by?.trim()) v.push({ rule: 'missing-recorder', kind: e.kind, id: e.id, detail: 'a finding with no name on it cannot be questioned' })
    if (!ISO_DATE.test(e.recorded_on ?? '')) v.push({ rule: 'bad-recorded-on', kind: e.kind, id: e.id, detail: 'recorded_on must be YYYY-MM-DD; a finding without a vintage cannot be known to be stale' })

    // 4. PERMITTED is the only status that closes the question, so it is the only
    //    one that can be typed in to turn this suite green. It costs a document.
    if (e.licence_status === 'PERMITTED' && !e.licence_evidence?.trim()) {
      v.push({ rule: 'permitted-without-evidence', kind: e.kind, id: e.id, detail: 'PERMITTED requires licence_evidence naming the agreement that permits it' })
    }

    // 5. A licence that forbids the use cannot coexist with a live surface.
    if (e.licence_status === 'RESTRICTED' && e.lifecycle === 'active' && live) {
      v.push({ rule: 'restricted-but-active', kind: e.kind, id: e.id, detail: 'a licence recorded as NOT permitting this use, with the surface still live. Withdraw the surface.' })
    }

    // 6. Anything users can see carries the redistribution question explicitly, so
    //    that "we never thought about it" and "we thought about it and it is open"
    //    cannot be confused for one another.
    if (e.end_user_exposed && !e.redistribution_position?.trim()) {
      v.push({ rule: 'exposed-without-position', kind: e.kind, id: e.id, detail: 'end-user-exposed rows must state where the redistribution question stands' })
    }
  }

  return v
}
