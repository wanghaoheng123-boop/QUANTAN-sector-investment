# Q-140 — every data route must say when its upstream failed, and every consumer must show it

**Date:** 2026-10-01, revised 2026-10-16 after red-team round 1 (`reviews/q140-red-team-2026-10-16.md`)
**Tickets:** Q-140 with Q-091 and Q-094 closed alongside it
**Ledger:** Q140-1 … Q140-9, and Q140-R1 … for the round-1 findings
**Kind:** migration note. It changes wire fields on failure paths and the inputs the sector brief displays. Nothing in any signal or backtest changes.

## The first version of this note was wrong in six places

Each correction below is the round-1 red-team's finding. Each was verified before the text changed.

| First version said | True |
|---|---|
| "**8 of 20** exercised routes answered a clean 200" | `CASES` had **19**. The detector itself finds **6** of them. The sector brief already answered `unavailable` before the fix, and the detector accepted that (H1). Bloomberg health is exempt. The other two fixes came from reading, not from the detector. |
| Trailing P/E "printed as **`$31.2`**", listed under *what the user saw* | That value came from the test fixture. Sector ETFs never carry `trailingPE` in the summary module, so no user saw that line (B1). |
| Q-091 closed: a healthy brief reads LIVE | Every brief still read **partial** on a healthy day. P/E counted as missing because it was read from a module Yahoo never fills for an ETF (B1). Measured on production: all 11 briefs were partial. |
| "every consumer shows it" | Four live consumers ignored a non-2xx answer: the landing prices, the landing news on a 429, the stock options tab, and extended analytics. The guard passed each one on another fetch's `.ok` in the same file (B2). |
| The route's type copy had "already drifted" from `lib/darkpool.ts` | The two were structurally identical (L2). |
| "16 mutations, all failing as designed" | No list existed, so the count could not be checked (L4). It is replaced below by a listed run. |

## Why a behavioural detector

Two fail-silent paths were found by reading:
- three routes set `degraded: true` and nothing read the flag (Q-138);
- `/api/search` answered `200 {"quotes":[]}` when Yahoo failed (Q-118).

A source-text detector would repeat the cache-flag defect. A producer set defined as "routes that already set the flag" cannot see a route that fails silently *without* setting it.

`__tests__/architecture/fail-closed-routes.test.ts` therefore calls **every API route** with every upstream down: `fetch` rejects, and every `yahoo-finance2` method throws. Every route on disk is either in `CASES` (21) or in `EXEMPT` (7, each with a reason). A route in neither list fails the suite.

**Since round 1 the detector also requires:**
- **Every case actually reached an upstream mock.** The trading-agents health case had answered `config_error` without calling anything, and a mutation that reports a dead backend as healthy stayed green (H3).
- **Any non-2xx answer is a 5xx.** A 4xx is a validation answer, not "my upstream failed" (H3).
- **With everything down, the sector brief says `unavailable`.** `partial` was also the healthy steady state (H1).
- **Both quant-framework routes are exercised.** `conditional-vol` and `regime` were exempt as "reads committed fixtures, no network upstream". Both actually fetch `QUANT_FRAMEWORK_URL` and swallowed the failure in a literal `catch { /* fallback */ }` (H2).

## Routes fixed

| Route | Before | Now |
|---|---|---|
| `/api/briefs` | an outage read as a quiet news day: `fetchNewsForTicker` **resolved** `[]` on error, so the failure counter never moved | rejects on failure. A payload with no `news` array is schema drift and also a failure (M1) |
| `/api/briefs/[sector]` | **$0.00** and "flat 0.00%", with the outage blamed on "Market may be closed" | price and change are `null` and render `—`, and the note names the failed feed. P/E is read from the **quote**, where Yahoo puts it for an ETF, so a healthy day reads **live** (verified against live Yahoo, technology and energy, 2026-10-16) |
| `/api/darkpool/[ticker]` | zero-filled quote; an outage explained as "not available for this security type (ETF, ADR, or OTC)" | nullable quote, `degraded`, and a note naming the failure. The genuine no-data note no longer guesses a security type. It used to say "ETF, ADR, or OTC" for AAPL (L9) |
| `/api/ma-deviation` | 13 error rows (11 sectors plus SPY and QQQ) with no top-level signal, cached for 5 min in the module and at the CDN | `degraded` when most **fetches** fail (`insufficient_data` no longer counts), with the message "of 13 instruments". Not module-cached |
| `/api/news/[sector]` | "No recent news" during an outage; every headline undated, because it read `publishedAt` while Yahoo sends `providerPublishTime` | failures and schema drift counted; dated through the shared `lib/news/publishTime.ts` (L12) |
| `/api/sector-rotation` | a partial ranking presented as *the* ranking, CDN-cached for 1 h | `degraded` on any fetch failure |
| `/api/conditional-vol`, `/api/regime` | a dead GARCH or HMM service hidden; the EWMA fallback labelled `GARCH(1,1)`; the rule fallback returning **constant "posterior probabilities"** (0.65 / 0.175 / 0.175) | `degraded` when the configured service fails; `model: 'EWMA(0.94)'`; `probabilities: null` from a rule. A rule has no posterior (H2) |
| `/api/ml/[ticker]` | "not deployed" and "deployed but failing" returned the same body | `reason: not_configured` versus `degraded` |
| `/api/bloomberg-bridge/health` | the authenticated probe said `status: 'ok'` beside `reachable: false` | `degraded`. The unauthenticated answer stays constant by design |
| `/api/crypto/btc/metrics` | wire fields `takerBuyVolume` / `takerSellVolume` carried Bybit's **account** buy/sell ratios | renamed `accountBuyRatio` / `accountSellRatio` (AC3, M3). Nothing rendered them |

**Cache policy for degraded answers (M4).** The first version sent `no-store`. That removed all damping exactly when Yahoo is most likely throttling: about 27 chart calls per MA-board request, at up to 10 requests a minute per IP. Degraded 2xx answers now share `DEGRADED_CACHE_CONTROL` (`s-maxage=30, stale-while-revalidate=60`, in `lib/api/reliability.ts`), which is the briefs route's existing degraded policy. Every cached copy still carries `degraded: true`. An `unavailable` brief no longer sits at the CDN for the healthy minute (L8).

## Consumers: a degraded answer nobody reads is the defect itself

**How the guard finds consumers.** Consumers are now the UI files **a page can render**: the import graph reachable from `app/` surfaces, using `importGraph.ts`. `components/SectorRotationPanel.tsx`, which nothing had rendered since PR #41, no longer counts as a consumer and is deleted (K1).

**How it checks them.** Each **fetch site** must handle a non-2xx answer itself, because every route has a 429 path. That means one of:
- a `.ok` inside a window after the route literal (2,000 characters, measured; the farthest legitimate check is useBtcCandles at about 1,650);
- `fetchJsonSafe`;
- the named SWR fetcher.

The window ends at the next unrelated `/api/` literal. The red-team's mutation is an executable test: a sibling fetch's `.ok` no longer covers another route. Routes that fail as a 2xx must also have their flag read.

**Consumers fixed:**
- **Landing page.** A failed `/api/prices` now raises the price-refresh notice; before, the 500 body parsed and nothing was said. A 429 or 502 from `/api/briefs` reads "Unavailable · Yahoo Finance" with a reason, not "Live … 0 articles". Both cases are pinned by a jsdom render test.
- **Stock page options tab.** "Options data failed to load (…)" replaces "No options data available" for an outage.
- **Extended analytics.** The tab says why the box is empty.
- **LLM health check.** A 429 or 5xx from our own status route says the backend's state is unknown, not that the backend is unreachable.
- **`BtcQuantLab` funding notice, `/heatmap`, `/commodities`, the sector and stock dark-pool fetches, `NewsFeed`.** All were fixed in the first version. `NewsFeed` now also treats "every item malformed" as a failure, not "no recent news" (M2).

**Q-094:** `NewsFeed` parses its payload with zod (`lib/news/newsPayload.ts`).

## The sector brief now asks Yahoo only for what it answers

Measured on all 11 sector ETFs (2026-10-16):
- the summary returns only `defaultKeyStatistics`, holding fund fields (`beta3Year`, `yield`, `totalAssets` …);
- there is no `trailingPE`, no `beta`, no `financialData` and no `recommendationTrend`;
- the quote carries `trailingPE` and the 10-day volume.

**Consequences:**
- **Dead code removed.** The brief's analyst-consensus block, with its BUY/SELL badge and price target, and the never-populated forward P/E, PEG and price/book could never render in production. They are removed. That also takes a BUY/SELL label off a sector page (Q-083).
- **Fund yield is shown.** It comes from the fund's `yield`.
- **Beta is not shown.** Yahoo's `beta3Year` for XLE was −0.03, which is implausible, and an unverifiable number should not reach the screen.
- **Neutral colouring.** P/E is coloured neutral; colouring a low P/E "positive" is a valuation judgment.
- **Honest test fixture.** The healthy fixture is now the real response shape, with synthetic values.
- **Wording.** The footer and summary no longer guess the market phase (K2, L7).

## Tests that asserted the defects

| Test | What it pinned |
|---|---|
| `sectorBrief.test.ts` | `price === 0` and "Market may be closed" on a dead upstream |
| `sectorBrief.test.ts` | empty news makes the brief "partial" (Q-091 itself) |
| `sectorBrief.test.ts` | a healthy fixture carrying fields Yahoo never sends for an ETF, so the healthy path was tested on impossible data (B1) |
| `regimeHmmClient.test.ts` | the fabricated probabilities |
| `garchClient.test.ts` | `model: 'GARCH(1,1)'` for an EWMA estimate |
| `degradedRoutes.test.ts` | the "ETF, ADR, or OTC" guess as the correct no-data note |
| `fail-closed-routes.test.ts` (first version) | the brief's `partial` accepted as a failure signal, although it was also the healthy steady state (H1) |

All are replaced. (`search.test.ts` and the `GlobalSearch` jsdom test belong to Q-118, PR #231, not to this package.)

## Mutations

Every mutation below was applied to the committed tree, its targeted tests were run, and the file was restored. A mutation whose target string did not match exactly once was refused rather than counted. M05 was refused on its first attempt and re-run with a unique target.

| # | Mutation | Killed by |
|---|---|---|
| M01 | landing `/api/prices` ignores non-2xx | fail-closed guard, landing render test |
| M02 | landing `/api/briefs` drops its non-2xx branch | landing render test |
| M03 | options tab ignores non-2xx | fail-closed guard |
| M04 | extended analytics ignores non-2xx | fail-closed guard |
| M05 | LLM health check ignores non-2xx | fail-closed guard |
| M06 | GARCH fallback not marked degraded | fail-closed guard, `garchClient.test.ts` |
| M07 | HMM fallback not marked degraded | fail-closed guard, `regimeHmmClient.test.ts` |
| M08 | HMM fallback fabricates probabilities again | `regimeHmmClient.test.ts` |
| M09 | EWMA fallback labelled `GARCH(1,1)` again | `garchClient.test.ts` |
| M10 | brief reads P/E only from the summary (B1) | `sectorBrief.test.ts` |
| M11 | dead brief says `partial` (H1) | fail-closed guard |
| M12 | trading-agents health reports a dead backend `ok` (H3) | fail-closed guard |
| M13 | `/api/news/[sector]` treats a missing news array as quiet | `degradedRoutes.test.ts` |
| M14 | `/api/briefs` treats a missing news array as quiet | `degradedRoutes.test.ts` |
| M15 | `NewsFeed` says "no news" when every item is malformed | `NewsFeedDegraded.test.tsx` |
| M16 | degraded MA board uses the healthy cache window | `degradedRoutes.test.ts` |
| M17 | dark-pool note guesses the security type again | `degradedRoutes.test.ts` |
| M18 | publish time ignores `providerPublishTime` | `newsPublishTime.test.ts` |
| M19 | BTC metrics notice deleted (C1) | `BtcQuantLabMetricsDegraded.test.tsx` |
| M20 | sector-rotation degraded without its flag | fail-closed guard, `degradedRoutes.test.ts` |

**20 of 20 killed.** C1 is killed only by the render test; the guard alone cannot see it, which is its stated CANNOT-DO.

## Named residuals

- **SSE routes are exempt from the behavioural run.** `/api/stream` signals failure in-stream.
- **The flag read is bound to a file, not a payload.** A consumer that imports a module reading another route's flag passes (mutation C1). Reads that matter are pinned by render tests.
- **The status check is bound to a window, not to the response variable.** A `.ok` on an unrelated object inside the window counts.
- **A URL built in one module and fetched in another is checked where the literal is.**
- **`.env.example` does not document `ML_SIDECAR_URL` or `QUANT_FRAMEWORK_URL`.** Env files are owner-edited.
- **The hydration error #418 on `/briefs`** is Q-142 (PR follows).
