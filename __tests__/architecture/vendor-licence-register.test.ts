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
import { attributeSurfaces, buildImportGraph, orphanedEvidence, PUBLIC_SURFACE } from './importGraph'

const ROOT = join(__dirname, '../..')

/**
 * Vendored dependencies, build output, and test/fixture trees. Everything else is
 * scanned — the walk enumerates nothing, because Q-098 established twice that an
 * allowlist of names and an allowlist of directories are the same defect one level
 * up. `.github` is admitted explicitly since a workflow can reach a vendor too.
 */
const IGNORED = new Set([
  'node_modules', '.next', 'coverage', 'dist', 'build', '.git',
  '__pycache__', 'venv', '.venv', '__tests__', 'tests',
])

/**
 * `public/` USED to be in the set above, and red-team was right that it should not
 * be: it is the one directory served verbatim to end users, and `public/sw.js` is a
 * service worker executing in the end user's browser — I8's trigger condition
 * exactly. It is visited now.
 *
 * What is excluded instead is generated PWA output, on the same property that
 * excludes `.next`: emitted by the build, untracked by git, regenerated every time.
 * `public/workbox-*.js` is a minified vendor bundle whose incidental URLs
 * (`bit.ly`) would bury the rows that matter. Excluded by what it IS, not by name.
 */
const GENERATED = /^(sw\.js|workbox-[a-f0-9]+\.js)(\.map)?$/

/**
 * Executable source. THIS IS AN EXTENSION LIST, and an earlier draft of this
 * comment claimed it was not — "any extension, not a list of the ones we happened
 * to think of" — which was false while sitting inside the honesty block of a guard
 * built to remove false claims. Struck, because writing one is easier than
 * noticing one.
 *
 * The list is defensible on a property and the property is stated so it can be
 * argued with: **only executable text can issue a request.** Markdown, JSON,
 * `.snap` and log files hold plenty of URLs — a sweep on 2026-08-27 found 28
 * hosts across `.md`, `.json` (npm lockfile funding links), `.txt` and `.snap` —
 * and not one of them can fetch anything. Registering prose would bury the rows
 * that matter, which is its own failure.
 *
 * Where that reasoning is thin, it is widened rather than argued: `.sh`, `.toml`,
 * `Dockerfile` and `Procfile` can all reach a vendor, have no instances today, and
 * cost nothing to visit. The unvisited set is asserted in the CANNOT-do block, so
 * the boundary is a measurement rather than an assumption.
 */
const EXECUTABLE = /(\.(tsx?|jsx?|mjs|cjs|py|ya?ml|sh|bash|toml|html?)$|^(Dockerfile|Procfile)[^/]*$|^requirements[^/]*\.txt$)/

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry.startsWith('.') && entry !== '.github') continue
      walk(full, out)
    } else if (EXECUTABLE.test(entry) && !GENERATED.test(entry)) out.push(full)
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

/**
 * Which public surfaces reach each vendor (Q107-S9). `detectEgress` is per-file
 * and textual; this traverses the edges BETWEEN files, which no earlier version
 * of the guard did.
 */
const surfaces = attributeSurfaces(files, points)

/** No surface map — for virtual-file cases whose rows are not end-user exposed. */
const NO_SURFACES = new Map<string, readonly string[]>()

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

  it('detects a vendor declared in a manifest that is not package.json', () => {
    // Added after review. This file already had a test named "catches a vendor
    // client added to devDependencies" — the second BLOCK of the manifest it read
    // — while an entire second MANIFEST went unvisited. requirements.txt declares
    // yfinance, akshare and tradingagents, none of them recorded.
    expect(has('pip-package', 'yfinance')).toBe(true)
    expect(has('pip-package', 'akshare')).toBe(true)
  })

  it('detects vendor data this repository REPUBLISHES, which reaches no host at all', () => {
    // The mechanism detects EGRESS; I8 governs EXPOSURE. scripts/backtestData/ is
    // 13 MB of Yahoo-derived OHLCV in a PUBLIC repo, pushed weekly by a bot. No
    // host is reached, no dependency added, no env var read — every other kind
    // here is blind to it, and it is a more complete exposure of vendor data than
    // any UI surface in the platform.
    expect(has('published-data', 'scripts/backtestData/')).toBe(true)
  })

  it('visits both requirements manifests', () => {
    for (const p of ['requirements.txt', 'ml/requirements.txt']) {
      expect(files.map((x) => x.path)).toContain(p)
    }
  })

  it('finds enough distinct egress points to be worth checking', () => {
    expect(detected.size).toBeGreaterThan(50)
  })

  it.each(['app', 'lib', 'components', 'hooks', 'scripts', '.github', 'public'])(
    'actually opens at least one file under %s',
    (dir) => {
      // ADMITTING A DIRECTORY IS NOT VISITING IT. `public/` was added to close a
      // red-team finding and then visited ZERO files, because nothing in it
      // matched the extension filter — a fix that was pure decoration, and the
      // sixth instance of this class in this repository. Every admitted
      // territory now has to prove it is non-empty, so the next one cannot be
      // decoration either.
      expect(files.filter((f) => f.path.startsWith(dir + '/')).length).toBeGreaterThan(0)
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Q107-S9. The block above proves the WALKER opened the files; this one proves
// the graph traversed the EDGES between them. They are different visitors, and
// the second did not exist until now — which is why four routes serving vendor
// data were recorded only because a human typed them into a prose finding.
// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — the import graph is reachable', () => {
  const graph = buildImportGraph(files)
  const edgeCount = [...graph.values()].reduce((n, s) => n + s.size, 0)

  it('resolves a substantial number of import edges', () => {
    // A resolver that returns null for everything would leave every rule below
    // with zero instances and the suite green — the exact defect this repository
    // has shipped seven times.
    expect(edgeCount).toBeGreaterThan(300)
  })

  it('finds public surfaces of both kinds, not just API routes', () => {
    const found = files.map((f) => f.path).filter((p) => PUBLIC_SURFACE.test(p))
    expect(found.filter((p) => p.endsWith('/route.ts')).length).toBeGreaterThan(20)
    expect(found.filter((p) => p.endsWith('/page.tsx')).length).toBeGreaterThan(5)
    expect(found).toContain('middleware.ts')
  })

  it('attributes a vendor to a route the DETECTOR produces no evidence for', () => {
    // THE FINDING, as a test — and the first draft of it asserted the wrong thing.
    // It grepped the source for `BLOOMBERG_BRIDGE_URL` and failed, because the
    // route names the variable in a JSDoc comment at :44. Matching prose about the
    // behaviour instead of the behaviour is the defect this repository keeps
    // shipping; stripComments masks that line, so the DETECTOR is what to ask.
    const cited = points.filter((p) => p.where.startsWith('app/api/prices/route.ts:'))
    expect(cited).toEqual([])
    expect(surfaces.get('env-host|BLOOMBERG_BRIDGE_URL')).toContain('app/api/prices/route.ts')
  })

  it('attributes the route that appeared in NO register row at all', () => {
    // Q107-S9's measured example: app/api/trading-agents/health/route.ts fetches
    // an operator origin at :41 through a helper, and across all 93 rows it was
    // named in no evidence array.
    expect(surfaces.get('env-host|TRADING_AGENTS_BASE'))
      .toContain('app/api/trading-agents/health/route.ts')
  })

  it('traverses MORE than one hop', () => {
    // app/stock/[ticker]/page.tsx reaches TRADING_AGENTS_BASE through a component
    // and a hook. The ledger row proposed "a one-hop import-edge pass"; one hop
    // would have missed this, and a page is a more complete end-user exposure
    // than the API route beneath it.
    expect(surfaces.get('env-host|TRADING_AGENTS_BASE')).toContain('app/stock/[ticker]/page.tsx')
  })

  it('attributes a browser-direct vendor to the PAGE that mounts it', () => {
    // components/crypto/hooks/useBtcCandles.ts calls CoinGecko from the browser.
    // Restricting surfaces to app/api/** would have been blind to it entirely.
    expect(surfaces.get('http-host|api.coingecko.com')).toContain('app/crypto/btc/page.tsx')
  })

  it('attributes the package-mediated vendor with the largest surface (Yahoo)', () => {
    expect(surfaces.get('npm-package|yahoo-finance2')?.length ?? 0).toBeGreaterThanOrEqual(15)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — every vendor this repository reaches is recorded', () => {
  const violations = checkRegister(points, register.entries, surfaces)

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

  it('records every public surface that exposes a vendor to an end user', () => {
    // Q107-S9. Rules 1-7 all key on EGRESS; this one keys on EXPOSURE, which is
    // what I8's trigger sentence actually governs.
    const surfaceDrift = violations
      .filter((v) => v.rule === 'surfaces-unrecorded' || v.rule === 'surface-added')
      .map((v) => `${v.rule}: ${v.kind} ${v.id} — ${v.detail}`)
    expect(surfaceDrift).toEqual([])
  })

  it('carries exposed_via on exactly the exposed rows the graph reaches', () => {
    // Stated as an IFF over the actual rows, not as a floor. The first draft was
    // `expect(withField.length).toBeGreaterThanOrEqual(12)` — which is the same
    // drifting threshold this file explicitly strikes 40 lines below, where a
    // count went RED as a reward for withdrawing a vendor surface and the repair
    // was to type a smaller number. Reintroducing it while quoting the lesson is
    // the sin this suite exists to remove (red-team MEDIUM-1).
    const shouldHave = register.entries
      .filter((e) => e.end_user_exposed && e.lifecycle === 'active' && (surfaces.get(`${e.kind}|${e.id}`)?.length ?? 0) > 0)
      .map((e) => `${e.kind}|${e.id}`)
    const doesHave = register.entries
      .filter((e) => Array.isArray(e.exposed_via))
      .map((e) => `${e.kind}|${e.id}`)
    expect(doesHave.sort()).toEqual(shouldHave.sort())
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
/**
 * Every market-data vendor on the record, pinned by id.
 *
 * The first version pinned only the six the Q-079 audit named, which left every
 * later row silently softenable: red-team flipped `end_user_exposed` to false and
 * deleted `redistribution_position` on `BLOOMBERG_BRIDGE_URL` — the CRITICAL row —
 * and the suite stayed green, because one boolean silenced three assertions at
 * once. A pinned list that does not grow with the register protects only history.
 */
const NAMED_MARKET_DATA_VENDORS = [
  'yahoo-finance2', 'api.coingecko.com', 'api.kraken.com',
  'api.exchange.coinbase.com', 'api.bybit.com', 'www.okx.com',
  'ws.kraken.com', 'ws-feed.exchange.coinbase.com',
  'yfinance', 'akshare', 'BLOOMBERG_BRIDGE_URL', 'scripts/backtestData/',
  'fred.stlouisfed.org',
]

describe('I8 — the register has not been quietly softened', () => {
  const entries = register.entries
  const exposed = entries.filter((e) => e.end_user_exposed && e.lifecycle === 'active')

  it('accounts for every named market-data vendor — exposed, or withdrawn on the record', () => {
    // NOT a count. An earlier version asserted `exposed.length >= 6`, which goes
    // RED as a reward for withdrawing a vendor surface — the good outcome — and
    // whose fix would be editing the floor down. That is the compliance-punishing
    // shape solved in `checkRegister`, reintroduced one level up: the lifecycle
    // made withdrawal safe for the gate while this assertion still punished it.
    //
    // The property that actually matters: a named vendor cannot quietly stop being
    // accounted for. Either it is live and exposed, or its withdrawal is recorded
    // with a date and a reason.
    // KIND-AWARE. `find(e => e.id === id)` ignored kind, so adding a withdrawn
    // decoy row carrying the same id under a different kind satisfied the lookup
    // while the real row was softened. Red-team demonstrated it on the CRITICAL
    // Bloomberg row.
    const unaccounted = NAMED_MARKET_DATA_VENDORS.filter((id) => {
      const matches = entries.filter((e) => e.id === id)
      if (matches.length === 0) return true
      // Every row carrying this id must be accounted for, not merely the first.
      return matches.some((row) => {
        if (row.lifecycle === 'withdrawn') return !(row.withdrawn_on && row.withdrawn_reason?.trim())
        return !row.end_user_exposed
      })
    })
    expect(unaccounted).toEqual([])
  })

  it('keeps every pinned vendor classified as a vendor', () => {
    // Classification is checked, not just presence: reclassifying www.okx.com as
    // `build-tooling` was a live escape from the count-based version.
    const VENDOR_CLASSES = new Set(['market-data-vendor', 'reference-data-vendor', 'llm-vendor', 'llm-credential-path'])
    const ids = new Set(entries.filter((e) => VENDOR_CLASSES.has(e.classification)).map((e) => e.id))
    for (const id of NAMED_MARKET_DATA_VENDORS) expect(ids).toContain(id)
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
    checkRegister(pts, register.entries, NO_SURFACES).filter((v) => v.rule === 'unregistered').map((v) => v.id)

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

  it('catches a vendor client added to requirements.txt', () => {
    expect(unregistered(detectEgress(f('requirements.txt', 'alpaca-trade-api>=3.0.0\n'))))
      .toContain('alpaca-trade-api')
  })

  it('does NOT treat a pip comment or a -r include as a package', () => {
    expect(unregistered(detectEgress(f('requirements.txt', '# polygon-api-client>=1.0\n-r other.txt\n'))))
      .toEqual([])
  })

  it('catches a new data path staged and pushed by a workflow', () => {
    expect(unregistered(detectEgress(f('.github/workflows/x.yml', '  git add data/vendorDump/\n  git push origin HEAD:main\n'))))
      .toContain('data/vendorDump/')
  })

  it('does NOT fire on a workflow that stages without pushing', () => {
    expect(unregistered(detectEgress(f('.github/workflows/x.yml', '  git add data/vendorDump/\n'))))
      .toEqual([])
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
// Q107-S9 positive controls. Every case here is a route that reaches a vendor
// while containing no host, no dependency and no env read — the shape that shipped
// green before this rule existed.
// ─────────────────────────────────────────────────────────────────────────────
describe('I8 — a new surface cannot quietly start serving a vendor', () => {
  const VENDOR: SourceFile = {
    path: 'lib/data/vendorClient.ts',
    source: `export async function q() { return fetch(process.env.SOME_VENDOR_URL + '/q') }`,
  }
  const exposedRow = (over: Partial<RegisterEntry> = {}): RegisterEntry => ({
    kind: 'env-host', id: 'SOME_VENDOR_URL', lifecycle: 'active',
    classification: 'market-data-vendor', vendor: 'Some Vendor', end_user_exposed: true,
    authenticated: false, licence_status: 'UNVERIFIED', finding: 'recorded',
    recorded_by: 'test', recorded_on: '2026-09-09',
    redistribution_position: 'UNRESOLVED — Q-082',
    exposed_via: ['app/api/known/route.ts'],
    ...over,
  })
  const run = (fs: SourceFile[], entry: RegisterEntry) => {
    const all = [VENDOR, ...fs]
    const pts = detectEgress(all)
    return checkRegister(pts, [entry], attributeSurfaces(all, pts)).map((v) => v.rule)
  }
  const known: SourceFile = {
    path: 'app/api/known/route.ts',
    source: `import { q } from '@/lib/data/vendorClient'\nexport const GET = () => q()`,
  }

  it('is green while only the recorded surface reaches it', () => {
    expect(run([known], exposedRow())).toEqual([])
  })

  it('THE FINDING: a new route importing the vendor client is flagged', () => {
    const added: SourceFile = {
      path: 'app/api/brand-new/route.ts',
      source: `import { q } from '@/lib/data/vendorClient'\nexport const GET = () => q()`,
    }
    expect(run([known, added], exposedRow())).toEqual(['surface-added'])
  })

  it('catches it through an intermediate helper, not just a direct import', () => {
    const helper: SourceFile = {
      path: 'lib/helpers/wrap.ts',
      source: `export { q } from '@/lib/data/vendorClient'`,
    }
    const added: SourceFile = {
      path: 'app/api/indirect/route.ts',
      source: `import { q } from '@/lib/helpers/wrap'\nexport const GET = () => q()`,
    }
    expect(run([known, helper, added], exposedRow())).toEqual(['surface-added'])
  })

  it('catches a PAGE, not only an API route', () => {
    const page: SourceFile = {
      path: 'app/new-thing/page.tsx',
      source: `import { q } from '@/lib/data/vendorClient'\nexport default function P() { void q; return null }`,
    }
    expect(run([known, page], exposedRow())).toEqual(['surface-added'])
  })

  it('refuses an exposed row that omits the field entirely', () => {
    const bare = exposedRow()
    delete bare.exposed_via
    expect(run([known], bare)).toEqual(['surfaces-unrecorded'])
  })

  it.each([
    ['a preceding export type', `export type Params = { t: string }\nimport { q } from '@/lib/data/vendorClient'`],
    ['a preceding export interface', `export interface Params { t: string }\nimport { q } from '@/lib/data/vendorClient'`],
    ['a JSDoc block above the import', `/**\n * import type { X } from 'somewhere'\n */\nimport { q } from '@/lib/data/vendorClient'`],
    ['a named clause longer than 800 characters', `import { ${Array.from({ length: 70 }, (_, i) => `unused${i}`).join(', ')}, q } from '@/lib/data/vendorClient'`],
  ])('is not defeated by %s', (_what, header) => {
    // Red-team CRITICAL-1 and CRITICAL-2, both verified against the real tree
    // before the fix. `staticRe` anchored on any occurrence of the word
    // import/export and ran a lazy {0,800} gap to the next `from '…'`, so a
    // preceding declaration swallowed the real import (returning it type-only, or
    // handing parseClause the declaration body as the clause) and a clause past
    // the bound produced NO specifier at all. Fixed at source in
    // syntheticContainment.ts, which is why the I3 suite is a gate on this change.
    const added: SourceFile = { path: 'app/api/escape/route.ts', source: `${header}\nexport const GET = () => q()` }
    expect(run([known, added], exposedRow())).toEqual(['surface-added'])
  })

  it('does NOT fire when the new importer is an internal module, not a surface', () => {
    // The unit is the surface. A helper importing a helper exposes nothing new to
    // an end user, and firing on it would make the register a call graph.
    const inner: SourceFile = { path: 'lib/other/thing.ts', source: `import { q } from '@/lib/data/vendorClient'\nexport const z = q` }
    expect(run([known, inner], exposedRow())).toEqual([])
  })

  it('does NOT fire on a TYPE-ONLY import, which reaches nothing at runtime', () => {
    // lib/data/mergeQuotes.ts:1 imports BloombergQuoteNormalized as a type. An
    // edge there would attribute a live Bloomberg exposure to every surface that
    // merges quotes — a false claim in the one artifact that exists to be audited.
    const typed: SourceFile = {
      path: 'app/api/types-only/route.ts',
      source: `import type { Q } from '@/lib/data/vendorClient'\nexport const GET = () => new Response()`,
    }
    expect(run([known, typed], exposedRow())).toEqual([])
  })

  it('THE DISARMING ATTACK: a padded exposed_via cannot silence the rule', () => {
    // Red-team's HIGH-1. The first version of rule 8 fired on additions only,
    // calling over-recording "the safe direction". Union a row's list with every
    // surface that could ever exist and no addition is possible again — the rule
    // becomes permanently unfirable with the suite green. Over-recording is not a
    // cautious error; it is how you switch the gate off.
    const padded = exposedRow({
      exposed_via: ['app/api/known/route.ts', 'app/api/anything/route.ts', 'app/api/whatever/route.ts'],
    })
    expect(run([known], padded)).toEqual(['surface-stale'])
  })

  it('names the computed set in the message, so repair is copy-paste not padding', () => {
    const added: SourceFile = {
      path: 'app/api/brand-new/route.ts',
      source: `import { q } from '@/lib/data/vendorClient'\nexport const GET = () => q()`,
    }
    const all = [VENDOR, known, added]
    const pts = detectEgress(all)
    const v = checkRegister(pts, [exposedRow()], attributeSurfaces(all, pts))
    expect(v[0].detail).toContain('Computed set: app/api/brand-new/route.ts, app/api/known/route.ts')
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
    expect(checkRegister([], [withdrawn], NO_SURFACES)).toEqual([])
  })

  it('but a row still recorded active with nothing reaching it is flagged, not deleted', () => {
    expect(checkRegister([], [row({})], NO_SURFACES).map((v) => v.rule)).toEqual(['stale-active'])
  })

  it('and claiming a withdrawal that did not happen is itself a violation', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    const withdrawn = row({ lifecycle: 'withdrawn', withdrawn_on: '2026-08-27', withdrawn_reason: 'surface removed' })
    expect(checkRegister(pts, [withdrawn], NO_SURFACES).map((v) => v.rule)).toEqual(['withdrawn-but-live'])
  })

  it('rejects PERMITTED without a document, so the status cannot be typed to pass', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    expect(checkRegister(pts, [row({ licence_status: 'PERMITTED' })], NO_SURFACES).map((v) => v.rule))
      .toEqual(['permitted-without-evidence'])
  })

  it('accepts PERMITTED once a document is named', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    expect(checkRegister(pts, [row({ licence_status: 'PERMITTED', licence_evidence: 'MSA 2026-09-01 §4.2, countersigned' })], NO_SURFACES))
      .toEqual([])
  })

  it('refuses to serve a surface whose licence is recorded as forbidding it', () => {
    const pts: EgressPoint[] = [{ kind: 'http-host', id: 'api.gone.example', where: 'lib/x.ts:1' }]
    expect(checkRegister(pts, [row({ licence_status: 'RESTRICTED' })], NO_SURFACES).map((v) => v.rule))
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
    checkRegister(pts, register.entries, NO_SURFACES).filter((v) => v.rule === 'unregistered').map((v) => v.id)

  // ── Q107-S9: what the IMPORT GRAPH cannot do ────────────────────────────────
  const surfacesOf = (fs: SourceFile[]) => attributeSurfaces(fs, detectEgress(fs))

  it('CANNOT see a surface that reaches a vendor through a NON-LITERAL specifier', () => {
    // `import(vendorPath)` is unresolvable by construction. The synthetic guard
    // treats an opaque specifier as a violation in its own right; here it is a
    // hole, because a compliance register cannot demand that no route ever
    // computes a module path.
    const fs: SourceFile[] = [
      { path: 'lib/v.ts', source: `export const q = () => fetch(process.env.OPAQUE_VENDOR_URL!)` },
      { path: 'app/api/o/route.ts', source: 'const p = "@/lib/v"\nexport const GET = async () => (await import(p)).q()' },
    ]
    expect(surfacesOf(fs).get('env-host|OPAQUE_VENDOR_URL')).toBeUndefined()
  })

  it('CANNOT attribute a vendor reached only from Python', () => {
    // yfinance, akshare and tradingagents are end-user exposed and carry NO
    // exposed_via, because a TypeScript import graph cannot reach a .py module.
    // Their absence is a measured blind spot, not an implied "nothing exposes it".
    for (const id of ['yfinance', 'akshare', 'tradingagents']) {
      expect(surfaces.get(`pip-package|${id}`)).toBeUndefined()
      const row = register.entries.find((e) => e.kind === 'pip-package' && e.id === id)
      expect(row?.exposed_via).toBeUndefined()
    }
  })

  it('CANNOT attribute republished data, which no surface imports', () => {
    expect(surfaces.get('published-data|scripts/backtestData/')).toBeUndefined()
  })

  it('CANNOT see a vendor rendered from an ALREADY-fetched field — and here is the REAL instance', () => {
    // Named gap (1), unchanged by this work, and the first draft of this test
    // demonstrated it with an invented toy while a known real instance sat in the
    // evidence array of a row being edited (red-team HIGH-2). The toy is gone.
    //
    // components/stock/quantlab/tabs/SummaryTab.tsx:34 renders a literal
    // "Bloomberg spot" badge. The chain app/stock/[ticker]/page.tsx:13 ->
    // QuantLabPanel -> SummaryTab imports NO bridge client: the price arrives as a
    // prop from a fetch. So the page is in exposed_via for TRADING_AGENTS_BASE,
    // where a hook imports the config module, and NOT for BLOOMBERG_BRIDGE_URL —
    // same page, same commit, opposite treatment, decided purely by
    // hook-versus-prop. The graph is not wrong; it is measuring imports, and
    // imports are not exposure. Recorded so the register's asymmetry is a stated
    // limit rather than something a reader has to notice.
    const chain = files.find((f) => f.path === 'components/stock/quantlab/tabs/SummaryTab.tsx')?.source ?? ''
    expect(chain).toContain('Bloomberg spot')
    expect(surfaces.get('env-host|TRADING_AGENTS_BASE')).toContain('app/stock/[ticker]/page.tsx')
    expect(surfaces.get('env-host|BLOOMBERG_BRIDGE_URL') ?? []).not.toContain('app/stock/[ticker]/page.tsx')
  })

  it('CANNOT tell an exposed row that is MISCLASSIFIED as unexposed', () => {
    // Rule 8 is scoped to end_user_exposed, which is I8's own wording — but that
    // flag is a human judgement. Marking a live vendor unexposed silences the rule.
    const fs: SourceFile[] = [
      { path: 'lib/v.ts', source: `export const q = () => fetch('https://api.quiet.example/q')` },
      { path: 'app/api/q/route.ts', source: `import { q } from '@/lib/v'\nexport const GET = () => q()` },
    ]
    const pts = detectEgress(fs)
    const row: RegisterEntry = {
      kind: 'http-host', id: 'api.quiet.example', lifecycle: 'active',
      classification: 'market-data-vendor', vendor: 'Quiet', end_user_exposed: false,
      authenticated: false, licence_status: 'UNVERIFIED', finding: 'x', recorded_by: 'y', recorded_on: '2026-09-09',
    }
    expect(checkRegister(pts, [row], attributeSurfaces(fs, pts))).toEqual([])
  })

  it('CANNOT see an entry point outside app/ that is not one of the two named root files', () => {
    // PUBLIC_SURFACE enumerates nothing WITHIN app/ — the first version listed
    // route|page|layout and missed five error/not-found files already in the tree
    // (red-team CRITICAL-3). Outside app/ it still names exactly two files, so a
    // Pages-Router handler would be invisible. This repository is App Router only,
    // asserted below so the gap stays measured rather than assumed.
    expect(PUBLIC_SURFACE.test('app/api/x/handler.ts')).toBe(true)
    expect(PUBLIC_SURFACE.test('app/error.tsx')).toBe(true)
    expect(PUBLIC_SURFACE.test('pages/api/legacy.ts')).toBe(false)
    expect(files.filter((f) => f.path.startsWith('pages/'))).toEqual([])
  })

  it('CANNOT prove its evidence paths were visited — but there are none unvisited', () => {
    // An egress point whose `where` names no walked file attaches to a node with
    // no edges: it reaches zero surfaces, so rule 8 can never fire for it, and the
    // green result means "we never looked" rather than "nothing exposes it".
    expect(orphanedEvidence(files, points)).toEqual([])
  })

  it('CANNOT see a host assembled by concatenation from fragments', () => {
    // Briefly, an unguarded protocol-relative branch DID catch this, via the `//`
    // inside the `'ps://'` fragment. That branch was removed because it also
    // invented vendors from Python's integer division and from YAML globs — a
    // guard that cries wolf on `total // 2` gets its offender list ignored, which
    // is a worse failure than this gap. The `//` must now follow a string or
    // expression boundary, and `:` is not one. Stated as the trade it is.
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
    expect(checkRegister(detectEgress([], { dependencies: { 'definitely-a-vendor-client': '^1.0.0' } }), [mis], NO_SURFACES))
      .toEqual([])
  })

  it('CANNOT answer whether any of this is permitted', () => {
    // The whole point. Q-082 and Q-083 are owner + counsel; recording the question
    // is the most a repository can do about it.
    const exposed = register.entries.filter((e) => e.end_user_exposed && e.lifecycle === 'active')
    expect(exposed.length).toBeGreaterThan(0)
    for (const e of exposed) expect(e.redistribution_position).toMatch(/UNRESOLVED|Q-082/)
  })

  it.each(['README.md', 'package-lock.json', 'notes.txt', 'x.test.tsx.snap'])(
    'CANNOT see a host in %s — the walk visits executable text only',
    (name) => {
      // Asserted rather than assumed, so the boundary of the walk is a
      // measurement. If one of these ever becomes executable, this test is where
      // the decision gets revisited.
      expect(EXECUTABLE.test(name)).toBe(false)
    },
  )

  it('DOES visit the shell and container formats that can reach a vendor', () => {
    // No instances today. Visited anyway, because "there are none right now" is
    // the reasoning that left .json unvisited in Q-098.
    for (const n of ['deploy.sh', 'Dockerfile', 'Procfile', 'pyproject.toml']) {
      expect(EXECUTABLE.test(n)).toBe(true)
    }
  })

  it('DOES strip hash comments in Python and YAML — this test used to assert the opposite', () => {
    // The previous version of this test claimed the masker was JS-only, called that
    // "over-matching, in the safe direction", and shipped in a commit titled "a
    // false claim inside my own honesty block". All three sub-claims were false.
    // It exercised only the `#` half and never the block-comment half that did the
    // damage: a YAML glob formed a JS block comment and deleted 2387 characters —
    // lines 2 to 51 — of a real workflow, so a host planted at line 41 was
    // invisible while the same host at line 61 was caught. A PASSING TEST THAT
    // RATIFIES A BUG IS WORSE THAN NO TEST; it makes the bug look deliberate.
    expect(unregistered(detectEgress(f('x.py', '# see https://api.example.com/docs')))).toEqual([])
    expect(unregistered(detectEgress(f('x.yml', '# https://api.example.com/docs')))).toEqual([])
  })

  it('is not blinded by a YAML glob that looks like a block comment', () => {
    const yaml = ['mutate:', '  - "lib/quant/' + '**"', '  - "' + '**/' + '*.spec.ts"',
                  '  FEED: "https://api.polygon.io/v2/aggs"'].join('\n')
    expect(unregistered(detectEgress(f('.github/workflows/x.yml', yaml)))).toContain('api.polygon.io')
  })

  it('keeps file:line honest across a comment, because comments are MASKED not deleted', () => {
    // where was computed on the processed source, so 18 of 46 register citations
    // pointed at unrelated code — in the artifact whose whole purpose is an
    // auditable trail.
    const src = ['/*', ' * a block comment', ' * spanning several lines', ' */',
                 "const u = 'https://api.polygon.io/v2'"].join('\n')
    const pts = detectEgress(f('lib/x.ts', src))
    expect(pts.find((x) => x.id === 'api.polygon.io')?.where).toBe('lib/x.ts:5')
  })

  it('catches a wss:// market-data feed', () => {
    expect(unregistered(detectEgress(f('components/x.ts', `const W = 'wss://stream.vendor.example/v2'`))))
      .toContain('stream.vendor.example')
  })

  it('does NOT invent a vendor from Python integer division or a YAML glob', () => {
    expect(unregistered(detectEgress(f('x.py', 'n = total // 2')))).toEqual([])
    expect(unregistered(detectEgress(f('x.yml', '  - "' + '**/' + '*.ts"')))).toEqual([])
  })

  it('does NOT read a query-string @ as userinfo', () => {
    // `?family=Inter:wght@300;400` registered a vendor called `300`.
    const ids = unregistered(detectEgress(f('app/x.tsx', `const u='https://fonts.example.com/css2?family=Inter:wght@300;400'`)))
    expect(ids).not.toContain('300')
    expect(ids).toContain('fonts.example.com')
  })

  it('catches a vendor client hidden in overrides or optionalDependencies', () => {
    expect(unregistered(detectEgress([], { optionalDependencies: { 'alpha-vantage': '^2.4.0' } })))
      .toContain('alpha-vantage')
    expect(unregistered(detectEgress([], { overrides: { 'innocent-name': 'npm:vendor-client@1' } })))
      .toContain('innocent-name')
  })

  it('catches a destructured env read and a shell export', () => {
    expect(unregistered(detectEgress(f('lib/x.ts', 'const { REFINITIV_BASE_URL } = process.env'))))
      .toContain('REFINITIV_BASE_URL')
    expect(unregistered(detectEgress(f('start.sh', 'export FACTSET_ENDPOINT="https://x"'))))
      .toContain('FACTSET_ENDPOINT')
  })

  it('CANNOT stop a merge — main has no branch protection until Q-097 lands', () => {
    // Recorded as a test so the limitation travels with the mechanism instead of
    // living only in a document nobody re-reads.
    expect(true).toBe(true)
  })
})
