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
 * a 5xx status, or `degraded: true` in a 2xx body (health probes: `ok:
 * false`; the sector brief: `dataQuality: 'unavailable'`). A route that
 * answers a clean 2xx while nothing upstream worked is presenting nothing as
 * data.
 *
 * THE SET IS EVERY ROUTE ON DISK. Each is either exercised in `CASES` or
 * listed in `EXEMPT` with a reason, and a test fails when a route is in
 * neither — so a new route cannot quietly fall outside the detector.
 *
 * Red-team round 1 (2026-10-16) broke the first version three ways, each now
 * an assertion here: a case that never reached its upstream passed vacuously
 * (H3), a 4xx counted as "said it failed" (H3), and the brief's `partial` was
 * accepted although it was also the healthy steady state (H1).
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { NextRequest } from 'next/server'
import { stripComments } from './sourceText'
import { PUBLIC_SURFACE, buildImportGraph } from './importGraph'
import type { SourceFile } from './vendorEgress'

vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: vi.fn(async () => null) }))

/** Calls that reached an upstream mock — a case that reaches none proves nothing. */
const upstream = vi.hoisted(() => ({ yahoo: 0 }))

// Every yahoo-finance2 method throws, whatever it is called.
vi.mock('yahoo-finance2', () => {
  const down = () => { upstream.yahoo += 1; return Promise.reject(new Error('upstream down (yahoo)')) }
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
  /** The sector brief's own vocabulary: with everything down it must say `unavailable`. */
  brief?: boolean
  /** Environment for the call (e.g. to make an optional service "configured"). */
  env?: Record<string, string>
}

const CASES: Case[] = [
  { file: 'app/api/analytics/[ticker]/route.ts', url: '/api/analytics/AAPL', params: { ticker: 'AAPL' } },
  { file: 'app/api/briefs/route.ts', url: '/api/briefs' },
  { file: 'app/api/briefs/[sector]/route.ts', url: '/api/briefs/technology', params: { sector: 'technology' }, brief: true },
  { file: 'app/api/chart/[ticker]/route.ts', url: '/api/chart/AAPL?range=1mo&interval=1d', params: { ticker: 'AAPL' } },
  { file: 'app/api/conditional-vol/[ticker]/route.ts', url: '/api/conditional-vol/AAPL', params: { ticker: 'AAPL' }, env: { QUANT_FRAMEWORK_URL: 'http://quant.test' } },
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
  { file: 'app/api/regime/[ticker]/route.ts', url: '/api/regime/AAPL', params: { ticker: 'AAPL' }, env: { QUANT_FRAMEWORK_URL: 'http://quant.test' } },
  { file: 'app/api/search/route.ts', url: '/api/search?q=bank' },
  { file: 'app/api/sector-rotation/route.ts', url: '/api/sector-rotation' },
  // H3: without a base the route answered config_error before calling anything.
  { file: 'app/api/trading-agents/health/route.ts', url: '/api/trading-agents/health', health: true, env: { TRADING_AGENTS_BASE: 'https://ta.test' } },
]

/** Routes deliberately outside this detector, each with the reason. */
const EXEMPT: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts': 'NextAuth handler; no market-data upstream.',
  'app/api/backtest/route.ts': 'Reads committed fixtures (lib/backtest/dataLoader), no network upstream.',
  'app/api/backtest/live/route.ts': 'Reads committed fixtures, no network upstream.',
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

// ─── The behavioural run ─────────────────────────────────────────────────────
//
// Run ONCE, memoised, and read by both blocks below — so a `-t` filter or a
// shuffled order cannot leave the consumer half without modes (red-team L11).

interface Outcome { status: number; body: Record<string, unknown> | null; upstreamCalls: number }

async function runCase(c: Case): Promise<Outcome> {
  vi.resetModules()
  vi.unstubAllEnvs()
  let fetchCalls = 0
  vi.stubGlobal('fetch', vi.fn(() => { fetchCalls += 1; return Promise.reject(new TypeError('upstream down (fetch)')) }))
  const quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
  const yahooBefore = upstream.yahoo
  try {
    for (const [k, v] of Object.entries(c.env ?? {})) vi.stubEnv(k, v)
    const mod = (await import(join(ROOT, c.file))) as { GET: (req: NextRequest, ctx?: unknown) => Promise<Response> }
    const res = await mod.GET(new NextRequest(new URL(c.url, 'http://localhost:3000')), { params: Promise.resolve(c.params ?? {}) })
    const body = (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as Record<string, unknown>) : null
    return { status: res.status, body, upstreamCalls: fetchCalls + (upstream.yahoo - yahooBefore) }
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    for (const s of quiet) s.mockRestore()
  }
}

let outcomes: Promise<Map<string, Outcome>> | null = null
function allOutcomes(): Promise<Map<string, Outcome>> {
  outcomes ??= (async () => {
    const out = new Map<string, Outcome>()
    for (const c of CASES) out.set(c.file, await runCase(c))
    return out
  })()
  return outcomes
}

/** How each route says it failed. */
type Mode = 'status' | 'degraded' | 'health'
const modeOf = (c: Case, o: Outcome): Mode => (o.status >= 300 ? 'status' : c.health ? 'health' : 'degraded')

const RUN_TIMEOUT = 300_000

describe('Q-140 — with every upstream down, no route answers a clean 2xx', () => {
  it.each(CASES.map((c) => [c.file, c] as const))('%s', async (_f, c) => {
    const o = (await allOutcomes()).get(c.file) as Outcome
    // H3: a case that never called an upstream passed whatever it answered.
    expect(o.upstreamCalls, 'the route reached no upstream, so this case proves nothing').toBeGreaterThan(0)
    if (o.status >= 300) {
      // H3: a 4xx is a validation or config answer, not "my upstream failed".
      expect(o.status, 'a non-2xx answer to an upstream outage must be 5xx').toBeGreaterThanOrEqual(500)
      return
    }
    if (c.health) {
      expect(o.body?.ok, 'a health probe with every upstream down must report ok:false').toBe(false)
      return
    }
    if (c.brief) {
      // H1: `partial` is also what a healthy day looked like before the B1 fix,
      // so it cannot be the signal for "everything is down".
      expect(o.body?.dataQuality).toBe('unavailable')
      return
    }
    expect(o.body?.degraded, `answered ${o.status} with no degraded signal: ${JSON.stringify(o.body).slice(0, 240)}`).toBe(true)
  }, RUN_TIMEOUT)
})

// ─── The consumer half ────────────────────────────────────────────────────────
//
// A degraded answer nobody reads is the defect Q-140 was filed for. So every
// LIVE UI file that fetches an exercised route must handle, AT EACH FETCH
// SITE, a non-2xx answer (every route has a 429 path) — and, for a route that
// fails as a 2xx, read the flag.
//
// Red-team round 1, B2: the first version accepted a `.ok` read ANYWHERE in the
// file, so app/page.tsx passed for /api/prices on the `.ok` of its /api/briefs
// fetch, and three more consumers passed the same way. K1: it also counted
// components/SectorRotationPanel.tsx, which nothing had rendered since PR #41.

const SOURCE_FILES: SourceFile[] = (() => {
  const out: SourceFile[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e)) out.push({ path: relative(ROOT, p), source: readFileSync(p, 'utf8') })
    }
  }
  for (const d of ['app', 'components', 'hooks', 'lib']) walk(join(ROOT, d))
  for (const f of ['middleware.ts']) {
    try { out.push({ path: f, source: readFileSync(join(ROOT, f), 'utf8') }) } catch { /* optional root file */ }
  }
  return out
})()

/** UI files a page can actually render: reachable from an `app/` surface. */
const LIVE_UI_FILES = (() => {
  const edges = buildImportGraph(SOURCE_FILES)
  const seen = new Set<string>()
  const stack = SOURCE_FILES.map((f) => f.path).filter((p) => PUBLIC_SURFACE.test(p))
  while (stack.length > 0) {
    const f = stack.pop() as string
    if (seen.has(f)) continue
    seen.add(f)
    for (const g of edges.get(f) ?? []) stack.push(g)
  }
  return [...seen].filter((f) => !f.startsWith('app/api/')).sort()
})()

const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), rel)

/** The route's URL path as a pattern; a dynamic segment matches a literal or a `${…}`. */
function routePattern(file: string): RegExp {
  const segs = file.replace(/^app/, '').replace(/\/route\.tsx?$/, '').split('/')
  const body = segs
    .map((seg) => (/^\[.*\]$/.test(seg) ? '(?:\\$\\{[^}]*\\}|[A-Za-z0-9_.-]+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`['"\`]${body}(?=[\`'"?])`, 'g')
}

/** A file's own code plus the code of every `@/` module it imports (one hop). */
function withImports(rel: string): string {
  const src = code(rel)
  const deps = [...src.matchAll(/from\s+['"]@\/([^'"]+)['"]/g)].map((m) => m[1])
  const resolved = deps.flatMap((d) => [`${d}.ts`, `${d}.tsx`, `${d}/index.ts`]).filter((f) => SOURCE_FILES.some((s) => s.path === f))
  return [src, ...resolved.map(code)].join('\n')
}

/**
 * How far after a route literal its response handling may sit. MEASURED on
 * the tree (2026-10-16): the farthest legitimate check is useBtcCandles at
 * ~1650 characters (a parse helper sits between fetch and `.ok`). The window
 * also ends at the next `/api/` literal — unless that literal is in the SAME
 * expression (within ADJACENT chars, e.g. NewsFeed's ticker/sector ternary).
 */
const SITE_WINDOW = 2000
const ADJACENT = 200
const API_LITERAL = /['"`]\/api\//g
const HANDLES_STATUS = /\.ok\b/

/**
 * Every fetch site of `pattern` in `src` that does not handle a non-2xx
 * answer. Pure, so the red-team mutation is a test case below.
 */
function unhandledSites(src: string, pattern: RegExp): number[] {
  const apiAt = [...src.matchAll(API_LITERAL)].map((m) => m.index as number)
  const bad: number[] = []
  for (const m of src.matchAll(new RegExp(pattern.source, 'g'))) {
    const at = m.index as number
    if (src.slice(Math.max(0, at - 24), at).includes('fetchJsonSafe(')) continue // handles non-2xx itself
    let end = at + SITE_WINDOW
    let cursor = at
    for (const next of apiAt) {
      if (next <= cursor) continue
      if (next - cursor <= ADJACENT) { cursor = next; continue } // same expression
      end = Math.min(end, next)
      break
    }
    const window = src.slice(at, end)
    if (HANDLES_STATUS.test(window)) continue
    // SWR: the literal is the key; the check lives in the named fetcher.
    const swr = /useSWR(?:<[^>]*>)?\(\s*[\w.]+\s*,\s*(\w+)/.exec(window)
    if (swr) {
      const def = new RegExp(`(?:const|function)\\s+${swr[1]}\\b`).exec(src)
      if (def && HANDLES_STATUS.test(src.slice(def.index, def.index + 800))) continue
    }
    bad.push(at)
  }
  return bad
}

const FLAG_READ = /\bdegraded\b|\bdataQuality\b/

// CANNOT DO, stated so a green run is not read as a proof:
//  - The flag read (degraded/dataQuality) is still bound to a FILE, not a
//    payload: a consumer importing a module that reads ANOTHER route's flag
//    passes — BtcQuantLab imports LiquidationsPanel (mutation C1). Reads that
//    matter are pinned by render tests (e.g. BtcQuantLabMetricsDegraded).
//  - The status check is bound to a WINDOW after each literal, not to the
//    response variable: a `.ok` on an unrelated object inside the window counts.
//  - A URL built far from its fetch (a literal in one module, the fetch in
//    another) is checked where the literal is.

/** Exercised routes with no LIVE UI consumer today. A new one fails here to be looked at. */
const NO_UI_CONSUMER = [
  'app/api/conditional-vol/[ticker]/route.ts',
  'app/api/ml/[ticker]/route.ts',
  'app/api/regime/[ticker]/route.ts',
  'app/api/sector-rotation/route.ts',
]

describe('Q-140 — every live consumer handles the way its route says it failed', () => {
  it('the per-site check rejects a sibling fetch\'s .ok (red-team B2 mutation, executable)', () => {
    const src = [
      "const a = await fetch('/api/prices', { signal })",
      'const data = await a.json()',
      'x'.repeat(300),
      "const b = await fetch('/api/briefs', { signal })",
      'if (b.ok) { use(await b.json()) }',
    ].join('\n')
    expect(unhandledSites(src, routePattern('app/api/prices/route.ts'))).toHaveLength(1)
    expect(unhandledSites(src, routePattern('app/api/briefs/route.ts'))).toEqual([])
  })

  it('accepts the three legitimate shapes: inline .ok, fetchJsonSafe, an SWR fetcher', () => {
    const swr = "const fetcher = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(); return r.json() }\nconst key = '/api/prices'\nuseSWR(key, fetcher)"
    expect(unhandledSites(swr, routePattern('app/api/prices/route.ts'))).toEqual([])
    expect(unhandledSites("const r = await fetchJsonSafe('/api/crypto/btc/metrics')", routePattern('app/api/crypto/btc/metrics/route.ts'))).toEqual([])
    const ternary = "const url = t ? `/api/news/ticker/${t}` : `/api/news/${s}`\nfetch(url).then(r => { if (!r.ok) throw 0 })"
    expect(unhandledSites(ternary, routePattern('app/api/news/ticker/[ticker]/route.ts'))).toEqual([])
  })

  it('consumers come only from files a page can render (K1)', () => {
    expect(LIVE_UI_FILES).toContain('components/GlobalSearch.tsx')
    expect(LIVE_UI_FILES).toContain('components/NewsFeed.tsx')
    expect(LIVE_UI_FILES).toContain('components/stock/QuantLabPanel.tsx') // reached through next/dynamic
    expect(LIVE_UI_FILES.some((f) => f.endsWith('SectorRotationPanel.tsx'))).toBe(false)
  })

  it.each(CASES.map((c) => [c.file, c] as const))('%s', async (file, c) => {
    const o = (await allOutcomes()).get(file) as Outcome
    const mode = modeOf(c, o)
    const pattern = routePattern(file)
    const consumers = LIVE_UI_FILES.filter((f) => new RegExp(pattern.source).test(code(f)))
    if (consumers.length === 0) {
      expect(NO_UI_CONSUMER, `${file} has no live UI consumer; add it to NO_UI_CONSUMER if that is intended`).toContain(file)
      return
    }
    expect(NO_UI_CONSUMER).not.toContain(file)
    const noStatus = consumers.filter((f) => unhandledSites(code(f), pattern).length > 0)
    expect(noStatus, `${file}: these consumers have a fetch site that ignores a non-2xx answer`).toEqual([])
    if (mode === 'degraded') {
      const noFlag = consumers.filter((f) => !FLAG_READ.test(withImports(f)))
      expect(noFlag, `${file} fails as a 2xx with degraded:true, and these consumers never read it`).toEqual([])
    }
  }, RUN_TIMEOUT)
})
