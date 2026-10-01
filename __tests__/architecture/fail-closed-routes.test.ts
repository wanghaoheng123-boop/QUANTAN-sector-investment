/**
 * Q-140 — I2 "fail closed, never fail silent", as a BEHAVIOURAL detector.
 *
 * Three routes set `degraded: true` and no client read it (Q-138); /api/search
 * answered `200 {"quotes":[]}` when Yahoo failed (Q-118). Both were found by
 * reading. A source-text detector would repeat the cache-flag mistake — a
 * producer set defined by "routes that already set the flag" cannot see a
 * route that fails silently WITHOUT it.
 *
 * So this calls every API route with EVERY upstream down — `fetch` rejects and
 * every yahoo-finance2 method throws — and requires the answer to say so:
 * a non-2xx status, or `degraded: true` in a 2xx body (health probes: `ok:
 * false`). A route that answers a clean 2xx while nothing upstream worked is
 * presenting nothing as data.
 *
 * THE SET IS EVERY ROUTE ON DISK. Each is either exercised in `CASES` or
 * listed in `EXEMPT` with a reason, and a test fails when a route is in
 * neither — so a new route cannot quietly fall outside the detector.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { NextRequest } from 'next/server'
import { stripComments } from './sourceText'

vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: vi.fn(async () => null) }))

// Every yahoo-finance2 method throws, whatever it is called.
vi.mock('yahoo-finance2', () => {
  const down = () => Promise.reject(new Error('upstream down (yahoo)'))
  return {
    default: class YahooFinance {
      constructor() {
        return new Proxy(this, { get: (_t, prop) => (prop === 'then' ? undefined : down) })
      }
    },
  }
})

const ROOT = join(__dirname, '..', '..')

interface Case {
  /** Route file, relative to the repo root. */
  file: string
  url: string
  params?: Record<string, string>
  /** Health probes report health in the body; a 200 with `ok: false` is correct. */
  health?: boolean
  /** Environment for the call (e.g. to make an optional service "configured"). */
  env?: Record<string, string>
}

const CASES: Case[] = [
  { file: 'app/api/analytics/[ticker]/route.ts', url: '/api/analytics/AAPL', params: { ticker: 'AAPL' } },
  { file: 'app/api/briefs/route.ts', url: '/api/briefs' },
  { file: 'app/api/briefs/[sector]/route.ts', url: '/api/briefs/technology', params: { sector: 'technology' } },
  { file: 'app/api/chart/[ticker]/route.ts', url: '/api/chart/AAPL?range=1mo&interval=1d', params: { ticker: 'AAPL' } },
  { file: 'app/api/crypto/btc/route.ts', url: '/api/crypto/btc?interval=1d&limit=100' },
  { file: 'app/api/crypto/btc/liquidations/route.ts', url: '/api/crypto/btc/liquidations' },
  { file: 'app/api/crypto/btc/metrics/route.ts', url: '/api/crypto/btc/metrics' },
  { file: 'app/api/crypto/btc/quote/route.ts', url: '/api/crypto/btc/quote' },
  { file: 'app/api/darkpool/[ticker]/route.ts', url: '/api/darkpool/AAPL', params: { ticker: 'AAPL' } },
  { file: 'app/api/fundamentals/[ticker]/route.ts', url: '/api/fundamentals/AAPL', params: { ticker: 'AAPL' } },
  { file: 'app/api/ma-deviation/route.ts', url: '/api/ma-deviation' },
  { file: 'app/api/ml/[ticker]/route.ts', url: '/api/ml/AAPL', params: { ticker: 'AAPL' }, env: { ML_SIDECAR_URL: 'http://ml.test' } },
  { file: 'app/api/news/[sector]/route.ts', url: '/api/news/technology', params: { sector: 'technology' } },
  { file: 'app/api/news/ticker/[ticker]/route.ts', url: '/api/news/ticker/AAPL', params: { ticker: 'AAPL' } },
  { file: 'app/api/options/[ticker]/route.ts', url: '/api/options/AAPL', params: { ticker: 'AAPL' } },
  { file: 'app/api/prices/route.ts', url: '/api/prices?tickers=AAPL,MSFT' },
  { file: 'app/api/search/route.ts', url: '/api/search?q=bank' },
  { file: 'app/api/sector-rotation/route.ts', url: '/api/sector-rotation' },
  { file: 'app/api/trading-agents/health/route.ts', url: '/api/trading-agents/health', health: true },
]

/** Routes deliberately outside this detector, each with the reason. */
const EXEMPT: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts': 'NextAuth handler; no market-data upstream.',
  'app/api/backtest/route.ts': 'Reads committed fixtures (lib/backtest/dataLoader), no network upstream.',
  'app/api/backtest/live/route.ts': 'Reads committed fixtures, no network upstream.',
  'app/api/conditional-vol/[ticker]/route.ts': 'Reads committed fixtures, no network upstream.',
  'app/api/regime/[ticker]/route.ts': 'Reads committed fixtures, no network upstream.',
  'app/api/stream/route.ts': 'SSE: failure is signalled in-stream as a `degraded` event, covered by __tests__/api/streamMultiplex.test.ts.',
  'app/api/stream/[ticker]/route.ts': 'SSE: failure is signalled in-stream as a `degraded` event (hooks/useLiveQuote.ts reads it).',
  'app/api/trading-agents/[ticker]/route.ts': 'Auth-gated LLM sidecar; unauthenticated calls are 401. Covered by __tests__/api/trading-agents-auth.test.ts.',
  'app/api/bloomberg-bridge/health/route.ts': 'The unauthenticated answer is a constant {status:"ok"} BY DESIGN (no infrastructure disclosure); the authenticated answer reports degraded when unreachable — __tests__/api/bloombergHealth.test.ts.',
}

function routeFiles(dir = join(ROOT, 'app', 'api'), out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) routeFiles(p, out)
    else if (/^route\.tsx?$/.test(e)) out.push(relative(ROOT, p))
  }
  return out
}

describe('Q-140 — the detector covers every route', () => {
  it('every route on disk is either exercised or exempted with a reason', () => {
    const covered = new Set([...CASES.map((c) => c.file), ...Object.keys(EXEMPT)])
    const missing = routeFiles().filter((f) => !covered.has(f))
    expect(missing).toEqual([])
    expect(routeFiles().length).toBeGreaterThan(20)
  })

  it('no route is both exercised and exempted, and every listed file exists', () => {
    const onDisk = new Set(routeFiles())
    for (const c of CASES) expect(onDisk.has(c.file), c.file).toBe(true)
    for (const f of Object.keys(EXEMPT)) {
      expect(onDisk.has(f), f).toBe(true)
      expect(CASES.some((c) => c.file === f), f).toBe(false)
    }
  })
})

/** How each route said it failed, recorded by the behavioural run below. */
type Mode = 'status' | 'degraded' | 'health'
const modes = new Map<string, Mode>()

describe('Q-140 — with every upstream down, no route answers a clean 2xx', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('upstream down (fetch)'))))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it.each(CASES.map((c) => [c.file, c] as const))('%s', async (_f, c) => {
    for (const [k, v] of Object.entries(c.env ?? {})) vi.stubEnv(k, v)
    const mod = (await import(join(ROOT, c.file))) as { GET: (req: NextRequest, ctx?: unknown) => Promise<Response> }
    const res = await mod.GET(new NextRequest(new URL(c.url, 'http://localhost:3000')), { params: Promise.resolve(c.params ?? {}) })
    if (res.status >= 300) { modes.set(c.file, 'status'); return } // a failure status is the failure, said
    const body = (await res.json()) as Record<string, unknown>
    if (c.health) {
      expect(body.ok, 'a health probe with every upstream down must report ok:false').toBe(false)
      modes.set(c.file, 'health')
      return
    }
    modes.set(c.file, 'degraded')
    // The sector brief has its own vocabulary (`dataQuality`), which its
    // consumers render; it counts as an explicit signal. Everything else uses
    // the `degraded` contract.
    const said = body.degraded === true || body.dataQuality === 'unavailable' || body.dataQuality === 'partial'
    expect(said, `answered ${res.status} with no degraded signal: ${JSON.stringify(body).slice(0, 240)}`).toBe(true)
  }, 60_000)
})

// ─── The consumer half ────────────────────────────────────────────────────────
//
// A degraded answer nobody reads is the defect Q-140 was filed for: the metrics
// route had always set `degraded: true` and BtcQuantLab never looked. So every
// UI file that fetches an exercised route must handle the way THAT route says
// it failed — the flag for a 2xx-degraded route, `res.ok` for a non-2xx one.
// Consumers are derived from source (who references the route's path), never
// listed by hand, and a read delegated to a helper one `@/` import away counts.

const UI_FILES = (() => {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e)) out.push(relative(ROOT, p))
    }
  }
  for (const d of ['app', 'components', 'hooks', 'lib']) walk(join(ROOT, d))
  return out.filter((f) => !f.startsWith('app/api/'))
})()

const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), rel)

/** The route's URL path as a pattern; a dynamic segment matches a literal or a `${…}`. */
function routePattern(file: string): RegExp {
  const segs = file.replace(/^app/, '').replace(/\/route\.tsx?$/, '').split('/')
  const body = segs
    .map((seg) => (/^\[.*\]$/.test(seg) ? '(?:\\$\\{[^}]*\\}|[A-Za-z0-9_.-]+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(body + '(?=[`\'"?])')
}

/** A file's own code plus the code of every `@/` module it imports (one hop). */
function withImports(rel: string): string {
  const src = code(rel)
  const deps = [...src.matchAll(/from\s+['"]@\/([^'"]+)['"]/g)].map((m) => m[1])
  const resolved = deps.flatMap((d) => [`${d}.ts`, `${d}.tsx`, `${d}/index.ts`]).filter((f) => existsSync(join(ROOT, f)))
  return [src, ...resolved.map(code)].join('\n')
}

const READS: Record<Mode, RegExp> = {
  degraded: /\bdegraded\b|\bdataQuality\b/,
  health: /\.ok\b/,
  status: /\.ok\b/,
}

// CANNOT DO: this binds a READ to a FILE, not to a PAYLOAD. A consumer that
// imports a module reading ANOTHER route's `degraded` passes for every route it
// fetches — BtcQuantLab imports LiquidationsPanel, so mutation C1 (deleting the
// metrics notice) survived this guard. Reads that matter are pinned by render
// tests (e.g. __tests__/components/crypto/BtcQuantLabMetricsDegraded.test.tsx).

/** Exercised routes with no UI consumer today. A new one fails here to be looked at. */
const NO_UI_CONSUMER = ['app/api/ml/[ticker]/route.ts']

describe('Q-140 — every consumer handles the way its route says it failed', () => {
  it('the behavioural run recorded a mode for every exercised route (reachability)', () => {
    expect([...modes.keys()].sort()).toEqual(CASES.map((c) => c.file).sort())
  })

  it('consumers are found by deriving them from source', () => {
    // Positive controls: known consumers of known routes.
    expect(UI_FILES.filter((f) => routePattern('app/api/search/route.ts').test(code(f)))).toContain('components/GlobalSearch.tsx')
    expect(UI_FILES.filter((f) => routePattern('app/api/news/[sector]/route.ts').test(code(f)))).toContain('components/NewsFeed.tsx')
  })

  it.each(CASES.map((c) => [c.file] as const))('%s', (file) => {
    const mode = modes.get(file)
    expect(mode, 'no mode recorded').toBeDefined()
    const consumers = UI_FILES.filter((f) => routePattern(file).test(code(f)))
    if (consumers.length === 0) {
      expect(NO_UI_CONSUMER, `${file} has no UI consumer; add it to NO_UI_CONSUMER if that is intended`).toContain(file)
      return
    }
    expect(NO_UI_CONSUMER).not.toContain(file)
    const blind = consumers.filter((f) => !READS[mode!].test(withImports(f)))
    expect(blind, `${file} answers failure as '${mode}', and these consumers never look`).toEqual([])
  })
})
