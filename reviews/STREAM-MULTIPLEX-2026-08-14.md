# Multiplexed SSE stream + sector-card copy pass — 2026-08-14

Branch `claude/error-review-interface-91806b` (from `c472af3`). Committed, **not pushed, no PR,
not deployed.**

Closes the `deferred_owner_gated` block recorded by the 2026-08-14 interface review:
the multiplexed `/api/stream`, the `6/13 streams` implementation detail in the LIVE badge,
the sector-card jargon (`Prior:` / `Move scale`), and the last stale `NEW` badge.

---

## 1. What was wrong

The dashboard subscribed to 13 symbols (11 GICS sector ETFs + SPY + QQQ) and
`hooks/useLiveQuotes.ts` opened **one EventSource per ticker**. Two consequences:

1. **Most streams never opened.** Browsers cap simultaneous HTTP/1.1 connections at ~6 per
   origin. The LIVE badge printed the damage verbatim — `6/13 streams` — and the other seven
   sectors silently fell back to whatever the one-shot REST boot fetch had left behind.
   Captured from the pre-change build in the browser network log, on one page load:

   ```
   GET /api/stream/XLE  [FAILED: net::ERR_FAILED]
   GET /api/stream/XLF  [FAILED: net::ERR_FAILED]
   GET /api/stream/XLK  [FAILED: net::ERR_FAILED]
   …26 further FAILED entries…
   GET /api/stream/XLC  → 200 OK
   GET /api/stream/XLY  → 200 OK
   GET /api/stream/XLV  → 200 OK
   ```

2. **13 serverless invocations per viewer.** Each stream pins its own function for up to the
   300 s ceiling, and each polled Yahoo independently — 13 upstream quote calls every 15 s
   for data that one batched call returns.

Production runs HTTP/2, so item 1 was not a prod outage (verified in the prior wave); item 2
was a real and unconditional 13× concurrency cost.

## 2. What changed

**New route `app/api/stream/route.ts`** (additive — `app/api/stream/[ticker]/route.ts` is
untouched and still serves `hooks/useLiveQuote` on the stock and sector pages).

| | |
|---|---|
| Input | `?tickers=XLK,XLE,…` — each token through the shared `normalizeTicker` (F7.3 whitelist) |
| Cap | 20 symbols (`MAX_STREAM_TICKERS`), pinned equal to the hook's `MAX_LIVE_STREAMS` by test |
| Rejects | missing/empty → `missing_tickers`; any invalid token → `invalid_ticker`; >20 → `too_many_tickers`; all HTTP 400 JSON |
| Order | validation runs **before** the rate limiter, so probes don't drain an IP's bucket (same rationale as the singular route) |
| Rate limit | own bucket `stream-multi`, 10 req / 60 s |
| Upstream | ONE batched `yahooFinance.quote([...symbols], undefined, { validateResult: false })` per tick; rows matched back **by `symbol`, never by index** |
| Budget | `maxDuration = 300` literal; `closing_soon` → `close` chained from `lib/api/streamBudget.ts` |

### Wire format

Identical to the singular route — the `quote` payload already carried `ticker`, which is what
makes demultiplexing a map lookup. `parseLiveQuote` needed no change.

```
event: quote
data: {"ticker":"XLK","price":191.07,"change":2.2100067,"changePct":1.1701825,
       "volume":2977739,"marketOpen":true,"timestamp":"2026-08-13T18:00:02.268Z"}

event: market_state
data: {"open":true,"timestamp":"2026-08-13T18:00:02.269Z"}
```

* `quote` — one per ticker per poll tick (15 s), plus an initial burst on connect.
* `market_state` — **one aggregated** event on connect, then only on open↔closed transitions.
* `heartbeat` (30 s), `closing_soon` (T-270 s), `close` (T-240 s), `degraded` (batch failure).

The initial burst is emitted **unconditionally**, exactly like the singular route: outside
market hours a client still needs the last close to render. Only the *poll* is gated on
`isMarketOpen()`, and the timer is always armed so a pre-market client goes live at the bell.

**`lib/api/streamTickers.ts`** (new) — `MAX_STREAM_TICKERS` + `parseTickerParam`. See §5.

**`hooks/useLiveQuotes.ts`** — internals rewritten onto one EventSource. **Public API
unchanged**: `quotes`, `connections`, `marketOpen`, `supported`, `active`, `dropped`, and the
`MAX_LIVE_STREAMS` export all keep their names, types and meaning. `connections` is now
all-or-nothing, which is what the per-ticker map degenerated to in practice anyway. Reconnect
behaviour is preserved (backoff `1/2/4/8 s`; `closing_soon` → server-suggested delay capped at
60 s, 30 s fallback; `close` → 500 ms). `app/page.tsx` needed **zero** changes to consume it.

**`app/page.tsx`** — the LIVE badge drops the `N/M streams` counter (three states remain:
`LIVE` / `MARKET CLOSED` / `CONNECTING`, plus `Updated HH:MM:SS`), and the stale `NEW` badge
on the backtest CTA is gone.

**`components/SectorCard.tsx`** — labels only, **no rendered number changed**:

| before | after | why |
|---|---|---|
| `Prior:` / `Last:` | `Prev close` / `Last` | "prior" was ambiguous (prior tick? prior session?) |
| `prior→last` | `prev close → last` | same |
| `Move scale` | `Session move size` + tooltip | named a unit, not a meaning — see below |
| `62%` (bare) | same text, `aria-label` added | the visible label sits in a sibling span, so a screen reader announcing the chip alone read a naked number |

`Move scale` was the worst of them. For session rows the bar is **not** a confidence: per
`lib/sessionSignalsFromQuotes.ts` it is `42 + 14×|Δ%|`, saturating at 82 near ±2.9 %. It is a
rescaled move *magnitude*. The new tooltip says so explicitly ("a size indicator only — not a
confidence, probability, or forecast"), and the accessible name reads
`Session move size 58 out of 100` rather than implying a percentage.

## 3. Measured verification

All four gates run in order, on this machine, in this worktree.

**1. `node node_modules/typescript/bin/tsc --noEmit`** → `TSC_EXIT=0`, no output.

**2. `node node_modules/vitest/dist/cli.js run`**

```
Test Files  107 passed | 1 skipped (108)
     Tests  1395 passed | 17 skipped (1412)
  Duration  7.59s
```

Baseline was 1376 passed / 17 skipped. **1395 − 1376 = 19**, exactly the new tests in
`__tests__/api/streamMultiplex.test.ts`. Nothing else moved: no existing test changed, and the
17 skips are the same DB-gated ones. (The mid-wave run showed 1394 — the 19th test is the
export-surface guard added in response to the build failure in §5.)

**3. `node node_modules/next/dist/bin/next build`** → `BUILD_EXIT=0`,
`✓ Compiled successfully in 3.5s`. Both routes present and dynamic:

```
├ ƒ /api/stream                            215 B         105 kB
├ ƒ /api/stream/[ticker]                   215 B         105 kB
```

**4. `next start -p 3000`, empirical.**

One connection, 13 tickers (truncated — 13 `event: quote` blocks, then the aggregated state):

```
$ curl -sN -m 8 "http://localhost:3000/api/stream?tickers=XLK,XLE,XLF,XLV,XLY,XLI,XLC,XLB,XLU,XLRE,XLP,SPY,QQQ"
event: quote
data: {"ticker":"XLK","price":191.07,...,"marketOpen":true,"timestamp":"2026-08-13T18:00:02.268Z"}
event: quote
data: {"ticker":"XLE","price":60.97,...}
…
event: quote
data: {"ticker":"QQQ","price":732.315,...}
event: market_state
data: {"open":true,"timestamp":"2026-08-13T18:00:02.269Z"}

quote events: 13
distinct tickers: QQQ SPY XLB XLC XLE XLF XLI XLK XLP XLRE XLU XLV XLY
market_state events: 1
```

The poll loop, on the same single connection (20 s window, 2 tickers):

```
$ curl -sN -m 20 "http://localhost:3000/api/stream?tickers=XLK,SPY"
quote events in 20s: 4          # initial burst (2) + one 15 s tick (2)
distinct timestamps: 2
   1 event: market_state
   4 event: quote
```

Validation:

```
no param:      400   {"error":"missing_tickers","message":"Query parameter `tickers` is required (comma-separated symbols)."}
empty param:   400
traversal:     400   {"error":"invalid_ticker","message":"One or more ticker symbols are invalid."}
21 tickers:    400   {"error":"too_many_tickers","message":"Maximum 20 tickers per stream."}
20 tickers:    200   (cap boundary accepted)
```

Browser, **fresh tab, one page load** — the whole point of the wave:

```
[10009.96] GET http://localhost:3000/api/stream?tickers=XLK%2CXLE%2C…%2CQQQ → 200 OK
```

Exactly one request, 200, all 13 symbols. Live DOM assertions on that page:

| check | result |
|---|---|
| hero badge text | `LIVE · Updated 02:04:52` → `02:05:52` on the next tick (ticker prices moved too — live data flowing through the single stream) |
| `/\d+\s*\/\s*\d+\s*streams/` anywhere in body | `false` |
| any `<span>` whose text is exactly `NEW` | `false` |
| sparkline caption | `prev close → last` (64.4 px in a 72 px column, **one line**, no wrap) |
| tooltip rows | `Prev close \| $188.86 \| Last \| $191.03` |
| `Move scale` present | `false`; `Session move size` present, label one line, 139 px row slack |
| `%` chip | text `58%` unchanged, `aria-label="Session move size 58 out of 100"` |
| tooltip button | `aria-label="Explain Session move size"` |

Regression, singular route (unchanged file, re-verified live):

```
$ curl -sN -m 6 "http://localhost:3000/api/stream/XLK"
event: quote
data: {"ticker":"XLK","price":191.0499,...,"timestamp":"2026-08-13T18:06:30.042Z"}

/sector/technology → 200        # page that consumes useLiveQuote
```

Server stopped afterwards.

## 4. Deliberately NOT changed

* **`app/api/stream/[ticker]/route.ts`** — untouched. `hooks/useLiveQuote` and its two
  consumers (`app/stock/[ticker]`, `app/sector/[slug]`) keep the per-symbol endpoint.
* **Every displayed number, win-rate label and disclosure string.** The sector-card values are
  byte-identical; only labels, one tooltip and accessible names changed.
* **`MAX_LIVE_STREAMS = 20`** kept as-is and kept exported. It now caps symbols-per-connection
  rather than connections, but the value and the public name are unchanged.
* **`UseLiveQuotesResult` was not widened.** No `error` field — the plural hook never listened
  for `degraded` and no caller reads one. The server emits `degraded`; the client ignoring it
  is correct.
* **No EventSource lifecycle harness.** Repo precedent (`__tests__/hooks/useLiveQuotes.test.ts`)
  defers it as disproportionately heavy; the pure logic was extracted and tested instead, and
  the transport is covered empirically by §3.
* **`lib/quant/**`, `lib/backtest/**`, `lib/options/**`** — the only Stryker-mutated globs.
  Nothing in this wave touches them; the mutation gate's 4/4 margins are unaffected.
* **The PWA service worker and the middleware matcher** — checked, no change needed. A
  service-worker cache rule matching an SSE endpoint would be catastrophic, and the rule could
  plausibly have been keyed to a path shape with a segment after `/api/stream/`. It is not:
  `next.config.js` uses `urlPattern: ({ url }) => url.pathname.startsWith('/api/')` →
  `NetworkOnly`. That is a **pathname** predicate, so the query-string form `/api/stream?
  tickers=…` is covered identically to `/api/stream/XLK`. `middleware.ts` matches
  `/((?!_next/static|_next/image|favicon.ico).*)`, which includes the new route — and the
  browser and curl verifications in §3 both went through it.

## 5. Findings worth keeping

**A Next.js route may export ONLY handlers and route-segment config — and neither tsc nor
vitest can see the violation.** `MAX_STREAM_TICKERS` and `parseTickerParam` were first written
as exports of `route.ts` so they could be unit-tested. `tsc --noEmit` was clean and the full
1394-test suite passed. The build then failed:

```
app/api/stream/route.ts
Type error: Route "app/api/stream/route.ts" does not match the required types of a Next.js Route.
  "parseTickerParam" is not a valid Route export field.
```

This is the **same static-analysis gate** already documented in `lib/api/streamBudget.ts` for
`maxDuration` having to be a literal — a broader rule than that note implies, and the third
time this repo has been bitten by "the Vercel build is the only gate that sees it". Fix:
`lib/api/streamTickers.ts` holds the cap and the parser; the route imports them and exports
only `maxDuration` and `GET`.

Rather than leave it as tribal knowledge, `streamMultiplex.test.ts` now asserts the route's
**export surface** against the legal-field set, so the next occurrence fails in vitest
(sub-second) instead of at build time. That is the 19th test.

**Yahoo does not promise one row per requested symbol.** The batched call is mapped back by
`q.symbol`; index-matching would silently mislabel prices when a row is missing or reordered.
Covered by a test that returns a short, reordered response.

**Ticker-key identity.** The server normalizes (`VIX` → `^VIX`) while the hook keys `quotes` by
the caller's own string. For the dashboard's 13 plain ETFs these are identical. The hook builds
a small alias map (both the raw and the normalized form point at the caller's key) so an index
alias cannot silently drop quotes if a future call site subscribes to one.

**Plan correction:** the plan named `app/page.tsx` *and the heatmap* as callers to re-verify.
`useLiveQuotes` has exactly **one** caller — `app/page.tsx`. Neither `app/heatmap/page.tsx` nor
`components/backtest/SectorHeatmap.tsx` uses live streams (grepped for `useLiveQuotes`,
`EventSource`, `api/stream`: no hits).

## 6. Files changed

```
app/api/stream/route.ts               NEW   multiplexed SSE endpoint
lib/api/streamTickers.ts              NEW   cap + parseTickerParam (route-export constraint)
__tests__/api/streamMultiplex.test.ts NEW   19 tests
hooks/useLiveQuotes.ts                      fan-out → single stream; public API unchanged
app/page.tsx                                LIVE badge counter removed; stale NEW badge removed
components/SectorCard.tsx                   label/a11y copy pass; no value changes
```
