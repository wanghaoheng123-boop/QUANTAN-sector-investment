# Q-140 — every data route must say when its upstream failed, and every consumer must show it

**Date:** 2026-10-01 · **Tickets:** Q-140, plus Q-091 and Q-094 closed with it · **Ledger:** Q140-1 … Q140-9
**Kind:** migration note. Wire changes on failure paths. One displayed calculation changes: a missing price or
change is `null` and renders `—`, where it used to be `0`. Nothing in any signal or backtest changes.

## Why a behavioural detector

Two fail-silents were found by reading:
- three routes set `degraded: true` and nothing read the flag (Q-138);
- `/api/search` answered `200 {"quotes":[]}` when Yahoo failed (Q-118).

A source-text detector would repeat the cache-flag defect. A producer set defined as "routes that already set
the flag" cannot see a route that fails silently *without* it.

`__tests__/architecture/fail-closed-routes.test.ts` therefore calls **every API route** with every upstream
down: `fetch` rejects and every `yahoo-finance2` method throws. A clean 2xx is not allowed. The answer must be a
non-2xx status, `degraded: true`, the sector brief's own `dataQuality: unavailable|partial`, or `ok: false` for a
health probe.

The route set is every `route.ts` on disk. Each route is either exercised or exempted with a stated reason, and a
route that is in neither list fails the suite.

## What it found: 8 of 20 exercised routes answered a clean 200 with nothing upstream working

| Route | What the user saw | Fix |
|---|---|---|
| `/api/briefs` | a "quiet news day" | `fetchNewsForTicker` **resolved** `[]` on error, so the route's own failure counter never counted a failure, and its `degraded` threshold could never fire. It now rejects |
| `/api/briefs/[sector]` | **$0.00**, "flat 0.00%". The note blamed "Market may be closed or ticker not supported" | price, change and change % are `null` → `—`. The note says the feed failed. **Q-091:** an empty news list is no longer counted as a fault, and nothing is blamed on a "pre/post-market phase". Trailing P/E printed as **`$31.2`** now reads `31.2×` |
| `/api/darkpool/[ticker]` | quote zero-filled "explicitly". The note said "**not available for this security type (ETF, ADR, or OTC)**", a wrong explanation for an outage | nullable quote, `degraded`, and a note naming the failure. The route's private copy of the types, already drifted from `lib/darkpool.ts`, is removed |
| `/api/ma-deviation` | 11 error rows and no top-level signal, **cached for 5 minutes** in the module and at the CDN | `degraded` when most sectors fail, and such a board is not cached |
| `/api/news/[sector]` | "No recent news" during an outage | failures counted. A degraded list is `no-store` |
| `/api/sector-rotation` | ranks among the surviving sectors presented as *the* ranking, **CDN-cached for an hour** | any fetch failure → `degraded`, `no-store` |
| `/api/ml/[ticker]` | "not deployed" and "deployed but failing" were the same `{available:false}`; production probed `localhost:8001` | `reason: not_configured` versus `degraded` |
| `/api/bloomberg-bridge/health` | an *authenticated* probe reported `status: 'ok'` beside `reachable: false` | `status: 'degraded'`. The unauthenticated answer stays constant **by design** (no infrastructure disclosure) and is exempt |

## Consumers — a degraded answer nobody reads is the defect itself

The same file records each route's failure mode and requires every UI file that fetches it to handle that mode:
the flag for a 2xx-degraded route, `res.ok` for a non-2xx one. Consumers are **derived from source**, and a read
made one `@/` import away counts. It found:

- **The BTC metrics notice.** `BtcQuantLab` never read the metrics route's `degraded` and `userMessage`, the
  unread flag Q-140 was filed for. It now shows the message.
- **`/heatmap` and `/commodities`.** They never checked `res.ok`. A failed poll kept the old prices and the old
  "Last update" time with no notice, and commodities showed "Loading…" forever if the first poll failed.
- **The sector and stock pages.** They stored a non-2xx dark-pool body `{error}` as the analysis, and the panel
  then read `apiData.quote.price` on `undefined`. Now they check `r.ok`, and `DarkPoolPanel` shows an error state.
- **Landing news, `NewsFeed` and `SectorRotationPanel`.** Each now shows the route's message. The "Live" label and
  green pulse are replaced by "Partial" when the feed is degraded.

**Q-094:** `NewsFeed` parses the payload with zod (`lib/news/newsPayload.ts`) one item at a time. A malformed item
is dropped and counted, and a non-envelope body takes the error path. `zod` is now a declared dependency, with a
register row; it was already installed transitively at the same version.

## Three tests ratified the defects

- `sectorBrief.test.ts` asserted `price === 0` and the "Market may be closed" note on a dead upstream.
- It also asserted that an empty news list makes the brief "partial", which is Q-091 pinned as correct.
- `search.test.ts` (Q-118, same session) asserted the fail-silent `quotes: []`.

All three are replaced.

## Tests and mutations

- `fail-closed-routes.test.ts`: 42 tests.
- `degradedRoutes.test.ts`: the specific promises behind it, namely that a degraded board isn't cached, the
  dark-pool note distinguishes a failure from a coverage gap, and a partial ranking says it is partial.
- Brief tests, the news parser, the `NewsFeed` and `GlobalSearch` jsdom tests, and a `BtcQuantLab` render test.

16 mutations, all failing as designed. **One survived its first run (C1):** deleting the metrics notice left the
consumer guard green. The lab imports `LiquidationsPanel`, which reads *another* route's flag, so "the consumer
mentions `degraded`" was already true. That is now an asserted CANNOT-DO (the guard binds a read to a file, not to
a payload), and the read is pinned by a render test.

Verified in a local production build with healthy upstreams: no route reports degraded (no false alarms), and the
brief, MA-deviation, heatmap and commodities pages render real prices.

## Named residuals

- **SSE routes are exempt from the behavioural run.** `/api/stream` signals failure in-stream.
- **The consumer guard reads text, not data flow** (the CANNOT-DO above).
- **`.env.example` does not document `ML_SIDECAR_URL`.** Env files are owner-edited.
- **A pre-existing React hydration error (#418)** on `/briefs/sector/technology` was seen on production during
  verification. → **Q-142**
