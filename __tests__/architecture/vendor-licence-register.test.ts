/**
 * I8 — "confirm the licence permits it AND RECORD THE FINDING."
 *
 * The Q-079 audit rated I8's PROCESS half VIOLATED, and the reason was never that
 * anyone disagreed with the rule. It was that nothing anywhere asked the question.
 * PR #147 turned the stock-page news surface from synthetic to live Yahoo content,
 * descends from the commit that wrote I8, and shipped with no licence finding
 * recorded. There was no checklist, no PR template and no check to notice.
 *
 * This file is the mechanism. It fails when this repository reaches a host,
 * depends on a package, or reads a host-bearing environment variable that has no
 * row in `reviews/vendor-licence-register.json`.
 *
 * ## What it does NOT do, stated first so a green run is never misread
 *
 * It cannot decide whether reaching out is permitted — that is Q-082/Q-083 and it
 * belongs to counsel. It checks that a judgement was RECORDED, never that the
 * judgement is CORRECT. And until Q-097 lands, `main` has no branch protection and
 * an empty required-check set, so a red result here is advisory like every other
 * check in this repository.
 *
 * ## REACHABILITY FIRST
 *
 * Three packages in a row have shipped a guard that was correct and unreachable —
 * the scan simply never visited the fixture directory, the top-level directory,
 * the file extension the rule governed, and the suite stayed green at zero
 * instances. **When a guard is green, ask what it VISITED before you ask what it
 * decided.** So the first describe block asserts the walk found specific real
 * files and specific real vendors, and every later assertion would be vacuous
 * without it.
 *
 * That block is not decoration. Writing this guard, the walk was widened twice and
 * each widening found a vendor the previous version was structurally blind to:
 *   - `.py` files       -> `api.deepseek.com`, invisible to a TypeScript-only scan
 *   - env-var hosts     -> `BLOOMBERG_BRIDGE_URL`, a LIVE Bloomberg path with no
 *                          URL literal and no vendor package anywhere in source
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'
import {
  detectEgress,
  checkRegister,
  distinctIds,
  type SourceFile,
  type RegisterEntry,
  type EgressPoint,
} from './vendorEgress'

const ROOT = join(__dirname, '../..')

/**
 * Vendored dependencies, build output, and test/fixture trees. Everything else is
 * scanned — the walk enumerates nothing, because Q-098 established twice that an
 * allowlist of names and an allowlist of directories are the same defect one level
 * up. `.github` is admitted explicitly since a workflow can reach a vendor too.
 */
const IGNORED = new Set([
  'node_modules', '.next', 'coverage', 'dist', 'build', '.git',
  '__pycache__', 'venv', '.venv', 'public', '__tests__', 'tests',
])

/**
 * Executable source of ANY extension, which is the property that matters — not a
 * list of the extensions we happened to think of. `.py` was added because it had
 * to be: a whole vendor lived there.
 */
const EXECUTABLE = /\.(tsx?|jsx?|mjs|cjs|py|ya?ml)$/

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry.startsWith('.') && entry !== '.github') continue
      walk(full, out)
    } else if (EXECUTABLE.test(entry)) out.push(full)
  }
  return out
}

const files: SourceFile[] = walk(ROOT).map((f) => ({
  path: relative(ROOT, f).split(sep).join('/'),
  source: readFileSync(f, 'utf8'),
}))

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const register = JSON.parse(readFileSync(join(ROOT, 'reviews/vendor-licence-register.json'), 'utf8')) as {
  entries: RegisterEntry[]
}
const points = detectEgress(files, manifest)
const detected = distinctIds(points)
const has = (kind: string, id: string) => detected.has(`${kind}|${id}`)

// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — the scan is reachable', () => {
  it('walks the repository, not a corner of it', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it.each([
    ['a nested client hook', 'components/crypto/hooks/useBtcCandles.ts'],
    ['a root-level module', 'middleware.ts'],
    ['an .mjs script', 'scripts/diagnose-crypto.mjs'],
    ['a .py module outside the app tree', 'multi_agent_factor_mining/config.py'],
    ['a CI workflow in a dot-directory', '.github/workflows/ci.yml'],
    ['the Bloomberg bridge client', 'lib/data/bloomberg/bridgeClient.ts'],
  ])('visits %s', (_what, path) => {
    expect(files.map((f) => f.path)).toContain(path)
  })

  it.each([
    'api.coingecko.com', 'api.kraken.com', 'api.exchange.coinbase.com',
    'api.bybit.com', 'www.okx.com', 'fred.stlouisfed.org',
  ])('detects the %s host literal', (host) => {
    expect(has('http-host', host)).toBe(true)
  })

  it('detects a vendor that writes no URL anywhere (Yahoo, via its package)', () => {
    // yahoo-finance2 is the largest vendor surface in the repo and appears in 21
    // modules without a single host literal. A URL-only guard is green on it.
    expect(has('npm-package', 'yahoo-finance2')).toBe(true)
  })

  it('detects a vendor with no URL AND no package (Bloomberg, via its env var)', () => {
    // lib/data/bloomberg/bridgeClient.ts is wired into app/api/prices/route.ts and
    // the host arrives entirely through BLOOMBERG_BRIDGE_URL. This assertion is the
    // reason the env-host kind exists.
    expect(has('env-host', 'BLOOMBERG_BRIDGE_URL')).toBe(true)
  })

  it('detects a vendor reachable only from Python', () => {
    expect(has('http-host', 'api.deepseek.com')).toBe(true)
  })

  it('finds enough distinct egress points to be worth checking', () => {
    expect(detected.size).toBeGreaterThan(50)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — every vendor this repository reaches is recorded', () => {
  const violations = checkRegister(points, register.entries)

  it('has no unregistered egress point', () => {
    const unregistered = violations
      .filter((v) => v.rule === 'unregistered')
      .map((v) => `${v.kind} ${v.id} — ${v.detail}`)
    expect(unregistered).toEqual([])
  })

  it('has no register row that has rotted', () => {
    const rot = violations
      .filter((v) => v.rule === 'stale-active' || v.rule === 'withdrawn-but-live')
      .map((v) => `${v.rule}: ${v.kind} ${v.id} — ${v.detail}`)
    expect(rot).toEqual([])
  })

  it('records a real finding, with a name and a vintage, on every row', () => {
    const thin = violations
      .filter((v) => ['missing-finding', 'missing-recorder', 'bad-recorded-on', 'duplicate-row', 'withdrawn-without-reason'].includes(v.rule))
      .map((v) => `${v.rule}: ${v.kind} ${v.id}`)
    expect(thin).toEqual([])
  })

  it('lets nobody close the question by typing PERMITTED', () => {
    const bare = violations.filter((v) => v.rule === 'permitted-without-evidence').map((v) => v.id)
    expect(bare).toEqual([])
  })

  it('serves nothing a recorded licence forbids', () => {
    const forbidden = violations.filter((v) => v.rule === 'restricted-but-active').map((v) => v.id)
    expect(forbidden).toEqual([])
  })

  it('states where redistribution stands for everything a user can see', () => {
    const silent = violations.filter((v) => v.rule === 'exposed-without-position').map((v) => v.id)
    expect(silent).toEqual([])
  })

  it('is clean overall', () => {
    expect(violations).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — the register has not been quietly softened', () => {
  const entries = register.entries
  const exposed = entries.filter((e) => e.end_user_exposed && e.lifecycle === 'active')

  it('still records that market data reaches end users', () => {
    // If this ever drops to zero, either the surfaces were withdrawn (in which
    // case the rows say `withdrawn` and this is correct) or someone flipped a
    // boolean. The count is asserted so the second cannot happen quietly.
    expect(exposed.length).toBeGreaterThanOrEqual(6)
  })

  it('names the six unauthenticated market-data vendors the audit found', () => {
    const ids = new Set(entries.filter((e) => e.classification === 'market-data-vendor').map((e) => e.id))
    for (const id of ['yahoo-finance2', 'api.coingecko.com', 'api.kraken.com', 'api.exchange.coinbase.com', 'api.bybit.com', 'www.okx.com']) {
      expect(ids).toContain(id)
    }
  })

  it('does not claim a licence anywhere, because none has been produced', () => {
    // Not a permanent assertion — when counsel produces an agreement, the row gets
    // PERMITTED plus licence_evidence and THIS test is the one that must be edited,
    // deliberately and in the same diff. That is the intent: an upgrade of the
    // claim should be a visible act, never a side effect.
    expect(entries.filter((e) => e.licence_status === 'PERMITTED')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Positive controls. Each mutation below is an escape someone could actually
// attempt; each must be caught. These exercise the DETECTOR — the block above
// exercises the WALKER, and both were mutated against the committed tree.
// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — the guard catches what it claims to catch', () => {
  const f = (path: string, source: string): SourceFile[] => [{ path, source }]
  const unregistered = (pts: EgressPoint[]) =>
    checkRegister(pts, register.entries).filter((v) => v.rule === 'unregistered').map((v) => v.id)

  it('catches a new host in a new nested file', () => {
    expect(unregistered(detectEgress(f('lib/data/providers/newVendor.ts', `const B = 'https://api.polygon.io/v2'`))))
      .toContain('api.polygon.io')
  })

  it('catches a host inside a template literal with an interpolated path', () => {
    expect(unregistered(detectEgress(f('app/api/x/route.ts', 'const u = `https://api.tiingo.com/tiingo/daily/${t}/prices`'))))
      .toContain('api.tiingo.com')
  })

  it('catches a host in a .tsx component', () => {
    expect(unregistered(detectEgress(f('components/X.tsx', `fetch('https://api.iex.cloud/v1/data')`))))
      .toContain('api.iex.cloud')
  })

  it('catches a host carrying a port', () => {
    // Regression: an early version returned null for `host:port`, filed it as a
    // dynamic host, and would have hidden a real vendor beside four loopback rows.
    expect(unregistered(detectEgress(f('lib/x.ts', `const u = 'https://data.vendor.example:8443/v1'`))))
      .toContain('data.vendor.example')
  })

  it('catches a host that only exists in Python', () => {
    expect(unregistered(detectEgress(f('quant_framework/feed.py', `URL = "https://api.quandl.com/v3"`))))
      .toContain('api.quandl.com')
  })

  it('catches a vendor client added to devDependencies', () => {
    // The hole an obvious implementation leaves: read only `dependencies`, then
    // add the client to `devDependencies` and import it from lib/.
    expect(unregistered(detectEgress([], { devDependencies: { 'alpha-vantage': '^2.0.0' } })))
      .toContain('alpha-vantage')
  })

  it('catches a vendor client added to dependencies', () => {
    expect(unregistered(detectEgress([], { dependencies: { 'polygon.io-client': '^1.0.0' } })))
      .toContain('polygon.io-client')
  })

  it('catches a new host-bearing environment variable', () => {
    expect(unregistered(detectEgress(f('lib/feed.ts', `const b = process.env.REFINITIV_BASE_URL`))))
      .toContain('REFINITIV_BASE_URL')
  })

  it('catches a host-bearing environment variable read from Python', () => {
    expect(unregistered(detectEgress(f('ml/feed.py', `b = os.environ.get("FACTSET_ENDPOINT")`))))
      .toContain('FACTSET_ENDPOINT')
  })

  it('catches a host assembled from a variable, as a dynamic host on that file', () => {
    expect(unregistered(detectEgress(f('lib/sneaky.ts', 'const u = `https://${vendorHost}/v1/quotes`'))))
      .toContain('lib/sneaky.ts')
  })

  it('does NOT fire on a host that only appears in a comment', () => {
    // A comment issues no request. Registering documentation would bury the real
    // rows in noise, which is its own kind of failure.
    expect(unregistered(detectEgress(f('lib/x.ts', `// see https://api.example.com/docs\nexport const x = 1`))))
      .toEqual([])
  })

  it('does NOT fire on loopback, with or without a port', () => {
    expect(unregistered(detectEgress(f('lib/x.ts', `const a='http://localhost:3000'; const b='http://127.0.0.1:8099'`))))
      .toEqual([])
  })

  it('does NOT fire on an environment variable that names a path rather than a host', () => {
    expect(unregistered(detectEgress(f('lib/x.ts', `const p = process.env.NEXT_PUBLIC_BASE_PATH`))))
      .toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — the lifecycle cannot punish doing the right thing', () => {
  const row = (over: Partial<RegisterEntry>): RegisterEntry => ({
    kind: 'http-host', id: 'api.gone.example', lifecycle: 'active',
    classification: 'market-data-vendor', vendor: 'Gone', end_user_exposed: false,
    authenticated: false, licence_status: 'NONE_NO_AGREEMENT', finding: 'x',
    recorded_by: 'y', recorded_on: '2026-08-27', ...over,
  })

  it('withdrawing a surface keeps the suite green without deleting the finding', () => {
    // This is the compliance-punishing trap, avoided deliberately. I8 offers
    // withdrawal as the alternative to a licence finding. If withdrawal turned the
    // gate red, the route to green would be deleting the audit trail — the same
    // shape as the DSR floor that made "stop logging trials" the way to pass.
    const withdrawn = row({ lifecycle: 'withdrawn', withdrawn_on: '2026-08-27', withdrawn_reason: 'surface removed' })
    expect(checkRegister([], [withdrawn])).toEqual([])
  })

  it('but a row still recorded active with nothing reaching it is flagged, not deleted', () => {
    expect(checkRegister([], [row({})]).map((v) => v.rule)).toEqual(['stale-active'])
  })

  it('and claiming a withdrawal that did not happen is itself a violation', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    const withdrawn = row({ lifecycle: 'withdrawn', withdrawn_on: '2026-08-27', withdrawn_reason: 'surface removed' })
    expect(checkRegister(pts, [withdrawn]).map((v) => v.rule)).toEqual(['withdrawn-but-live'])
  })

  it('rejects PERMITTED without a document, so the status cannot be typed to pass', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    expect(checkRegister(pts, [row({ licence_status: 'PERMITTED' })]).map((v) => v.rule))
      .toEqual(['permitted-without-evidence'])
  })

  it('accepts PERMITTED once a document is named', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    expect(checkRegister(pts, [row({ licence_status: 'PERMITTED', licence_evidence: 'MSA 2026-09-01 §4.2, countersigned' })]))
      .toEqual([])
  })

  it('refuses to serve a surface whose licence is recorded as forbidding it', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    expect(checkRegister(pts, [row({ licence_status: 'RESTRICTED' })]).map((v) => v.rule))
      .toEqual(['restricted-but-active'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What this guard CANNOT do — asserted as PASSING tests, so a green run can
// never be read as a proof. Q-098 established the idiom: an escape written in a
// review document is a claim, an escape written as a test is a measurement.
// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — what this guard CANNOT do', () => {
  const f = (path: string, source: string): SourceFile[] => [{ path, source }]
  const unregistered = (pts: EgressPoint[]) =>
    checkRegister(pts, register.entries).filter((v) => v.rule === 'unregistered').map((v) => v.id)

  it('CANNOT see a host assembled by concatenation from fragments', () => {
    // No `https://` literal survives, so nothing matches. The register cannot
    // record what the source never spells.
    expect(unregistered(detectEgress(f('lib/x.ts', `const u = 'htt' + 'ps://' + 'api.hidden.example'`))))
      .toEqual([])
  })

  it('CANNOT see a host in an environment variable that is not named like one', () => {
    expect(unregistered(detectEgress(f('lib/x.ts', `const u = process.env.VENDOR_THING`)))).toEqual([])
  })

  it('CANNOT see a vendor reached through a transitive dependency', () => {
    // Only direct manifest entries are enumerated. A registered package that pulls
    // a vendor client of its own is invisible here.
    expect(unregistered(detectEgress([], { dependencies: { 'some-wrapper': '^1.0.0' } })).includes('inner-vendor-client'))
      .toBe(false)
  })

  it('CANNOT tell a correct classification from a convenient one', () => {
    // The register records a human judgement. Nothing here stops a future author
    // filing a market-data client as `build-tooling`. What the guard buys is that
    // the row appears in the diff with a name and a date on it — the difference
    // between an unexamined decision and a reviewed one.
    const mis: RegisterEntry = {
      kind: 'npm-package', id: 'definitely-a-vendor-client', lifecycle: 'active',
      classification: 'build-tooling', vendor: 'n/a', end_user_exposed: false,
      authenticated: false, licence_status: 'NOT_APPLICABLE', finding: 'not a vendor, honest',
      recorded_by: 'someone', recorded_on: '2026-08-27',
    }
    expect(checkRegister(detectEgress([], { dependencies: { 'definitely-a-vendor-client': '^1.0.0' } }), [mis]))
      .toEqual([])
  })

  it('CANNOT answer whether any of this is permitted', () => {
    // The whole point. Q-082 and Q-083 are owner + counsel; recording the question
    // is the most a repository can do about it.
    const exposed = register.entries.filter((e) => e.end_user_exposed && e.lifecycle === 'active')
    expect(exposed.length).toBeGreaterThan(0)
    for (const e of exposed) expect(e.redistribution_position).toMatch(/UNRESOLVED|Q-082/)
  })

  it('CANNOT stop a merge — main has no branch protection until Q-097 lands', () => {
    // Recorded as a test so the limitation travels with the mechanism instead of
    // living only in a document nobody re-reads.
    expect(true).toBe(true)
  })
})
