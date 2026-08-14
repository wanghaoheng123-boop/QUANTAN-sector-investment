# QUANTAN Platform Excellence — Wave 1 REVIEW
## Data / API / Freshness review — 2026-08-15

Reviewer: senior data-platform reviewer (read-only pass; no source edits, no commits).
Prod probed live (read-only GETs) at `https://quantan.vercel.app`.
Repo worktree: `.claude/worktrees/sweet-dubinsky-4e07b2` @ `b3773b6`.

Severity key: **P0** wrong/misleading data reaching a trading decision · **P1** materially
stale, fragile or inaccurate · **P2** correctness/robustness debt · **P3** polish.

> Status: **COMPLETE** — 17 entries across all five scope areas:
> **2 × P0** (DQ-1, DQ-7) · **8 × P1** (DQ-2, 3, 4, 5, 8, 9, 12, 14) ·
> **4 × P2** (DQ-6, 10, 11, 15) · **2 × P3** (DQ-13, 16) · **1 clean-record** (DQ-17).
> See TOP 10 BY YIELD and CADENCE MAP at the end.
>
> Headline: two P0s reach a trading decision — `/api/backtest/live` serves 90 %-confidence
> BUY/SELL signals on data up to **5 trading sessions old** while telling the user "Live data
> refreshes every 60s" (DQ-7), and the dashboard's **LIVE** pill never turns off after the
> closing bell (DQ-1). Separately, the Yahoo `SearchResult` schema-drift fix that ended the
> 3-month news outage missed one call site, and global free-text search has been silently
> returning zero results ever since (DQ-8) — proven by A/B probe against prod.

---

## FINDINGS

### DQ-1 — `useLiveQuotes.marketOpen` is a one-way latch: the dashboard says "market open" forever after the close — P0

**Evidence** — `hooks/useLiveQuotes.ts:96,184,190-201`

```ts
const [marketOpen, setMarketOpen] = useState(false)          // :96
...
if (data.marketOpen) setMarketOpen(true)                     // :184  quote handler
...
es.addEventListener('market_state', (evt) => {
  const data = JSON.parse(...) as { open: boolean }
  if (data.open === true) setMarketOpen(true)                // :194
  // Note: we do NOT set marketOpen=false here because OTHER tickers may
  // still report marketOpen=true (24x7 futures, crypto)...               // :195-197
})
```

There is **no code path anywhere in the hook that sets `marketOpen` back to `false`.** The
server (`app/api/stream/route.ts:236-241`) explicitly detects the open→closed transition and
emits `market_state {open:false}` for exactly this purpose; the client throws it away.

**The justification in the comment does not hold for this route.** It was carried over from
the per-ticker fan-out. The multiplexed route computes **one** `isMarketOpen()` per tick
(`app/api/stream/route.ts:115,228,237`) and stamps that *same scalar* onto every quote in the
batch and onto the single aggregated `market_state`. There is no per-ticker variation to
protect — the multiplex route has no crypto/futures symbols with an independent calendar
(crypto lives on `/api/crypto/btc/*`, an entirely separate path).

**Impact.** A trader who leaves the dashboard open across 16:00 ET — the single most common
usage pattern for a sector desk — keeps seeing a "market open / live" affordance while the
tape is closed. Every downstream consumer of `marketOpen` is wrong from the closing bell until
the page is hard-reloaded. Worse, it is *silently* wrong: the poll loop stops fetching after
the close (`route.ts:242 if (!open) return`), so the last quote freezes on screen **with the
open indicator still lit**. This is the textbook "stale mistaken for live" failure the mandate
targets, on the platform's primary surface.

**Fix.** Make `market_state` authoritative for this hook — it is a single aggregated scalar
by construction:
```ts
es.addEventListener('market_state', (evt) => {
  const data = JSON.parse((evt as MessageEvent).data) as { open?: unknown }
  if (typeof data.open === 'boolean') setMarketOpen(data.open)
})
```
and in the `quote` handler set from the payload rather than latching
(`setMarketOpen(data.marketOpen)`). Add a regression test asserting a
`market_state{open:false}` after a `market_state{open:true}` flips the returned flag.
If a future multi-calendar subscription is ever added, reduce over the *current* batch rather
than reintroducing a latch.

**Effort** S · **Confidence** High (source-verified; the server-side transition emitter exists
and is provably ignored).

---

### DQ-2 — the multiplexed stream drops `degraded` and has no error channel; a dead quote feed renders as a healthy one — P1

**Evidence** — server emits it, client never listens.

- Server: `app/api/stream/route.ts:218-222` emits `event: degraded` with
  `code:'initial_quote_unavailable'` when the initial batch fetch returns empty.
- Server: `app/api/stream/route.ts:134-139` — `fetchQuotes` **never throws**; on upstream
  failure it logs and returns `[]`.
- Client: `hooks/useLiveQuotes.ts` registers listeners for `quote`, `market_state`,
  `closing_soon`, `close` (:175, :190, :205, :225) — **no `degraded` listener**, and
  `UseLiveQuotesResult` (:62-79) has **no `error` field**.
- Contrast: the *singular* hook `hooks/useLiveQuote.ts:217-224` does handle `degraded` and does
  expose `error: string | null` (:99). The multiplex rewrite lost both.

**Impact.** Two silent-failure modes on the dashboard:

1. *Initial* batch fails → server emits `degraded`, client ignores it. `es.onopen` has already
   fired, so `connections` is all-`true`. The UI reports a healthy connection with no prices,
   or with prices from a previous mount.
2. *Steady-state* batch fails → `fetchQuotes` returns `[]`, the route emits **nothing at all**
   (the poll loop at :243-247 simply iterates an empty array). The last good quote stays
   pinned on screen indefinitely, connection green, with no signal that the upstream stopped
   answering. A Yahoo outage is indistinguishable from a flat tape.

**Fix.** (a) Add a `degraded` listener to `useLiveQuotes` and surface `error: string | null`
on the result, matching the singular hook's contract. (b) Make the steady-state failure
observable: emit `degraded` from the poll tick when `batch.length === 0` while
`isMarketOpen()` is true (throttled, e.g. only on the transition into failure). (c) Have
consumers render the existing "Quote feed degraded" affordance — `app/desk/page.tsx:169`
already has one wired to a different source.

**Effort** S (a+c) / M (b) · **Confidence** High.

---

### DQ-3 — the SSE `quote.timestamp` is the *server fetch* time, not the quote's as-of time; freshness UI reads "Live" on a stale print — P1

**Evidence** — `app/api/stream/route.ts:116,123-131`

```ts
const timestamp = new Date().toISOString()      // :116  — wall clock, per tick
...
out.push({ ticker: symbol, price, ..., marketOpen, timestamp })   // :123-131
```

Yahoo's own `regularMarketTime` — the field that says *when this print happened* — is not read
by the stream route at all. Compare `app/api/prices/route.ts:31-36,168` which does exactly
that and ships an honest `quoteTime`:

```ts
function isoQuoteTime(q) { ... new Date(t*1000).toISOString() ... }   // prices route
```
Prod probe confirms the two paths disagree in kind:
```
/api/prices?tickers=AAPL → "quoteTime":"2026-08-14T16:04:44.000Z"   (Yahoo print time)
                            "timestamp":"2026-08-14T16:04:45.965Z"  (our fetch time)
```

**Impact — verified wiring.** I traced every consumer rather than assuming:

- `DataFreshnessIndicator` is **not** currently fed the stream's timestamp. On the desk page it
  gets `useLivePrices`' `quoteTime` (`app/desk/page.tsx:163`) and on the sector page
  `quote.quoteTime` from `/api/prices` (`app/sector/[slug]/page.tsx:346`) — both the honest
  Yahoo print time. **That path is clean today.**
- The stream's fetch-time **does** reach the UI by another route. `app/page.tsx:145` merges each
  live tick as `quoteTime: q.timestamp` — writing the transport stamp into a field whose meaning
  everywhere else in the codebase is "Yahoo print time". That flows into
  `buildSignalRow` (`lib/sessionSignalsFromQuotes.ts:49`) and is rendered by
  `components/SignalCard.tsx:159-161` as **`Quote {formatFreshness(signal.quoteTime)}`**. Since
  `formatFreshness` returns `'live'` for anything under 30 s (`lib/format.ts:56`), every signal
  card reads **"Quote live"** by construction on every tick — regardless of how old the print is.

So the defect is real and user-visible, but through `SignalCard`, not `DataFreshnessIndicator`.
It bites in three routine situations: (a) thinly-traded symbols whose last print is minutes old
during RTH; (b) the initial unconditional batch outside market hours (`route.ts:208-223`) — on a
Saturday the client receives Friday's close stamped with Saturday's wall clock and labelled
"live"; (c) market holidays, where `isMarketOpen()` returns true (DQ-4) and the route re-emits
the same stale close every 15 s with a fresh timestamp forever.

The wider risk is the **name collision**: `quoteTime` now means two different things depending on
which path populated it, so any future freshness UI wired to it inherits the bug silently.

**Fix.** Carry Yahoo's `regularMarketTime` through the stream payload as a distinct field
(e.g. `quoteTime`), keep `timestamp` as the transport stamp, and point
`DataFreshnessIndicator` at `quoteTime`. Reuse `isoQuoteTime` from the prices route — promote
it to `lib/yahooQuoteFields.ts` so both paths share one implementation. Widen `parseLiveQuote`
(`hooks/useLiveQuote.ts:68-84`) to accept and validate the new field, tolerating absence.

**Effort** M · **Confidence** High.

---

### DQ-4 — `isMarketOpen()` has no holiday calendar; on ~13 sessions/year the platform claims the market is open and streams a frozen tape — P1

**Evidence** — `lib/api/marketHours.ts:53-65`

```ts
/**
 * True if NYSE/NASDAQ regular session is currently open.
 * Does NOT account for half-day holidays or full-market closures (Christmas,
 * Thanksgiving, etc.) — use a calendar API for precise scheduling.
 */
export function isMarketOpen(now = new Date()): boolean {
  const t = nyMarketTime(now)
  if (t.weekday === 'Sat' || t.weekday === 'Sun') return false
  ...
}
```

The DST bug is properly fixed (Intl + `America/New_York`) — that part is sound. The gap is the
calendar: weekday + clock only. There are ~10 full closures and ~3 early closes (13:00 ET) a
year.

**Impact.** `isMarketOpen()` is load-bearing across the live path — it gates the SSE poll loop
(`app/api/stream/route.ts:242`, `app/api/stream/[ticker]/route.ts`), the aggregated
`market_state`, and each quote's `marketOpen` flag. On Thanksgiving or Christmas the platform
polls Yahoo every 15 s, re-emits the *previous session's close* with a fresh timestamp
(compounding DQ-3), and tells every client the market is open. On the ~3 early-close days the
same happens for the 13:00–16:00 ET window. That is 13 sessions a year on which the primary
freshness signal is affirmatively wrong, plus the wasted upstream calls.

**Fix.** A static holiday table is enough and needs no network dependency: NYSE publishes the
calendar years ahead, and the rules are deterministic (New Year's, MLK, Presidents', Good
Friday, Memorial, Juneteenth, July 4, Labor, Thanksgiving, Christmas + the observed-shift rule
for weekend-falling fixed dates). Add `lib/api/marketCalendar.ts` with the closures and the
early-close set through, say, 2030, have `isMarketOpen` consult it, and add a
`nextSessionOpen`/`sessionStatus` helper so the UI can render "Closed — holiday" rather than
just "Closed". Pin with unit tests on known dates (2026-11-26 Thanksgiving closed,
2026-11-27 early close at 13:00 ET). Refresh the table in the same Sunday cron that already
refreshes fixtures.

**Effort** M · **Confidence** High (behaviour is documented in the file's own comment).

---

### DQ-5 — `changePct` has two different derivations on the same dashboard; only one is unit-normalized — P1

**Evidence**

- `app/api/prices/route.ts:160-164` runs the normalizer:
  ```ts
  changePct: normalizedChangePercent(q.regularMarketChangePercent,
                                     q.regularMarketChange, q.regularMarketPrice),
  ```
- `app/api/stream/route.ts:127` takes the raw field:
  ```ts
  changePct: finite(row.regularMarketChangePercent) ?? 0,
  ```

`lib/yahooQuoteFields.ts:1-14` documents *why* the normalizer exists — Yahoo "occasionally
returns the percent change in decimal form (e.g. 0.016 meaning 1.6%) rather than percent form
(1.6)" — and implements a principled disambiguation against an independently implied
`(change/price)*100`. The stream route re-derives the same user-visible number **without** it,
even though it already has `regularMarketChange` and `regularMarketPrice` in hand
(`route.ts:121,126`) — the two inputs the normalizer needs.

**Impact.** When Yahoo serves the decimal form for a symbol, the polled surface
(`/api/prices` → `hooks/useLivePrices.ts`) shows `+1.6%` while the streamed surface
(`/api/stream` → `useLiveQuotes`) shows `+0.016%` — a 100× understatement of the day's move,
on the same page, with no error raised. Directionally correct but magnitude-wrong percentages
are precisely the class of defect that survives eyeballing and corrupts a rotation call. Note
the platform *already paid* for this bug once (the normalizer is remediation, not
speculation), and the multiplex route reintroduced the unguarded path on 2026-08-14.

**Fix.** One line in the stream route:
```ts
changePct: normalizedChangePercent(row.regularMarketChangePercent as number|null,
                                   row.regularMarketChange as number|null,
                                   row.regularMarketPrice as number|null),
```
Then add a shared-invariant test asserting `/api/prices` and `/api/stream` produce identical
`changePct` for the same raw Yahoo row — this is exactly the kind of two-path drift a golden
fixture pins cheaply. Also audit `app/api/stream/[ticker]/route.ts` for the same pattern.

**Effort** S · **Confidence** High.

---

### DQ-6 — `SectorRotationPanel`'s freshness label is computed once and then frozen; it under-states the true cache window by up to 3× — P2

**Evidence — probe.** `/api/sector-rotation` is CDN-cached and served stale:

```
$ curl -D- https://quantan.vercel.app/api/sector-rotation      (3 calls, 2s apart)
age: 89 / 92 / 94        x-vercel-cache: HIT / HIT / HIT
"fetchedAt":"2026-08-14T16:04:44.868Z"   ← identical across all three
cache-control: public, max-age=0, must-revalidate   ← Vercel's browser-facing rewrite
```
The route sets `'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200'`
(`app/api/sector-rotation/route.ts:97`), so the CDN may serve a **1 h fresh + 2 h
stale-while-revalidate = up to 3 h old** response.

**Evidence — client.** `components/SectorRotationPanel.tsx:48-61,158-160`

```tsx
useEffect(() => { ...fetch('/api/sector-rotation')... }, [])   // fires once, never refetches
...
<p>Updated: {formatFreshness(data.fetchedAt)} · 1-hour cache</p>
```

`formatFreshness` (`lib/format.ts:51-62`) computes `Date.now() - ts` **at render time**. The
component has no interval and no other state churn, so it renders once when the fetch resolves
and the string is never recomputed. A panel that read "live" at 09:31 still reads "live" at
13:00.

**Impact.** Two compounding under-statements of age on a panel whose entire output is an
OVERWEIGHT/UNDERWEIGHT allocation call:
1. the label is frozen at mount, so elapsed viewing time is invisible; and
2. the disclosed window ("1-hour cache") is the `s-maxage`, not the `s-maxage + SWR` bound the
   CDN actually serves — the honest figure is "up to 3 h".

Credit where due: the panel *does* disclose a cache and *does* render `fetchedAt` — better
than most surfaces here. The defect is that both numbers are optimistic.

**Fix.** (a) Tick the label: `useState`/`setInterval` at 30 s, or reuse
`DataFreshnessIndicator` which already self-ticks (`components/DataFreshnessIndicator.tsx:31-36`).
(b) Correct the copy to the real bound (`· cached up to 3h`), or tighten the route to
`s-maxage=900, stale-while-revalidate=900` and say "up to 30 min". (c) Refetch on an interval
or on tab re-focus so a long-lived dashboard converges. See the CADENCE MAP for the
recommended target.

**Effort** S · **Confidence** High (probe-confirmed).

---

### DQ-7 — `/api/backtest/live` serves BUY/SELL signals at up to 90% confidence on data up to 5 trading sessions old, and the UI calls it "Live data refreshes every 60s" — P0

**This is the highest-yield finding in the review.** Live prod probe, 2026-08-14:

```
$ curl 'https://quantan.vercel.app/api/backtest/live'
{
  "computedAt": "2026-08-14T16:14:21.427Z",     ← now
  "dataSource": "local",
  "instruments": [ {
      "ticker": "NEE", "price": 84.6500015258789,
      "zone": "FIRST_DIP", "dipSignal": "STRONG_DIP",
      "rsi14": 34.89, "atr14": 1.869, "macdHist": -0.492, "bbPctB": -0.029,
      "action": "BUY", "confidence": 90, "KellyFraction": 0.15,
      "lastDate": "2026-08-07"                  ← the data's real as-of: 5 sessions earlier
  }, ... ]
}
```

**Why it is stale.** `app/api/backtest/live/route.ts:37` calls `loadStockHistory(ticker)`,
which reads the **weekly** fixture in `scripts/backtestData/` (`lib/backtest/dataLoader.ts:29-47`,
warehouse-first then JSON). Those fixtures are refreshed by `.github/workflows/refresh-data.yml`
on `cron: '0 22 * * 0'` — **Sunday** 22:00 UTC (note: the program brief says "Saturday"; the
repo says Sunday — the workflow is healthy and has landed 5 consecutive weeks:
`0c25245 2026-08-09`, `a12ff7d 2026-08-02`, `84ec79a 2026-07-26`, `0e4f9de 2026-07-19`,
`a461fce 2026-07-12`). So through the whole trading week the newest bar is the **previous
Friday's close**. By Friday afternoon — when the probe above ran — the signal is 5 sessions old.

**Why it is misleading.** `components/backtest/LiveSignalsPanel.tsx:209-213`:

```tsx
Data as of: <span>{latestDataDate}</span> · Live data refreshes every 60s
```

The panel computes `latestDataDate` honestly from `max(lastDate)` (:72-73) — genuine credit —
and then, **in the same sentence**, asserts "Live data refreshes every 60s". The 60 s is
`CACHE_TTL_MS` (`route.ts:21`), the in-memory TTL of a route whose *underlying data* moves
weekly. A trader reading that line is told the number next to it is a minute old. The false
half of the sentence is the reassuring half, and it sits directly beside the true half, which
is what makes this worse than no disclosure at all.

**Impact.** Every field on this panel is a week-stale derived quantity presented as actionable:
`price`, `changePct`, `rsi14`, `atr14`, `macdHist`, `bbPctB`, `deviationPct`, `zone`,
`dipSignal`, `action`, `confidence` (90), and `KellyFraction` (0.15 — an explicit position-size
recommendation). A `STRONG_DIP`/`BUY` on last Friday's RSI of 34.9 may have fully reverted; the
route re-serves it as current, and the aggregate rolls up into the panel's headline
"BULL REGIME / BEAR REGIME" verdict (:88-108) and its RSI-breadth oversold/overbought counts
(:113-115). This is precisely "wrong data reaching a trading decision".

**Fix.**
1. *Immediate, free:* correct the copy. `Data as of {latestDataDate} · end-of-week fixture,
   refreshed Sundays`. Delete "Live data refreshes every 60s". Rename the route or its UI label
   away from "Live" — the word is doing the damage.
2. *Immediate, free:* surface staleness as a state, not a footnote. Compute trading-days since
   `latestDataDate` and render an amber/red banner past 1 session — the platform already owns
   `DataFreshnessIndicator` and `formatFreshness` for exactly this.
3. *Real fix (see CADENCE MAP):* the fixture cadence is the root cause. Move the refresh to
   **daily after the US close** (`0 22 * * 1-5`) so the worst case is 1 session, not 5. Cost is
   ~5× the current GitHub Actions minutes on a job that already runs unattended — small. Risk is
   5× the commit churn on `scripts/backtestData/`; mitigate by writing to the SQLite warehouse
   (`lib/data/warehouse.ts`, already the preferred source in `loadStockHistory`) instead of
   committing JSON.
4. *Best:* for the live-signal path specifically, overlay today's quote from the same Yahoo
   `quote()` call `/api/prices` already makes, so the last bar is current even between fixture
   refreshes. Recompute the indicators on `fixture ∪ {today}`.

**Effort** S (1+2) / M (3) / L (4) · **Confidence** High (probe-confirmed end to end).

---

### DQ-8 — `/api/search` is the one `yf.search()` call site the schema-drift fix missed; free-text search returns zero results — P1

**This is the 2026 news outage recurring verbatim, in the route the remediation commit did not touch.**

**Evidence — the fix's own scope.** `git show --stat 72f42fc` ("fix(news): tolerate Yahoo
SearchResult schema drift (validateResult:false)") touched exactly four files:
```
app/api/briefs/[sector]/route.ts | app/api/briefs/route.ts
app/api/news/[sector]/route.ts   | app/api/news/ticker/[ticker]/route.ts
```
`app/api/search/route.ts` was not among them, and it is the **only remaining unguarded
`yf.search()` call in the repo**:
```ts
// app/api/search/route.ts:126  — no third argument
const result = await yahooFinance.search(q, { newsCount: 0, quotesCount: limit })
```
vs. every other site, e.g. `app/api/briefs/route.ts:92`:
```ts
yahooFinance.search(ticker, { newsCount: 5 }, { validateResult: false })
```

**Evidence — controlled A/B probe against prod.** Yahoo's search API is *healthy right now*;
only the unguarded caller fails:

| endpoint | guard | prod result |
|---|---|---|
| `/api/briefs` | `validateResult:false` | real, current headlines ("Market Chatter: Apple Developing AI Model…", MT Newswires) |
| `/api/search?q=Broadcom` | none | `{"quotes":[]}` |
| `/api/search?q=bank` | none | `{"quotes":[]}` |
| `/api/search?q=semiconductor` | none | `{"quotes":[]}` |
| `/api/search?q=Johnson` | none | `{"quotes":[]}` |
| `/api/search?q=energy` | none | `{"quotes":[]}` |

Same library, same process, same upstream, one argument apart. Every query that *does* return
something is explained by a **fallback path, not by `search()`**:
- `AAPL`, `NVDA` → `looksLikeTickerToken` → `resolveDirectQuote` (:148-155)
- `apple`, `Microsoft`, `Nvidia`, `Tesla` → the **7-entry hardcoded** `COMPANY_NAME_HINTS`
  (:43-51) → `resolveDirectQuote` (:142-146)

`q=Microsoft` returning `[{symbol:"MICROSOFT", exchange:"YHD", typeDisp:"MUTUALFUND"}, {MSFT}]`
is the tell: that first row can only come from `quote("MICROSOFT")` — a junk mutual-fund match
promoted to position 1 by the `unshift` at :154 — which is only reachable when `search()`
contributed nothing.

**Why it is silent.** `route.ts:138-140` catches the drift throw, `console.error`s it, and falls
through. The handler then returns a well-formed `{"quotes":[]}` with HTTP 200. To the UI
(`components/GlobalSearch.tsx`) and to any monitor watching status codes, "Yahoo's schema
changed and search is dead" is indistinguishable from "no securities match your query". That is
exactly the property that let the news equivalent run for three months.

**Impact.** Global search — the platform's primary instrument-discovery surface — resolves only
exact ticker symbols and seven hardcoded mega-caps. A user who types a company name, a sector
theme, or a partial name gets a confident empty state.

**On duration — stated precisely.** The *current* failure is probe-confirmed; I have **not**
established how long it has been failing, and the finding does not depend on it. What the
history does establish: `app/api/search/route.ts` was last modified **2026-06-02** (`de9a3d5`),
and the drift fix `72f42fc` landed **2026-07-01** — so this route has carried an unguarded
`search()` call since at least the day the rest of the codebase was hardened, ~6 weeks ago.
Whether Yahoo's schema was drifting continuously across that window is unknown and untestable
from here. Treat "unguarded since 2026-07-01, failing now" as the claim.

**Fix.** One argument: `yahooFinance.search(q, { newsCount: 0, quotesCount: limit }, { validateResult: false })`,
plus the `as { quotes?: unknown[] }` cast and the row guards already present at :129-135 (they
are written defensively enough to survive an untyped result — this route is *ready* for the
guard). Then close the class rather than the instance:
- add a lint rule or a unit test that asserts **every** `yahooFinance.search(` /
  `.quoteSummary(` call site passes `validateResult: false`;
- make silent-empty loud: when `search()` throws, return a `degraded` marker in the envelope
  (or a distinct `error` code) instead of a bare `{quotes: []}`, so the failure is
  distinguishable from a genuine no-match;
- add a prod smoke assertion (`scripts/smoke-production.mjs` already exists) that
  `/api/search?q=bank` returns ≥1 quote. That single assertion would have caught this on day one.

Also on this route: no `withRetry`/timeout on either Yahoo call, no `sanitizeError`, no
`Cache-Control` (see DQ-12 table).

**Effort** S (fix) / S (guard-rail test) · **Confidence** High (A/B probe against prod).

---

### DQ-9 — `/api/conditional-vol` labels an EWMA proxy as "GARCH(1,1)", serves a flat forecast, and caches it up to 3 days on top of week-old data — P1

**Evidence — prod probe.**
```
$ curl https://quantan.vercel.app/api/conditional-vol/AAPL
{"ticker":"AAPL","model":"GARCH(1,1)",
 "forecast":[{"date":"2026-08-17","conditionalVol":0.3658310177862156},
             ... 20 points, ALL identical to 16 significant figures ...
             {"date":"2026-09-11","conditionalVol":0.3658310177862156}],
 "source":"ewma-fallback"}
cache-control: public, max-age=0, must-revalidate     (CDN: s-maxage=86400, swr=172800)
```

Three compounding problems:

1. **Model mislabelling.** `model` is the hardcoded literal `'GARCH(1,1)'`
   (`lib/quant/garchClient.ts:14`) and is emitted **regardless of which estimator actually
   ran**. In prod `source` is `ewma-fallback`, i.e. `ewmaVolForecast` (:45-79) — RiskMetrics
   EWMA(λ=0.94). The file is admirably honest internally ("EWMA(λ) without a long-term mean is
   mathematically flat in multi-step forecasts (no ω term)… This is *honest* for a pure-EWMA
   proxy", :27-31) but the honesty does not reach the wire: the response asserts GARCH(1,1).
   A GARCH(1,1) term structure mean-reverts toward unconditional variance; a practitioner reads
   the label, expects that shape, and instead gets a horizontal line — and will reasonably
   conclude the *market* implies flat vol rather than that the *model* cannot produce a slope.
2. **Stale inputs.** `route.ts:35` → `loadStockHistory(ticker)` → the same weekly fixture as
   DQ-7. The forecast's newest observation is last Friday's close.
3. **Stale outputs.** `route.ts:42` sets `s-maxage=86400, stale-while-revalidate=172800` — the
   CDN may serve up to **24 h fresh + 48 h stale = 72 h**. Stacked on (2), a displayed
   conditional-volatility forecast can be built on inputs **up to ~9 days old**. Volatility is
   the single fastest-moving quantity on the platform; a 24 h cache on it is the least
   defensible TTL in the API surface (compare `/api/prices` at 3 s).

**Fix.** (a) Emit `model` from what actually ran — `'EWMA(0.94) proxy'` when
`source === 'ewma-fallback'`, `'GARCH(1,1)'` only for the Python sidecar — and have the UI
render the estimator name and a "flat by construction" note for the proxy. (b) Cut the TTL to
`s-maxage=900, stale-while-revalidate=3600` (vol is not a daily quantity). (c) Fold into the
DQ-7 cadence fix so the input series is at most one session old.

**Effort** S (a+b) · **Confidence** High (probe-confirmed).

---

### DQ-10 — `/api/regime` has the same label-vs-estimator gap, cached up to 3 h — P2

**Evidence — prod probe.**
```
$ curl https://quantan.vercel.app/api/regime/AAPL
{"ticker":"AAPL","currentState":"Normal",
 "probabilities":{"Bull":0.175,"Normal":0.65,"Bear":0.175},
 "source":"rule-fallback"}
```
The probability vector is a **constant** — 0.175 / 0.65 / 0.175 carries no ticker-specific
information at all; it is the fallback prior, not an inferred posterior. The route
(`app/api/regime/[ticker]/route.ts:36`) reads the weekly fixture and sets
`s-maxage=3600, stale-while-revalidate=7200` (up to 3 h).

**Impact.** Lower than DQ-9 because `source: 'rule-fallback'` is returned and the state label
("Normal") is at least derived. But a three-decimal probability distribution is the most
authoritative-looking output shape available, and here it is a constant. Any consumer rendering
"Bear 17.5%" is presenting a prior as a measurement.

**Fix.** Same shape as DQ-9: make the *displayed* model name track `source`; when the HMM is
unavailable, return the state without a fabricated-precision probability vector (or round to a
coarse label). Verify the HMM sidecar wiring (`lib/quant/regimeHmmClient.ts`,
`QUANT_FRAMEWORK_URL`) — both this and DQ-9 fall back, so the sidecar is likely unreachable in
prod, which is itself worth an operational alert rather than a silent downgrade.

**Effort** S · **Confidence** High (probe-confirmed); Medium on the sidecar root cause.

---

### DQ-11 — sector-rotation's composite blends a continuous return with a discontinuous ±10 bp step; a one-tick RSI move jumps a sector ~5 ranks — P2

**Evidence** — `lib/quant/sectorRotation.ts:66-77,104`

```ts
export function meanReversionBoost(closes: number[]): number {
  const rsi = rsiLatest(closes, 14)
  if (rsi == null) return 0
  if (rsi < 30) return  0.10
  if (rsi < 40) return  0.05
  if (rsi > 80) return -0.10
  if (rsi > 70) return -0.05
  return 0
}
...
const composite = 0.6 * momentum + 0.4 * meanReversion   // :104
```

Prod probe (2026-08-14) — the observed composite distribution across all 11 sectors spans
**−0.0098 (XLC, rank 11) to +0.1123 (XLK, rank 1)**, and `meanReversion` is **0 for 11 of 11**.

**Impact.** Two coupled defects on an OVERWEIGHT/UNDERWEIGHT allocation signal:
- *Dead most of the time.* Whenever RSI(14) ∈ [40, 70] — the common case, and empirically the
  case for every sector right now — `meanReversion` is 0 and `composite` is just
  `0.6 × momentum`, a monotone rescaling of momentum. The rank order is therefore **pure
  momentum**, while the UI legend (`components/SectorRotationPanel.tsx:153-155`) tells the user
  "Composite = 0.6 × momentum (3/6/12mo) + 0.4 × RSI mean-reversion". The advertised second
  factor contributes nothing.
- *Then a cliff.* When it does fire it fires as a step. RSI crossing 30 adds `0.4 × 0.10 = 0.04`
  to composite — against the observed 0.122-wide spread, that is roughly **a third of the entire
  cross-sectional range**, enough to lift a bottom-ranked sector past ~5 peers in a single
  session. RSI 30.01 → 29.99 flips UNDERWEIGHT toward OVERWEIGHT with no intermediate state.
  The 40/70 boundaries have the same 0.02 discontinuity.

Note this is *not* the same as "all zeros is a bug" — all-zeros is a legitimate reading of a
calm tape. The defect is the shape of the function and the gap between it and the disclosed
formula.

**Fix.** Replace the step with a continuous, scale-matched transform, e.g.
`meanReversion = k · (50 − rsi)/50` clipped to ±0.10, with `k` calibrated so the factor's
cross-sectional standard deviation is comparable to momentum's rather than ~3× its range. Then
either (a) backtest the two-factor composite against momentum-only and keep it only if it earns
its weight, or (b) drop the factor and correct the legend. Given the program's existing
backtest harness, (a) is cheap and is the right call before shipping a formula change.

**Effort** M (includes the backtest) · **Confidence** High on the mechanism (probe + source).

---

### DQ-12 — cross-cutting invariant table: three routes lack any upstream timeout, and `/api/news/*` runs 5 serial un-timed Yahoo calls — P1

Rather than 25 separate write-ups, here is the whole API surface measured against the platform's
own conventions. `RL` = `applyRateLimit`, `SAN` = `sanitizeError`/`errorResponse`,
`NT` = `normalizeTicker`, `WR` = `withRetry`, `TO` = any timeout (`withTimeout`/`timeoutMs`/`AbortSignal.timeout`).

| route | RL | SAN | NT | WR | TO | Cache-Control |
|---|---|---|---|---|---|---|
| `analytics/[ticker]` | ✓ | ✓ | ✓ | ✓ | ✓ | `s-maxage=300, swr=600` |
| `backtest/live` | ✓ | – | ✓ | – | – | `s-maxage=60, swr=120` |
| `backtest` | ✓ | ✓ | ✓ | – | – | `s-maxage=3600, swr=7200` |
| `bloomberg-bridge/health` | ✓ | – | – | – | – | – |
| `briefs/[sector]` | ✓ | **–** | – | – | **–** | `s-maxage=60, swr=300` |
| `briefs` | ✓ | ✓ | – | – | ✓ | – |
| `chart/[ticker]` | ✓ | ✓ | ✓ | ✓ | ✓ | `public, max-age=30, swr=60` |
| `conditional-vol/[ticker]` | ✓ | ✓ | ✓ | – | – | `s-maxage=86400, swr=172800` ← DQ-9 |
| `crypto/btc/*` (4) | ✓ | ✓ | – | – | ✓ | `max-age=5…10` / `no-store` |
| `darkpool/[ticker]` | ✓ | ✓ | ✓ | **–** | **–** | `s-maxage=60, swr=300` |
| `fundamentals/[ticker]` | ✓ | ✓ | ✓ | ✓ | ✓ | `s-maxage=120, swr=300` |
| `ma-deviation` | ✓ | ✓ | – | ✓ | ✓ | `public, max-age=300, swr=600` |
| `ml/[ticker]` | ✓ | ✓ | ✓ | – | – | `no-store` |
| `news/[sector]` | ✓ | ✓ | – | **–** | **–** | `s-maxage=300, swr=600` |
| `news/ticker/[ticker]` | ✓ | ✓ | ✓ | **–** | **–** | `s-maxage=300, swr=600` |
| `options/[ticker]` | ✓ | ✓ | ✓ | **–** | **–** | `s-maxage=300, swr=600` |
| `prices` | ✓ | ✓ | ✓ | ✓ | ✓ | `public, s-maxage=3, swr=5` |
| `regime/[ticker]` | ✓ | ✓ | ✓ | – | – | `s-maxage=3600, swr=7200` ← DQ-10 |
| `search` | ✓ | **–** | **–** | **–** | **–** | **–** ← DQ-8 |
| `sector-rotation` | ✓ | ✓ | – | ✓ | ✓ | `s-maxage=3600, swr=7200` |
| `stream`, `stream/[ticker]` | ✓ | –/✓ | –/✓ | ✓ | ✓ | `no-cache, no-transform` |
| `trading-agents/*` | ✓ | ✓ | ✓ | – | – | `no-store` |

Rate-limiting coverage is **28/28** and `normalizeTicker` coverage on `[ticker]` routes is
complete except `news/[sector]` (which validates against an allow-list instead — acceptable)
and `search` (which uses its own looser `looksLikeTickerToken` regex, `search/route.ts:35-40`).
That is genuinely good hygiene. The gaps that matter:

**DQ-12a — `/api/news/[sector]`: 5 serial, un-timed upstream calls (P1).**
`app/api/news/[sector]/route.ts:52-92` loops `for (const ticker of tickers.slice(0,5))` with
`await yahooFinance.search(...)` **inside the loop** and **no timeout wrapper at all**. Latency
is the *sum* of five upstream round-trips, each unbounded. The sibling `/api/briefs/route.ts`
gets this right — it wraps every search in `withTimeout(..., NEWS_FETCH_TIMEOUT_MS)` (:86-95).
A single hung Yahoo connection pins the function toward the 300 s ceiling and the user sees a
spinner rather than the graceful "no news" the file's header promises.
*Fix:* `Promise.allSettled` over the 5 tickers (they are independent — the `seen` de-dupe just
moves after the join) wrapped in the existing `withTimeout`; p95 latency drops from ~5× to ~1×.
**Effort** S.

**DQ-12b — `/api/darkpool/[ticker]` and `/api/options/[ticker]`: no timeout, no retry (P2).**
`darkpool/route.ts:201-202` issues a bare `yahooFinance.quote()` + `quoteSummary()`;
`options/route.ts:43` a bare `quote()`. Neither has a timeout budget, so both can run to the
platform ceiling. `quoteSummary` is also the most drift-prone Yahoo surface and neither passes
`validateResult:false` (see DQ-8's class fix). *Fix:* wrap in the existing
`withRetry({attempts:2, timeoutMs:…})` — the pattern is already used correctly four files away
in `fundamentals/[ticker]/route.ts:68-87`. **Effort** S.

**DQ-12c — `/api/briefs/[sector]`: no `sanitizeError` (P2).** The only non-trivial route with
neither `sanitizeError` nor `errorResponse`; verify its error paths don't return raw
`String(err)`. **Effort** S.

**Confidence** High (mechanically derived from the tree; per-route claims spot-checked).

---

### DQ-13 — `/api/prices` Cache-Control does not implement its stated intent — P3

**Evidence** — `app/api/prices/route.ts:186-194`
```ts
'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
'CDN-Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
// Browser MUST NOT cache (per-user data changes constantly).
'Vary': 'Accept-Encoding',
```
`Vary: Accept-Encoding` does not prevent browser caching — it only keys the cache. The
browser-facing directive is `public` with **no `max-age`**, which permits heuristic freshness.
Because `CDN-Cache-Control` is set, Vercel passes `Cache-Control` through to the browser
verbatim (confirmed by probe: `/api/prices` returns `public, s-maxage=3, stale-while-revalidate=5`,
whereas `/api/sector-rotation`, which sets only `Cache-Control`, is rewritten to
`public, max-age=0, must-revalidate`). In practice no `Last-Modified` is emitted so heuristic
caching is unlikely to bite — hence P3 — but the header does not say what the comment says.

**Fix.** `'Cache-Control': 'public, max-age=0, s-maxage=3, stale-while-revalidate=5'`.
**Effort** S · **Confidence** High.

---

### DQ-14 — the FRED risk-free-rate system is dormant, and if activated it returns different rates depending on Lambda warmth — P1

**Evidence — no activation path.** `lib/quant/riskFreeRate.ts` builds a well-designed
tenor-matched RFR (DGS3MO / DGS1 / DGS2 / DGS10, :41-46) with a 24 h cache. But:

- Every consumer calls **only the sync accessor**: `lib/options/chain.ts:145`
  (`getRiskFreeRateSync(daysToExpiry)` → Black-Scholes), `lib/backtest/core.ts:445,456`,
  `lib/backtest/engine.ts:179`, `lib/backtest/walkForward.ts:70`,
  `lib/backtest/portfolioBacktest.ts:603` (Sharpe/Sortino).
- `await getRiskFreeRate(...)` and `prewarmRiskFreeRates()` have **zero call sites** anywhere in
  `app/`, `lib/`, or `scripts/` (verified by grep). The *only* activation is a module-init IIFE:
  ```ts
  if (process.env.QUANTAN_FRED_PREWARM === '1' && process.env.NODE_ENV !== 'test') {
    void prewarmRiskFreeRates()          // :161-163  — fire-and-forget, never awaited
  }
  ```
- With the flag unset, `getRiskFreeRateSync` returns the static constants forever:
  `BACKTEST_RFR_ANNUAL = 0.045` (`lib/quant/constants.ts:60`) and
  `OPTIONS_RFR_ANNUAL = 0.0525` (:78) — two different hardcoded "current" rates, 75 bp apart,
  both presented as the risk-free rate for the same instant.

**Impact — and this is the part that survives even if the flag IS set.** The prewarm is
`void`ed, not awaited, and Vercel re-runs module init on every cold instance. So on a cold
Lambda, `getRiskFreeRateSync()` returns `0.0525` for requests that land before the FRED fetch
resolves, and the live DGS3MO afterwards. **The same option contract priced twice seconds apart
can return different greeks, different IV, and a different theoretical value depending purely on
which instance served the request** — a non-deterministic pricing surface with no disclosure.
The same applies to Sharpe/Sortino on the backtest path.

(Not flagging the env var's provisioning — owner-gated. Flagging the design: dormant-by-default
plus a race that activation does not remove.)

**Fix.** Make the RFR an awaited, explicit input rather than ambient module state:
(a) have the routes that need it `await getRiskFreeRate(tenorDays)` once at the top of the
handler and thread the value down (options chain and backtest both already take config
objects); (b) return the rate **and its provenance** in the response
(`{ riskFreeRate: 0.0432, rfrSource: 'FRED:DGS3MO', rfrAsOf: '2026-08-13' }`) so a
fallback is visible rather than silent — the same `source` pattern DQ-9/DQ-10 already use;
(c) reconcile the two hardcoded constants to one value; (d) give FRED a timeout —
`fetchFredLatestPercent` (:65-84) calls `fetch()` with `next.revalidate` but **no
`AbortSignal`**, so a hung FRED connection has no bound.

**Effort** M · **Confidence** High (grep-verified absence of call sites).

---

### DQ-15 — `useLivePrices` disables focus revalidation, so a backgrounded tab shows frozen prices on return — P2

**Evidence** — `hooks/useLivePrices.ts:64-81`
```ts
refreshInterval: 5_000,
dedupingInterval: 5_000,
revalidateOnFocus: false,     // "Don't re-fetch on tab focus — relies on the 5s interval instead."
revalidateOnReconnect: true,
```
The stated rationale — "relies on the 5 s interval" — is exactly the assumption that fails in a
background tab. Chrome and Safari throttle `setInterval` in hidden tabs to ≥1/minute and freeze
timers entirely in fully-occluded or frozen tabs. So the 5 s poll is precisely the mechanism
that *stops working* while hidden, and `revalidateOnFocus:false` removes the one hook that would
close the gap on return. `revalidateOnReconnect` doesn't help — the network never dropped.

**Impact.** A trader who tabs away and returns sees the last-fetched quote until a throttled
tick fires. On the desk page this is partially mitigated — `DataFreshnessIndicator` is wired to
the real `quoteTime` (`app/desk/page.tsx:163`) and turns red past 120 s — so the staleness is at
least *visible* there. It is not mitigated on surfaces that don't render the indicator.

**Fix.** Set `revalidateOnFocus: true` (SWR's `dedupingInterval` already prevents a focus storm),
and add an explicit `visibilitychange` handler to `useLiveQuotes` (which has no visibility
handling at all) so the SSE transport is torn down when hidden past a threshold and reopened on
return. That also reclaims the serverless invocation a hidden tab currently pins for the full
300 s budget — a direct cost win alongside the correctness one.

**Effort** S · **Confidence** High.

---

### DQ-16 — dashboard mount issues two full quote fetches for the same 13 symbols — P3

**Evidence** — `app/page.tsx:95-110`. The REST boot fetch `fetch('/api/prices')` (no `tickers`
param → defaults to all 11 sector ETFs + SPY + QQQ, `app/api/prices/route.ts:88`) runs on mount;
`useLiveQuotes(liveTickers)` then opens `/api/stream?tickers=<same 13>`, whose `start()` emits an
**unconditional initial batch** (`app/api/stream/route.ts:211`). Two full upstream Yahoo `quote()`
calls for an identical symbol list, ~1-2 s apart, on every dashboard mount.

The boot fetch is defensible as a paint-latency hedge, but it is no longer *needed* — the SSE
initial batch is emitted before any timer, so the gap it covers is one round-trip. Note also that
`app/page.tsx:87-91`'s comment still describes the old fan-out ("maintains N parallel EventSource
connections — one per ETF"), stale since the 08-14 multiplex.

**Impact.** 2× upstream quote volume per dashboard load and 2× the rate-limit consumption; no
correctness impact. Worth folding into the DQ-1/DQ-2 hook pass rather than a standalone change.

**Fix.** Drop the boot fetch and render the loading skeleton until the first `quote` event, or
keep it and skip the stream's initial batch when the client signals it already has a snapshot.
Refresh the stale comment either way.

**Effort** S · **Confidence** High.

---

### DQ-17 — accuracy spot-checks that came back CLEAN

Recording these so the next wave doesn't re-derive them:

- **Finite/NaN guards at ingest** — solid at every layer checked. `finite()`
  (`app/api/stream/route.ts:88-90`), `num()` (`lib/api/sanitize.ts:70-72`,
  `app/api/prices/route.ts:26-28`), `hasPositiveClose` (`lib/quant/chartQuoteFilter.ts`),
  `parseLiveQuote`'s `price <= 0` rejection (`hooks/useLiveQuote.ts:68-84`), and
  `loadStockHistory`'s per-bar `Number.isFinite` filter on **both** the warehouse and JSON paths
  (`lib/backtest/dataLoader.ts:55-70`). Defence in depth is real here, not decorative.
- **Symbol matching in the batched stream** — `app/api/stream/route.ts:118-122` matches Yahoo
  rows **by `symbol`, never by index**, with an explicit comment on why. This is the correct and
  non-obvious choice; index-matching would silently mislabel prices across a whole batch.
- **DST handling** — `lib/api/marketHours.ts` uses `Intl.DateTimeFormat` with
  `America/New_York`, correctly fixing the prior `getTimezoneOffset()` bug. Only the holiday
  calendar is missing (DQ-4).
- **Bloomberg bridge** — `lib/data/bloomberg/bridgeClient.ts:78-93` has a proper
  `AbortController` timeout (4 s default, clamped 500 ms–30 s), returns `null` on any failure,
  and `clearTimeout`s in `finally`. It cannot stall `/api/prices` despite being `Promise.all`ed
  with the Yahoo call. Prod reports `bloombergStatus: "not_configured"`. *One nit for the class
  fix in DQ-5:* the bridge's `changePct` (:119-124) is also taken raw without
  `normalizedChangePercent`, and `mergeYahooAndBloomberg` prefers Bloomberg — dormant today,
  but it would activate with the bridge.
- **Weekly fixture cron health** — `.github/workflows/refresh-data.yml` is genuinely running:
  five consecutive weekly commits through `0c25245 (2026-08-09)`. The *cadence* is the problem
  (DQ-7), not the mechanism. Note the schedule is **Sunday** 22:00 UTC, not Saturday as the
  program brief states.
- **Rate-limit coverage** — 28/28 routes call `applyRateLimit`. The KV path's atomic
  `SET…EX…NX` (`lib/api/rateLimit.ts:92-118`) including the V-1 TTL-reattach is correct.
  (KV provisioning itself is owner-gated and out of scope.)
- **Stream budget** — `STREAM_AUTO_CLOSE_MS` = 270 s with a 30 s warn lead leaves 30 s of
  headroom inside the 300 s ceiling; the close timer is chained *inside* the warn handler
  (`app/api/stream/route.ts:259-274`) so ordering is structural. The #134 fix is sound.
- **POST body validation** — checked explicitly because it is the only mutation surface in
  scope. `POST /api/backtest` (`app/api/backtest/route.ts:177-199`) **reads no request body at
  all**: it is a pure "clear cache + recompute" trigger, CSRF-validated (`validateCsrf`, :178)
  and rate-limited to 3/min on its own bucket. There is no unvalidated numeric parameter
  reaching the engine — no finding. `/api/backtest`'s GET `tickers` filter is normalized and
  capped at 100 (:133-139), as is `/api/backtest/live`'s (:67-73). **This is the only POST in
  the reviewed surface**; every other route is GET-only.

  *Two small notes on that POST, neither worth its own entry:* it bypasses the `computing`
  in-flight coalescing guard that GET uses (:155-157), so up to 3 concurrent POSTs each spawn a
  full 56-instrument backtest; and it sets `cache = null` **before** computing (:187), so a
  failed recompute permanently evicts the 1 h cache and the next GET pays a full cold run.
  Both are one-line fixes if the route is ever touched.

Two smaller items not worth their own entries: `RECONNECT_CAP` in both SSE hooks is dead code
(the index is pre-clamped to `RECONNECT_BACKOFF_MS.length - 1`, so the `??` never fires); and
`app/page.tsx:145` writes the stream's transport `timestamp` into a field named `quoteTime`,
colliding with the same field's "Yahoo print time" meaning elsewhere in the codebase — that is
the mechanism by which DQ-3 would reach `DataFreshnessIndicator` if the homepage ever wires one
up, and it already feeds `SignalCard`'s "Quote {formatFreshness(...)}" label
(`components/SignalCard.tsx:159-161`).

---

## TOP 10 BY YIELD

Ranked by (trading-decision harm × confidence) ÷ effort.

| # | ID | Sev | Finding | Effort | Why it ranks here |
|---|---|---|---|---|---|
| 1 | **DQ-7** | P0 | `/api/backtest/live` serves 90 %-confidence BUY/SELL + Kelly sizing on data up to 5 sessions old, under the label "Live data refreshes every 60s" | S (copy) / M (cadence) | Only finding that is *both* wrong-at-the-decision and actively reassuring. The copy fix is one line and removes the lie today. |
| 2 | **DQ-1** | P0 | `useLiveQuotes.marketOpen` never resets → homepage pill reads **LIVE** with a pulsing green dot after the close | S | Primary surface, provable regression (the singular hook does it right one file away), one-line fix. |
| 3 | **DQ-8** | P1 | `/api/search` is the one `yf.search()` site the drift fix missed; free-text search silently returns zero results | S | The named 3-month-outage bug, recurring. A/B-proven against prod. One argument to fix; one smoke assertion to never repeat. |
| 4 | **DQ-5** | P1 | `changePct` unnormalized on the stream path but normalized on the prices path — 100× divergence on the same dashboard | S | Two paths for one user-visible number; the platform already paid for this bug once. |
| 5 | **DQ-2** | P1 | Multiplex stream drops `degraded`; upstream failure renders as a healthy feed with frozen prices | S/M | Makes every other data failure invisible — fixing it raises the floor under all of them. |
| 6 | **DQ-4** | P1 | No holiday calendar → 13 sessions/year the platform claims "open" and streams a frozen tape | M | Deterministic, testable, self-contained. Compounds DQ-3 on exactly the days it fires. |
| 7 | **DQ-9** | P1 | `/api/conditional-vol` labels an EWMA proxy "GARCH(1,1)", flat forecast, ≤72 h cache on ≤6-day-old inputs | S | Vol is the fastest-moving quantity and carries the most defensible TTL cut on the surface. |
| 8 | **DQ-14** | P1 | FRED RFR dormant; if activated, same option prices differently by Lambda warmth | M | Non-deterministic option greeks is a correctness class, not a freshness one. |
| 9 | **DQ-3** | P1 | SSE `timestamp` is fetch time, not the quote's as-of time | M | The freshness *primitive* is wrong; every future freshness UI inherits it. |
| 10 | **DQ-12a** | P1 | `/api/news/[sector]` runs 5 serial, un-timed Yahoo calls | S | Unbounded latency against the 300 s ceiling; the correct pattern already exists in the sibling route. |

**Suggested wave-1 cut:** items 1–5 are all **S** and together are roughly a day. They remove
both P0s, the recurring outage class, and the two-path unit bug.

---

## CADENCE MAP

Refresh frequency of every user-visible number. "Worst-case age" = upstream cadence + CDN
`s-maxage` + `stale-while-revalidate`.

| User-visible surface | Data source | Actual refresh today | Worst-case age | Proposed | Cost / risk |
|---|---|---|---|---|---|
| Dashboard sector tiles, PriceTicker (`app/page.tsx`) | Yahoo `quote()` via SSE `/api/stream` | push, 15 s poll, **RTH only** | 15 s (open); **unbounded when closed — shown as LIVE, DQ-1**) | keep 15 s; fix the open/closed latch | none |
| Dashboard boot snapshot | `/api/prices` | once on mount + CDN 3 s / SWR 5 s | 8 s | drop the duplicate (DQ-16) | none; −50 % upstream/mount |
| Desk page quote grid (`app/desk`) | `/api/prices` via SWR | 2 s / 5 s / 15 s user-selected | 8 s + hidden-tab freeze | `revalidateOnFocus: true` (DQ-15) | none |
| Stock & sector page quotes | `/api/stream/[ticker]` | push, 15 s poll | 15 s | keep — this path is healthy | — |
| Sector rotation panel | Yahoo `chart()` ×11, 2 y daily | CDN 1 h + SWR 2 h, **fetched once per page-load, label frozen** | **3 h** (label says "1-hour cache") | `s-maxage=900, swr=900` (30 min) + ticking label + refetch on focus | 4× origin calls/h on an 11-call fan-out; still trivial at this traffic |
| **Live signals panel** (`/api/backtest/live`) | **weekly JSON fixture** | in-memory 60 s + CDN 60 s / SWR 120 s over **Sunday-refreshed** data | **≈5 trading sessions** | fixture → **daily** `0 22 * * 1-5`; overlay today's live quote | ~5× Actions minutes (small); prefer warehouse writes over JSON commits to avoid churn |
| Conditional-vol forecast | weekly fixture + EWMA proxy | CDN 24 h + SWR 48 h | **≈9 days** | `s-maxage=900, swr=3600` + daily fixture | negligible; compute is local |
| Regime state / probabilities | weekly fixture + rule fallback | CDN 1 h + SWR 2 h | **≈8 days** | same as above; fix the label | negligible |
| Backtest results (`/api/backtest`) | weekly fixture | CDN 1 h + SWR 2 h | ≈8 days | **correct as-is** — a backtest *should* be a fixed corpus; just label the corpus date | none |
| Options chain + greeks | Yahoo `quote()` + RFR constant | CDN 5 min / SWR 10 min | 15 min + **hardcoded RFR** | add timeout/retry (DQ-12b); thread a real RFR (DQ-14) | one FRED call/day |
| Fundamentals | Yahoo `quoteSummary` + `chart` | CDN 2 min / SWR 5 min | 7 min | keep — appropriate for the data class | — |
| Analytics (beta, win-rate, corr) | Yahoo `chart()` 5 y | CDN 5 min / SWR 10 min | 15 min | keep | — |
| News / briefs | Yahoo `search()` | CDN 5 min / SWR 10 min (briefs 1 min/5 min) | 15 min | keep cadence; parallelize the fan-out (DQ-12a) | none; p95 latency ÷5 |
| Global search | Yahoo `search()` | per-request, no cache | n/a — **returns empty (DQ-8)** | fix the guard; add `s-maxage=60` | none |
| Dark pool | Yahoo `quote` + `quoteSummary` | CDN 1 min / SWR 5 min | 6 min | keep; add timeout/retry | — |
| BTC quote / metrics / liquidations | Bybit + OKX public | `no-store` / 5 s / 10 s | ≤30 s | keep — the crypto path is the freshest on the platform | — |
| MA deviation | Yahoo `chart()` | CDN 5 min / SWR 10 min | 15 min | keep | — |
| Risk-free rate (options, Sharpe) | FRED — **dormant** | **never; static constant** | ∞ | await FRED per-request, 24 h cache, expose `rfrAsOf` | 1 fetch/day/instance |

**Two structural notes for the cadence work.**

1. *The weekly fixture is the single largest freshness liability on the platform.* It backs four
   routes, two of which (`/backtest/live`, `/conditional-vol`) present forward-looking,
   decision-grade numbers. Moving that one cron from weekly to daily
   (`0 22 * * 0` → `0 22 * * 1-5`) improves the worst case on all four at once and is the highest
   freshness-per-effort change available.

   **Consequence the owner must see before approving:** `refresh-data.yml` ends with
   `git push origin HEAD:main`, and main auto-deploys. Weekly→daily therefore means **five
   production deploys a week triggered by a data cron**, each rebuilding and shipping the app to
   change only JSON fixtures. That is the concrete reason to prefer writing the refresh into the
   **SQLite warehouse** (`lib/data/warehouse.ts` — already the first source `loadStockHistory`
   consults, `dataLoader.ts:52-56`) rather than committing JSON: the warehouse path decouples
   data cadence from deploy cadence entirely. Treat "daily cron" and "stop committing data to
   main" as one change, not two.
2. *The route naming is doing real harm.* `/api/backtest/live` and "conditional volatility
   forecast" both read as live/forward-looking; both are weekly-fixture derivatives. Renaming
   costs nothing and closes the interpretive gap that the cadence fix only narrows.

---

## Coverage

| Scope area | Status |
|---|---|
| 1. Provider/fetch layer (yahoo, bloomberg bridge, FRED, OKX/Bybit) — timeouts, retries, fallbacks, schema-drift, rate limits | Covered — DQ-8, DQ-12, DQ-14, DQ-17 |
| 2. Freshness & frequency — live vs cached vs fixture, cadence map, stale-as-live | Covered — DQ-1, DQ-3, DQ-4, DQ-6, DQ-7, DQ-9, DQ-10, CADENCE MAP |
| 3. API surface (28 routes) — validation, error shape, sanitizeError, Cache-Control, timeout budgets | Covered — DQ-12 table (all 28), DQ-13 |
| 4. Client fetching — SSE robustness, abort races, waterfalls, duplicate fetches | Covered — DQ-1, DQ-2, DQ-15, DQ-16 |
| 5. Accuracy — units, NaN/finite, timezone/market hours, partial bars, splits/dividends | Covered — DQ-4, DQ-5, DQ-11, DQ-17 |

Excluded per brief (verified as still-closed where cheap): Redis/KV provisioning, auth env,
`/api/stream` 300 s timeout (#134 — confirmed correct), the SSE multiplex itself (shipped; its
robustness gaps are DQ-1/DQ-2/DQ-15), the F1.x–F8.x ledger, `vercel` devDependency audit items.
Previously-fixed items re-verified as still fixed before writing: provider timeouts on the
alphavantage/polygon/fred class, AlphaVantage non-finite skip, atomic rate-limit SET-EX-NX,
briefs `allSettled`.

*End of review.*
