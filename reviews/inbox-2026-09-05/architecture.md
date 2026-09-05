# Architecture review — 2026-09-05

**Agent:** platform-architect · **Branch:** `fix/Q107-A23-quarantine-vs-freshness` (`842e83f`, wave commit `c44d303`)
**Territory:** `app/api/` route shape and contracts · `lib/` module boundaries and layering · `middleware.ts` · `next.config.js` · `package.json` · overall structure
**Ids reserved:** `Q110-P1`…`Q110-P29` (used: P1–P18)
**Wrote:** this file only. No source edited. No `reviews/findings-ledger.csv` write. `git status` clean.

---

## Headline

**The layering is sound. The seams are not.**

The dependency graph is acyclic and correctly stratified — `lib/quant` never reaches down into
`lib/data` or `app/`, and nothing under `lib/` imports `components/` or `hooks/`. That is better
than most codebases of this age and it is worth saying plainly, because it means the structural
problems here are *not* the ones a reviewer usually finds.

The recurring defect is one level up and it has a single shape:

> **A shared helper is built, declared the SSOT in its own docstring, and then not adopted at the
> boundary that needed it — while a second, sometimes better, implementation of the same concern
> lives on inside a route file.**

Four independent instances, each verified against the tree:

| Concern | Declared SSOT | Adoption | The other implementation |
|---|---|---|---|
| Security identity (I6) | `lib/data/securityId.ts:1` "the SSOT" | **0** call sites in `app/api/` | `lib/api/sanitize.ts:47` `normalizeTicker` — different semantics |
| Error envelope | `lib/api/reliability.ts:122` `errorResponse` | **3 of 28** routes | 4 further envelope shapes, inline |
| Retry / backoff | `lib/api/reliability.ts:45` `withRetry` | 14 sites, 9 files | `app/api/crypto/btc/route.ts:25` — **strictly better**, unshared |
| Timeout wrapper | `lib/api/reliability.ts:71` `withTimeout` | — | `app/api/briefs/route.ts:76` — verbatim duplicate |

This is precisely the failure CLAUDE.md names as "the single most expensive recurring failure in
this repo." It has not been fixed; it has moved from the quantitative core (indicators, sector
colours, execution costs) to the API boundary, where there is no equivalent guard watching for it.

**Severity distribution:** 3 HIGH · 6 MED-HIGH/MED · 9 LOW-MED/LOW · 8 checked-and-clear.

---

## Method, and one defect in my own instrument

I wrote a dependency-graph tool (227 files, 656 edges, `@/` and relative specifiers resolved
through `tsconfig.json` paths) because **`madge` is not installed** — see `Q110-P17`.

**My first run reported 1 cycle. That was an artifact of my tool, not a cycle.** The reported edge
was `lib/backtest/dataLoader.ts -> lib/backtest/dataLoader.ts`, matched from a **doc comment** at
`lib/backtest/dataLoader.ts:15-17`:

```
//     the data-loading layer; the type is re-exported here so existing imports
//     from '@/lib/backtest/dataLoader' continue to resolve unchanged.
```

My matcher was line-based with no comment stripping — the same defect `Q-101` had to fix in
`__tests__/architecture/cache-flag-consumed.test.ts` ("it **strips comments**, because the first
version matched `_cached` in the explanatory comments"). I am recording it rather than quietly
correcting it, because a review that ships an unverified sentence is the thing this package exists
to remove.

**The corrected result: the graph is acyclic. Zero cycles.** Every layering claim below rests on
the corrected run.

---

# 1 · Layering — CLEAR, with two caveats

Zero violations found across every rule I checked:

- `lib/quant/**` → `lib/data/`, `app/`, `components/`, `hooks/`: **0 edges**.
  `lib/quant`'s only non-local import in the entire directory is `lib/quant/sectorRotation.ts:17`
  → `lib/sectors` (a static reference table). The pure-maths core is genuinely pure.
- `lib/**` → `components/` or `hooks/`: **0 edges**.
- `app/api/**` → `components/`: **0 edges**. Route → route: **0**.
- Cycles: **0** (see method note).

**No god-file.** The highest fan-in is `lib/quant/indicators.ts` at 29 — but that is the declared
indicator SSOT, so high fan-in is the design working, not a hub forming. `lib/api/rateLimit.ts` (27)
and `lib/api/sanitize.ts` (26) are cross-cutting boundary helpers; that is also correct. The largest
file, `lib/quant/indicators.ts` at 712 lines, is cohesive.

**This is a genuine strength and should not be traded away.** The recommendations below are
deliberately confined to `app/api/` and `lib/api/` so that none of them perturbs it.

### `Q110-P1` — The I6 identity SSOT has zero consumers at the request boundary · **HIGH · CONFIRMED**

`lib/data/securityId.ts:1-3` opens: *"Security identity — the SSOT for 'which instrument is this?'
(invariant I6)."* Grepping `canonicalSecurityId` across the tree returns exactly two consumers —
`lib/backtest/dataLoader.ts:40` and `lib/optimize/sectorProfiles.ts:268`. **`app/api/` contains
zero.**

Every one of the 28 routes canonicalises identity through `lib/api/sanitize.ts:47 normalizeTicker`
instead, and the two functions do **not** agree. `normalizeTicker` applies a character whitelist
(`TICKER_REGEX`, `:36`) and a US-index `^` prefix, but performs **no share-class canonicalisation** —
`BRK-B` and `BRK.B` both pass and both survive unchanged. `canonicalSecurityId:63` collapses both to
`BRK.B`.

So Q-080 closed I6 on the offline path and left the live path with a second, incompatible identity
function. CLAUDE.md's I6 entry reads "identity is now consistent"; that claim is true of
`lib/backtest/` and false of `app/api/`.

**Confirmed consequence — a valid query silently returns the wrong answer.** In
`app/api/backtest/live/route.ts`:

- `:71` `.map((t) => strictNormalizeTicker(t))` — the `?tickers=` param, un-canonicalised.
- `:90` `if (specificTickers && !specificTickers.includes(ticker)) continue` — compared against
  `SECTORS[…].topHoldings`, which spells it `BRK.B` (`lib/sectors.ts:50`).

The chain closes on real data in the repo:

| Request | After `normalizeTicker` | `.includes('BRK.B')` | Result |
|---|---|---|---|
| `?tickers=BRK.B` | `BRK.B` | true | signal returned |
| `?tickers=BRK-B` | `BRK-B` | **false** | **silently dropped — HTTP 200, empty** |

`BRK-B` is the spelling the universe itself uses (`scripts/fetchBacktestData.mjs:24`) and the
fixture on disk is `BRK-B.json`. There is no `unknownTickers` field in the response, so the caller
cannot distinguish "that name has no signal today" from "you spelled it the way our own universe
file does." That is a direct I2 fail-silent, on a valid input, produced by the identity split.

The same split makes `${ticker}:${range}` (`app/api/chart/[ticker]/route.ts:49`) two distinct cache
entries for one security.

**The architectural point, which is bigger than the bug.** `normalizeTicker` is doing two jobs that
must diverge: it computes *identity* (what security is this?) and it produces the *vendor symbol*
sent to Yahoo. Those cannot be the same string — the SSOT canonicalises to `BRK.B`, and Yahoo wants
`BRK-B`. The repo has no `id → vendor symbol` mapping, which is why the two concerns are fused into
one function. Naming that missing concept is the decision to record; see Ranked change #3.

### `Q110-P2` — Three routes serve stored copies with no `_cached` flag, and the I2 guard structurally cannot see them · **HIGH · CONFIRMED**

CLAUDE.md records I2's cache-substitution clause as **CLOSED by `Q-101`**: *"`_cached` was set by
three routes and read by nobody… All three now have a consumer that shows it."*

**There are six in-process caches in `app/api/`, not three.** The other three serve a stored copy
and set no flag at all:

| Route | Cache | Serve-from-cache | TTL | `_cached` |
|---|---|---|---|---|
| `app/api/chart/[ticker]/route.ts` | `_chartCache` `:11` | `:52-70` | 30 s | ✅ `:60` |
| `app/api/crypto/btc/metrics/route.ts` | `_cache` | `:74` | 5 s | ✅ `:74` |
| `app/api/crypto/btc/liquidations/route.ts` | `_cache` | `:34` | 10 s | ✅ `:34` |
| **`app/api/backtest/route.ts`** | `cache` `:22` | **`:147-149`** | **1 h** | ❌ |
| **`app/api/backtest/live/route.ts`** | `cache` `:21` | **`:78-82`** | **60 s** | ❌ |
| **`app/api/ma-deviation/route.ts`** | `_cache` `:13` | **`:30-35`** | **5 min** | ❌ |

`app/api/backtest/route.ts:148` is `return NextResponse.json(cache.data, { headers: CACHE_HEADERS })`
— a payload up to an hour old, byte-identical to a fresh one, with a `computedAt` that will read as
current-ish and nothing anywhere saying it was stored.

**Why the guard is green — this is a fifth guard-reachability shape.** From
`__tests__/architecture/cache-flag-consumed.test.ts:55-56`:

```ts
const producers = files.filter(
  (f) => f.path.startsWith('app/api/') && /_cached:\s*true/.test(f.source),
)
```

The producer set is *defined as* "routes that already set `_cached: true`." **The visitor is defined
by the property being checked**, so a route that omits the flag is not a failure — it is not a
producer. The test's own docstring says it asserts per-producer because "an aggregate check stays
green while two of three routes still serve stored copies silently." That is exactly what is
happening, one level up, to the test itself.

The four shapes in `guard_reachability_lesson.md` were: unreachable directory, unreachable
extension, a positive control exercising the decider not the visitor, and a guard that cannot fail.
**This is the fifth: a visitor whose membership predicate is the property.** The lesson generalises —
*when a guard is green, ask what it visited before you ask what it decided* — and it caught this too.

**Consequence:** I2's cache-substitution clause is not closed. It is closed on three routes and open
on three, and the one with the widest exposure (`/api/backtest`, 1-hour TTL + `s-maxage=3600,
stale-while-revalidate=7200` at `:144` — a **3-hour** worst-case age) is on the open side.

*Guard fix belongs to test-engineer; the finding is anchored on the three route files.*

### `Q110-P3` — "The vendor is down" and "there is nothing to show" are the same response on three routes · **HIGH · CONFIRMED**

The repo has already diagnosed this failure class, in its own words, at
`app/api/search/route.ts:127-134`:

> *"the catch below then returns a well-formed `{quotes:[]}` with HTTP 200, so 'Yahoo's schema
> changed' is indistinguishable from 'no securities match' — exactly what let the news equivalent
> run for three months."*

The fix that comment justifies (`validateResult: false`) addresses the *cause of the throw*. **The
response shape it describes is unchanged, and it is still live on three routes.**

**`app/api/search/route.ts:150-152` — the worst instance, and the one the comment is attached to.**
The inner catch logs and falls through with an empty `out`; execution reaches `:170`
`return NextResponse.json({ quotes: out.slice(0, limit) })` — **HTTP 200, and no `error` field at
all.** A total Yahoo outage is byte-identical to a search for a nonexistent company.

**`app/api/search/route.ts:99-101` — the outer catch.**
`return NextResponse.json({ quotes: [], error: 'search_unavailable' })` — **no status argument, so
HTTP 200.** This is the "200 carrying `{error}`" case: at least the field is present, but every
client that branches on `res.ok` takes the success path.

**`app/api/regime/[ticker]/route.ts:38` and `app/api/conditional-vol/[ticker]/route.ts:37` —
the same conflation, different vendor.** Both return `{ error: 'no_data' }` with **404** when
`loadStockHistory(ticker)` is empty. But `loadStockHistory` returns `[]` for *both* "we have no
fixture for this name" *and* "the data layer could not read" — the loader's own contract
(`lib/backtest/dataLoader.ts:56`) is "Returns empty array if data not found in either source." A
404 says "this resource does not exist," which is a claim about the universe, not about our
plumbing.

**Consequence:** this is a PRIME-DIRECTIVE failure, not a cosmetic one. A platform whose product is
calibrated confidence is answering "I have nothing for you" when the honest answer is "I could not
find out." It got three months of undetected runtime once already, on the surface the comment names.

### `Q110-P4` — The shared retry helper has no error classification; the better one is quarantined in a route file · **MED-HIGH**

**CONFIRMED, plan-independent:** `lib/api/reliability.ts:50-66` catches **every** error identically
and retries. There is no notion of retryable-vs-terminal: a 400, a 404, a 429, a timeout and a
schema-validation failure are treated the same. `Retry-After` is never read — the header does not
appear anywhere in `lib/`. Backoff for the first (and, at `attempts: 2`, only) retry is
`backoffDelayMs(0, 200, 2000)` = **0–199 ms**.

This helper serves **14 call sites across 9 files** — `app/api/{ma-deviation, fundamentals ×4,
prices, stream, stream/[ticker], chart, sector-rotation, analytics ×3}` and `lib/options/chain.ts:204`
— i.e. essentially the whole Yahoo surface, including `/api/prices` (`:131`), the 3-second-refresh
endpoint.

**Meanwhile the correct implementation already exists and already runs in production**, trapped
inside one route: `app/api/crypto/btc/route.ts:25-59` classifies status codes, honours `Retry-After`
capped at 30 s (`:37-39`), backs off exponentially on 429/418, retries 5xx separately, and returns
non-retryable statuses immediately. It is not exported and nothing outside that file can use it.

**PLAUSIBLE — the amplification consequence.** Whether a Yahoo 429 reaches `withRetry` as a thrown
error depends on `yahoo-finance2`'s internal error handling, which I did not verify. If it does, the
platform's response to being told to slow down is to retry within 200 ms across every affected route.
*The structural finding does not depend on that link:* the shared helper cannot distinguish
"upstream said stop" from "upstream blipped," and there is a helper in the tree that can.

### `Q110-P5` — `/api/trading-agents/[ticker]` sets a 300 000 ms timeout with zero headroom and no `maxDuration` · **MED-HIGH**

**CONFIRMED, plan-independent — the arithmetic.** `app/api/trading-agents/[ticker]/route.ts:10` is
`const TIMEOUT_MS = 5 * 60 * 1000`, used at `:81` (GET) and `:323` (POST). That is **exactly 300 000
ms — the platform ceiling**, leaving **zero** headroom for the abort handler to build and flush a
response.

The repo has an SSOT whose entire purpose is preventing this, and it is not consulted.
`lib/api/streamBudget.ts:39-45` reserves a 30-second lead precisely so the graceful path can run
inside the ceiling, and its docstring records the incident that motivated it (13 production
`Task timed out after 300 seconds` errors on 2026-07-28). Nothing derives `TIMEOUT_MS` from
`STREAM_MAX_DURATION_S`, and no test asserts a relationship between them — the mechanism that stops
the stream routes from drifting has no analogue here.

**PLAUSIBLE — the 504 branch is dead code.** The route exports **no `maxDuration`** (only `runtime =
'nodejs'` at `:54`), and `vercel.json` contains no `functions` block, so the function runs at the
platform default. On every current Vercel plan that default is far below 300 s, which would make the
`AbortController` unfirable and the `analysis_timeout` → 504 branch at `:117-121` unreachable —
the identical shape to the `/api/stream` graceful-close bug. **Confirming this requires the plan's
configured default, which I cannot read from the repo,** and per CLAUDE.md route config is
static-analysis-only: only the Vercel build and a live probe can settle it.

Two routes with substantial compute are in the same position — `app/api/backtest/route.ts`
(56-instrument aggregation, `:124`) and `app/api/briefs/route.ts` (`:134`) — neither exports
`maxDuration`, and neither is covered by `scripts/smoke-production.mjs`, which probes only
6 of 28 endpoints (`:39, 67, 84, 94, 97, 120, 137`).

### `Q110-P6` — `dataSource: 'local'` is asserted as a literal type while the loader may have read SQLite · **MED · CONFIRMED (mislabel) · LATENT (divergence)**

`app/api/backtest/route.ts:37` declares the field as the **literal type** `dataSource: 'local'` and
`:98` sets it; `app/api/backtest/live/route.ts:112` does the same. But `lib/backtest/dataLoader.ts:59-63`
is explicit: *"Priority: SQLite warehouse → local JSON file,"* and takes the warehouse branch
whenever `isWarehouseAvailable()`.

**The mislabel is CONFIRMED, and the type system is enforcing the wrong value.** Because `:37` is a
literal type rather than a union, `tsc` would *reject* an attempt to report the truthful
`'warehouse'`. The provenance field is pinned to a constant by the compiler — I1 inverted.

**The divergence is LATENT, not live.** The two sources are not equivalent: `lib/backtest/dataLoader.ts:106`
records that the warehouse path has **no dividend column**, so `computeBuyAndHoldReturn` receives a
price-only benchmark from one source and a dividend-adjusted one from the other. On a developer
machine with a populated warehouse, `/api/backtest` and `npm run benchmark` would compute a
different buy-and-hold baseline than CI does — and I5's deciding statistic is the *excess over* that
baseline. But no `.db` exists in this tree, `.gitignore:56` (`*.db`) keeps one from being committed,
and on Vercel the read-only filesystem makes `new Database()` throw into the `catch` at
`lib/data/warehouse.ts:38-40`. So today every path reads JSON. **The label is wrong now; the
numerical divergence is one populated database away.**

### `Q110-P7` — Five mutually incompatible error envelopes across 28 routes · **MED · CONFIRMED**

A canonical envelope exists — `lib/api/reliability.ts:102-127`,
`{ degraded, error: { code, message, details? }, timestamp }` — and is used by **3 of 28 routes**
(`prices:197`, `fundamentals:162`, `analytics:126`). The other 25 emit one of four other shapes:

| Shape | Example | `error` is |
|---|---|---|
| `{ error: "<prose>" }` | `chart:44`, `fundamentals:41`, `darkpool:195`, `analytics:34` | a human sentence |
| `{ error: "<snake_code>" }` | `regime:32`, `conditional-vol:31`, `news/ticker:47` | a machine code |
| `{ error: { code, message } }` | `prices:197` via `errorResponse` | an **object** |
| `{ quotes: [], error }` at 200 | `search:101` | a code, on a success status |
| `{ available: false, error, details }` | `ml:34, :57` | a code beside a domain flag |
| `{ status: 'ok', … }` | `backtest:191` | absent; different envelope key |

**Concrete consequence:** a client reading `data.error.code` — correct against `/api/prices` — gets
`undefined` against `/api/chart`. A client reading `String(data.error)` — correct against
`/api/chart` — renders `"[object Object]"` against `/api/prices`. There is no shared client-side
error type because there is no shared server-side one.

The same inconsistency covers status codes: `search:101` returns 200 with an error, while
semantically identical failures elsewhere return 404 (`chart:87`), 422 (`analytics:37`), 500
(`backtest:191`), 502 (`crypto/btc/quote:26`) and 504 (`trading-agents:118`).

**Note the one genuinely good idea here, which deserves to survive any consolidation:**
`degradedResponse` (`lib/api/reliability.ts:110`) defaults to status **200** *while setting
`degraded: true`* — that is not the 200-with-error anti-pattern, it is a deliberate "the request
succeeded, the data is partial" channel. It has zero call sites. Adopting it is the honest fix for
`Q110-P3`'s search route.

### `Q110-P8` — `zod` is named in HOUSE STYLE and does not exist in this project · **MED · CONFIRMED**

CLAUDE.md HOUSE STYLE: *"Runtime validation at every I/O boundary (zod). Parse, don't validate."*

- `grep -rn zod app lib middleware.ts scripts` → **zero matches.**
- `zod` is **not a dependency** in `package.json`. It appears in `package-lock.json` only as a
  transitive dependency of `@vercel/*` and `mutation-server-protocol` — dev tooling.

**This is the same shape as the struck "lint clean" clause**, which CLAUDE.md resolves by saying:
*"an unenforceable clause in the definition of done manufactures false confidence."* HOUSE STYLE
currently names a library the project does not have, at every boundary it does not guard.

The absence is concentrated and therefore fixable — the five untyped vendor mappings are exactly
where it bites:

- `app/api/prices/route.ts:142` — `results.map((q: any) => …)`, the Yahoo quote payload
- `app/api/chart/[ticker]/route.ts:205, 211` — Yahoo chart quotes
- `app/api/ma-deviation/route.ts:80, 97` — Yahoo chart closes

`app/api/search/route.ts:141-148` shows what hand-rolled parsing looks like when someone does it
properly (`in`-narrowing every field) — which is also the argument that a schema library would be
shorter and consistent. `Q-094` tracks the news boundary; these are the others.

*Recommendation is to pick a direction, not to migrate 28 routes — see "Not worth fixing."*

---

# 4 · Caching — a set of independent decisions, not a strategy

### `Q110-P9` — Three cache layers compose, and no route declares a staleness contract · **MED · CONFIRMED**

Design invariant I2 requires a cache to answer two questions: *what is the max age, and what does
the UI show when it is exceeded.* **No route in `app/api/` answers either.** There is no `maxAgeMs`,
no `staleAfter`, no `asOf` budget in any response payload — only `computedAt`/`fetchedAt` timestamps
that a client would have to interpret against a policy it cannot see.

Three layers stack independently, and the user-visible age is their **sum**:

1. **In-process** module-scope cache in 6 routes — TTLs of 5 s, 10 s, 30 s, 60 s, 5 min, 1 h,
   each an unrelated local constant.
2. **HTTP** `Cache-Control` — 12 distinct policies, spanning `s-maxage=3` to `s-maxage=86400`.
3. **Client SWR** with `keepPreviousData` (frontend-engineer's territory; CLAUDE.md I2 already
   flags it as the most likely remaining violation).

Worst cases from layers 1+2 alone:

| Route | In-process | HTTP | Worst-case age |
|---|---|---|---|
| `app/api/backtest/route.ts:22, :144` | 1 h | `s-maxage=3600, swr=7200` | **3 hours** |
| `app/api/conditional-vol/[ticker]/route.ts:42` | — | `s-maxage=86400, swr=172800` | **3 days** |
| `app/api/regime/[ticker]/route.ts:43` | — | `s-maxage=3600, swr=7200` | 3 hours |
| `app/api/ma-deviation/route.ts:13, :33` | 5 min | `public, max-age=300, swr=600` | ~20 min |

Not one of these numbers agrees with the layer above or below it. `/api/backtest` at least aligns
its two TTLs (`:141-144` says so explicitly, and that comment is the only evidence in the tree that
anyone has considered the composition).

### `Q110-P10` — A Python-sidecar fallback gets CDN-cached for up to three days under the same URL as the real model · **MED-HIGH · CONFIRMED**

This is the sharpest caching consequence and it is fully visible from the route files.

`app/api/conditional-vol/[ticker]/route.ts:38-43` passes the client result straight through with
`Cache-Control: s-maxage=86400, stale-while-revalidate=172800`. `app/api/regime/[ticker]/route.ts:39-44`
does the same with `s-maxage=3600, swr=7200`.

Those clients fall back to a local approximation when the sidecar is unreachable, and they label it
in the payload (`source: 'ewma-fallback'` vs `'python'`). **The route's HTTP contract does not
distinguish them.** Same URL, same status, same cache key.

**Consequence:** a single request landing during a 30-second sidecar outage pins the fallback
approximation into the shared CDN cache and serves it to **every** user for up to 24 hours, and up
to 72 hours counting `stale-while-revalidate`. Recovery of the sidecar does not evict it; nothing
invalidates on the source changing. A `Vary` header cannot help — the varying dimension is server
state, not a request header.

**This is I2's "never substitute a cached value for a live one without a visible flag," with the
flag present in the payload and absent from the transport that decides who sees it.** The correct
shape is `no-store` (or a much shorter `s-maxage`) on the fallback branch — the cache policy must be
a function of provenance.

*The `source` field itself and its UI consumption are quant-validator / frontend territory. The
finding here is that the route caches two different provenances under one key.*

### `Q110-P11` — A comment asserts a browser-cache guarantee the header does not implement · **MED · CONFIRMED (mismatch)**

`app/api/prices/route.ts:181-188`:

```ts
'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
'CDN-Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
// Browser MUST NOT cache (per-user data changes constantly).
'Vary': 'Accept-Encoding',
```

`Vary: Accept-Encoding` is a cache-key directive; it does not prevent storage. The policy sets
`public` — which *authorises* private caches to store — and supplies `s-maxage` (shared caches only)
with **no `max-age`**, leaving browser freshness to heuristics. To express the stated intent you need
`max-age=0` or `private, no-cache` alongside the shared directive.

**CONFIRMED:** the comment states a guarantee the header does not make.
**PLAUSIBLE:** the stale-render consequence — with no `Last-Modified` or `Expires`, heuristic
freshness in most browsers computes to ~0, so the practical impact is likely small. Recorded because
the *comment* is the defect: it will be read by the next engineer as an assurance, on the platform's
highest-traffic quote endpoint.

---

# 3 · The `app/api` ↔ `lib` seam

The seam is in better shape than the file sizes suggest. `app/api/backtest/live/route.ts` already
delegates to `lib/backtest/liveSignal.ts:buildLiveInstrumentSignal`; most routes are genuinely thin.
Only two are worth extracting, and their value is very unequal.

### `Q110-P12` — Three vendor adapters and the platform's best retry policy live inside one route file · **MED-HIGH · CONFIRMED · highest-value extraction**

`app/api/crypto/btc/route.ts` (339 lines) contains `fetchCoinGeckoOhlc` (`:75`), `fetchCoinbaseOhlc`
(`:130`) and `fetchKrakenOhlc` (`:183`) — three vendor adapters with per-vendor interval mapping and
response shapes — plus `fetchWithTimeout` (`:25`), the correct retry policy from `Q110-P4`.

`lib/data/providers/` already exists and is where these belong. The extraction is worth doing
**because of what is trapped with them**: moving `fetchWithTimeout` to `lib/api/reliability.ts`
upgrades all 14 Yahoo call sites at once. That is the single highest-leverage change in this report.

### `Q110-P13` — `buildAnalysis` is 103 lines of quantitative logic that cannot be unit-tested · **MED · CONFIRMED**

`app/api/darkpool/[ticker]/route.ts:77-179` computes off-exchange percentage, short float, and
days-to-cover. It is pure apart from `new Date()` and a `console.warn`. It is **not exported**, so
it is unreachable from any test — the only way to exercise it is through an HTTP handler that first
makes two Yahoo calls.

CLAUDE.md: *"Pure functions for anything quantitative. Side effects at the edges only"* and *"Every
quantitative function carries a docstring citing the paper or standard it implements."* This is a
quantitative function at the edge with no citation and no reachable test.

`safeNum` at `:72` is also a fifth numeric-coercion helper alongside `lib/api/sanitize.ts:70 num`,
though the differing contracts (`number | null` vs `number`) are defensible.

### `Q110-P14` — `withTimeout` duplicated for a parameter the SSOT already has · **LOW-MED · CONFIRMED**

`app/api/briefs/route.ts:76-85` reimplements `lib/api/reliability.ts:71-79`. The only functional
difference is a `label` in the rejection message — and `RetryOptions.retryLabel`
(`reliability.ts:6`) already exists for exactly that. Pure drift, and the cheapest fix in the report.

---

# 5 · Failure modes at the seams

Consolidating what the routes do when a dependency fails:

| Dependency down | Behaviour | Honest? |
|---|---|---|
| ML sidecar | `app/api/ml/[ticker]/route.ts:42, :47` → `{ available: false, symbol }` | **Yes — the model to copy.** Explicit, machine-readable, distinguishes "no model" from "bad request" |
| TradingAgents | `app/api/trading-agents/[ticker]/route.ts:136-139` → `backend_unreachable` 502; base URL never echoed | **Yes** |
| Bloomberg bridge | `app/api/prices/route.ts:119-127` → captured as a structured outcome; `bloombergStatus: 'degraded'` in the payload | **Yes** — the `.catch(() => null)` was already removed (F4.1) |
| GARCH / HMM sidecar | 200 with a labelled fallback — then CDN-cached for up to 3 days as if it were the model | **No** — `Q110-P10` |
| Yahoo (search) | 200 with an empty result set | **No** — `Q110-P3` |
| Yahoo (429) | retried within 200 ms, no classification | **Questionable** — `Q110-P4` |
| SQLite unavailable | `lib/data/warehouse.ts:38-40` returns `null` → silent fallback to JSON, payload still says `'local'` | **No** — `Q110-P6` |

Two of the seven fail dishonestly and one is questionable. **The good patterns are already in the
tree** — `ml`'s `{available:false}` and `prices`' `bloombergStatus` are both exactly right. The gap
is that neither was generalised into the contract; each route re-decides.

### `Q110-P15` — `isWarehouseAvailable()` creates the database it is asked about · **LOW-MED · CONFIRMED**

`lib/data/warehouse.ts:108-110` is `return getDb() !== null`, and `getDb()` at `:35-40` calls
`new Database(DB_PATH)` — which **creates the file if absent** — then runs `createSchema`. A
predicate named `isAvailable` performs a filesystem write and means "can I create a file," not "is
there data here."

**The data path is safe and I want to be clear about that:** an empty database yields
`bars.length > 0 === false` at `lib/backtest/dataLoader.ts:61`, so execution falls through to the
JSON branch. Nothing is served from an empty warehouse.

The defect is the naming and the side effect: every process importing this module leaves a stray
`quantan-warehouse-new.db` in `process.cwd()` (invisible because `.gitignore:56` hides it), and a
reader of `isWarehouseAvailable()` will reasonably infer it means "we have warehouse data" — which
is what makes `Q110-P6`'s mislabel easy to write.

---

# 6 · What a new engineer would get wrong

### `Q110-P16` — The map states the wrong framework major · **MED · CONFIRMED**

| Source | Claims | Actual (`package.json`) |
|---|---|---|
| `AGENTS.md:17` | "built with Next.js 14 + TypeScript" | `next: ^15.5.19` |
| `AGENTS.md:20` | "Next.js 14 App Router" | " |
| `README.md:3` | "Next.js 14 app" | " |
| `README.md:232` | "Next.js 14 (App Router), React 18" | `react: ^19.2.7` |

`AGENTS.md` is one of the five files CLAUDE.md designates as **the map** ("Do NOT re-explore the
codebase from scratch. The files above are the map"). The migration happened — `next.config.js:85`
uses `serverExternalPackages`, the Next 15 spelling of `serverComponentsExternalPackages` — but the
map did not move with it.

**The propagation is already demonstrated, in this session.** The work order that launched this
review opens: *"Next.js 14 App Router on Vercel."* An architecture review was commissioned against a
framework major the repo does not run. CLAUDE.md's own remedy applies: *"If the map is wrong,
repairing the map IS the session."*

**What to verify rather than assume:** Next 14 → 15 changed caching defaults for Route Handlers, and
`Q110-P9`'s findings sit directly on top of that behaviour. I did not confirm the exact semantics
against the installed version, and **nobody should design a caching change off either number until
someone does.** Note that 11 of 28 routes declare `export const dynamic = 'force-dynamic'` and 17 do
not — an inconsistency that is harmless if the current default is dynamic and load-bearing if it is
not. That is the first thing to check.

### `Q110-P17` — A measured baseline floor cites a tool the repo does not have · **LOW-MED · CONFIRMED**

`reviews/invariants-baseline.md:235` records `| Circular imports (madge) | 0 | 0 | 0 |`. **`madge`
is not in `package.json`**, is not installed, and appears in no workflow — `grep -rn madge
package.json .github/` returns only that baseline row.

**The number is correct** — I verified acyclicity independently (see Method). **Its provenance is
absent**, so it is a frozen floor that no artifact can regress against. This is the mildest form of
the tier problem CLAUDE.md describes: a green row nobody can fail.

### `Q110-P18` — Three public endpoints have zero callers · **LOW-MED · CONFIRMED**

Grepping each route's URL across `components/ hooks/ app/ scripts/ __tests__/`:

| Route | Callers | Carries |
|---|---|---|
| `app/api/regime/[ticker]/route.ts` | **0** | rate-limit config, full price history load, Python sidecar dependency, 1 h CDN cache |
| `app/api/conditional-vol/[ticker]/route.ts` | **0** | same, **24 h** CDN cache |
| `app/api/ml/[ticker]/route.ts` | **0** | rate-limit config, ML sidecar dependency |

Three of 28 routes (~11%) are unauthenticated public surface with no consumer. Each is reachable,
each holds a live vendor/sidecar dependency, and each still needs review effort — `Q110-P10` is
entirely about two endpoints nothing calls. Either wire them or delete them; leaving them is
carrying cost and exposure for zero product.

---

# Ranked: the three structural changes with the best value-to-risk ratio

### 1 · Move `fetchWithTimeout` into `lib/api/reliability.ts` as the retry SSOT

**Closes:** `Q110-P4`, the valuable half of `Q110-P12`. **Risk: lowest in the set.**

The better implementation (`app/api/crypto/btc/route.ts:25-59`) is already running in production and
already handles the cases the shared one misses. This is a promotion, not a rewrite. Give
`withRetry` a `classify?: (err, res) => 'retry' | 'fail'` seam so callers keep working unchanged,
default it to the crypto route's policy, and honour `Retry-After`.

Fourteen Yahoo call sites improve without being touched. Extracting the three vendor adapters into
`lib/data/providers/` can follow separately — it is the same PR's natural second half, but the retry
promotion carries the value and should not wait for it.

### 2 · One response contract, enforced by one architecture test over `app/api/**`

**Closes:** `Q110-P3`, `Q110-P7`, and the regime/conditional-vol conflation. **Risk: medium — it is
a breaking change for clients, so it needs a sweep of `components/`/`hooks/` in the same PR.**

Adopt `errorResponse` / `degradedResponse` (`lib/api/reliability.ts:110-127`) everywhere, and assert
three properties mechanically:

- No handler returns a body containing `error` with a 2xx status **unless** `degraded: true` is
  also set. That one rule kills `search:101` and makes `search:150-152` a compile-time-visible gap.
- Every route's failure paths route through the SSOT. State the property as *"no
  `NextResponse.json` literal containing an `error` key outside `lib/api/`."*
- **Learn from `Q110-P2` when writing it: define the visitor as "every file under `app/api/`
  matching `route.ts`", enumerated from disk, never as "every route that already does the thing."**
  Strip comments before matching. That is the fifth reachability shape and it is fresh.

The repo already has the pattern (`__tests__/architecture/`), which is most of why this is cheap.

### 3 · Split identity from vendor spelling: `normalizeTicker` delegates to `canonicalSecurityId`, plus `vendorSymbolFor(id, vendor)`

**Closes:** `Q110-P1`. **Risk: medium — it changes what is sent to Yahoo, so it needs a live probe,
not just a green suite.**

Ship this as two things, because they have different urgency and different risk:

- **The stop-the-bleeding fix, ~2 lines, today.** Canonicalise both sides of the comparison at
  `app/api/backtest/live/route.ts:90` and the equivalent in `app/api/backtest/route.ts:133-137`.
  Ends the silent drop with no change to any outbound vendor call.
- **The architecture decision, as a dated ADR.** `normalizeTicker` currently computes identity *and*
  produces the vendor symbol, and those must differ — the I6 SSOT canonicalises to `BRK.B` while
  Yahoo wants `BRK-B`. Introduce `vendorSymbolFor(id, 'yahoo')` and make identity the thing that
  keys caches, warehouse rows and comparisons. **What would make this wrong later:** if a real
  permanent identifier (FIGI/PermID) is ever licensed, `SecurityId` becomes a vendor-independent key
  and `vendorSymbolFor` becomes a mapping-table lookup rather than a string rule — the interface
  survives, the implementation does not. Design the signature so that substitution is a body change.

---

# Explicitly NOT worth fixing

- **A blanket zod migration across 28 routes.** High churn, touches every handler, and 23 of them
  already validate correctly by hand. The value is concentrated in five `any`-typed vendor mappings
  (`prices:142`, `chart:205,211`, `ma-deviation:80,97`). **Do one of two things and record which:**
  adopt zod at the vendor boundary only, *or* strike the clause from HOUSE STYLE the way "lint
  clean" was struck. Leaving a rule that names an absent library at every boundary it does not guard
  is the false-confidence failure CLAUDE.md already diagnosed once.
- **Unifying the 12 `Cache-Control` policies into a table.** The *values* are mostly defensible for
  their data (3 s quotes, 1 h backtests). What is missing is the **staleness contract** — a declared
  max age the UI can read (`Q110-P9`) — and `Q110-P10`'s provenance-dependent policy. Fix those two;
  normalising the rest is taste.
- **`safeNum` vs `num`** (`darkpool:72` vs `sanitize:70`). Different return contracts
  (`number | null` vs `number`) serving different needs. Consolidating would force one caller into
  the wrong semantics. Not a finding.
- **The remaining route-local helpers.** `briefs`' `fetchNewsForTicker` (`:86`) is I/O glue with no
  reusable core, and the `stream` locals are SSE plumbing that belongs with its route. Only
  `Q110-P12` and `Q110-P13` are worth moving; extracting the rest is motion.
- **Middleware running on `/api/*` to attach a script-`nonce` CSP to JSON responses**
  (`middleware.ts:51-116`, matcher `:119`). Wasteful and slightly confusing, but harmless. The
  known middleware finding (auth coverage) is the one that matters.
- **The 17 routes without `export const dynamic`.** Currently correct. Revisit only as part of
  `Q110-P16`'s version verification — the answer depends on the framework major, which the map
  currently gets wrong.

---

# Checked and clear — negative results, recorded so nobody re-derives them

Stated because CLAUDE.md's audit lesson is that *"confirmed" is where auditors get lazy*, and an
all-clear is worth as much as a finding when it stops a future session re-walking the ground.

| Checked | Result |
|---|---|
| `lib/quant` → `lib/data` / `app/` | **0 edges.** Pure core is pure |
| `lib/**` → `components/` / `hooks/` | **0 edges** |
| Circular imports | **0** (my tool's 1 was a comment artifact — see Method) |
| God-file / hub | None. Top fan-in is the declared indicator SSOT |
| `better-sqlite3` missing from `serverExternalPackages` | **Non-finding.** It is in Next's built-in default list (`node_modules/next/dist/lib/server-external-packages.json`) |
| `_chartCache` unbounded growth via unvalidated `range` | **Non-finding.** Eviction at `chart/route.ts:18-25`, cap 500 |
| `clamp(parseFloat(...))` NaN handling in the DCF | **Non-finding** for NaN — `fundamentals:171` returns `lo`. *But note:* `?wacc=abc` silently yields the **lowest** discount rate, i.e. the most flattering valuation, with no signal that input was rejected. Worth a 400. LOW |
| Rate limiting coverage | **27 of 28 routes.** Only `auth/[...nextauth]` is exempt, which is correct |
| Silent `try/catch {}` | **None.** The two empty catches (`stream:203`, `stream/[ticker]:130`) are deliberate `controller.close()` guards |
| `any` usage | **9 occurrences**, confined to the Yahoo response boundary — precisely where `Q110-P8` says a schema belongs |
| Route → route, route → component imports | **0** |
| `/api/stream` 9-min vs 300 s soft close | **Fixed.** `lib/api/streamBudget.ts` derives it with a 30 s lead and a test pins the literal. The system prompt's "known live defect" is stale — this is the SSOT `Q110-P5` says trading-agents should have used |

---

**Handoff note for the lead:** `Q110-P2` and `Q110-P16` both contradict statements currently in
`CLAUDE.md` (I2's cache clause recorded as CLOSED; the platform major). Per the tier rules, each
comes with the artifact: for P2 the three unflagged serve-from-cache line numbers plus the guard's
producer predicate at `cache-flag-consumed.test.ts:55-56`; for P16 the `package.json` version against
`AGENTS.md:17`. `Q110-P5`'s dead-code half and `Q110-P4`'s amplification half are the two claims in
this report that need something I could not read from the repo — the Vercel plan default and
`yahoo-finance2`'s 429 behaviour respectively. Both findings stand without them; neither should be
written into the ledger as CONFIRMED until someone checks.
