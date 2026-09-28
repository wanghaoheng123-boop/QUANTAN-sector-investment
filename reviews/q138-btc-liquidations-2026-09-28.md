# Q-138 — every number on the BTC liquidations panel was wrong, each in a different way

**Date:** 2026-09-28 · **Ticket:** Q-138 · **Ledger:** Q138-1 … Q138-6, Q138-R1 … R7, Q138-R2-1 … R2-6
**Kind:** migration note. A displayed calculation changes: USD volumes fall by exactly 100×. The wire
semantics on failure change too, from `0` to `null`.

## What was wrong

`/api/crypto/btc/liquidations` feeds the Liquidations tab of `components/crypto/BtcQuantLab.tsx` on
`/crypto/btc`, and fed one card in its "BTC Quant Signals" grid. Checked against OKX directly on 2026-09-28:

| # | Claimed | True | Cause |
|---|---|---|---|
| 1 | "$101.7M" of short liquidations | **≈ $1.02M** | `sz` on OKX swaps is **contracts** (OKX field doc: "For FUTURES/SWAP, the unit is contract"). BTC-USDT-SWAP `ctVal` is 0.01 BTC (`/api/v5/public/instruments`), so notional = `bkPx × sz × 0.01`. The route summed `bkPx × sz`, which is **100× too large** |
| 2 | "Large Trades **(24h)**" | the latest 100, ≈ 1.4h | The route reads **one page**, and OKX's `limit` caps the details at 100 (verified: limit 1/5/20/100 return exactly that many, and 150 returns error 51000). OKX logged ≈ 1,640 BTC-USDT-SWAP liquidations in the trailing 24h |
| 3 | "**>$100k notional**" | no filter exists | The card counted every liquidation |
| 4 | "Buy (**Long** Liq)" / "Sell (**Short** Liq)" | swapped | A forced **buy** closes a **short** |
| 5 | Signals-grid card "**OI** Net Direction": `LONG_BIAS` → "MORE AGG **BUY** VOLUME" | liquidation bias, inverted | It is not open interest, and `LONG_BIAS` means *longs were force-sold* |
| 6 | OKX outage → "0 · $0.0M · NEUTRAL" | unknown | Failure paths answered HTTP 200 with zeros beside `degraded: true`, and **no client read `degraded`** |
| 7 | "**On-Chain** & Derivatives Metrics", a nav hint reading "on-chain metrics", and an Analysis intro claiming "on-chain derivatives data" | exchange-reported, and the Analysis tab reads none of it | No on-chain metric renders anywhere on the site |

## What changed

- **`lib/data/providers/okxLiquidations.ts`** (new, pure):
  - `summariseLiquidations` filters to `BTC-USDT-SWAP` and prices at the cited `BTC_USDT_SWAP_CT_VAL`.
  - It classifies by `side` (one-way `posSide: net` included) and counts **unreadable** and **contradictory** records; either degrades the response (round 2).
  - It reports `windowStart`, and `truncated` judged on what OKX *returned*.
  - `liquidationFeedProblem` decides whether a well-formed response is a measurement at all (below).
  - It lives outside the route because an App Router route may export only handlers and config. `tsc` over
    `.next/types` rejected the first draft.
- **Route.** Every failure path the route can see returns `null` for each figure, plus `degraded: true` and
  `userMessage`, at HTTP 200. That includes a well-formed response judged unusable.
- **`lib/liquidationDisplay.ts`** (new, pure):
  - labels, units (K/M/B chosen after rounding), the window label ("latest 100 only · last 6m") and the bias
    wording;
  - a scope note (one contract, USDT, possibly incomplete);
  - `nextLiqState`, the only transition the client uses.
- **`components/crypto/LiquidationsPanel.tsx`** (new): the tab as a props-only component, rendered in tests.
- **The Signals-grid bias card is removed.** It was coloured and undated beside "BUY THE DIP", but its window
  is ≈ 1.5h. On 2026-09-28 it flipped within minutes while the trailing 24h pointed the other way. It is shown,
  with its window, only on the Liquidations tab.

## Verified against an independent source, not against the old display

Twice, each time pulling OKX directly at the same moment as the route under a local production build and
computing Σ `bkPx × sz × 0.01` by side:

| | Independent (1) | Route (1) | Independent (2) | Route (2) |
|---|---|---|---|---|
| count / long / short | 100 / 23 / 77 | 100 / 23 / 77 | 100 / 100 / 0 | 100 / 100 / 0 |
| long / short, USDT | 166,283 / 997,534 | 166,282.66 / 997,533.59 | 917,152 / 0 | 917,151.95 / 0 |
| oldest counted | 12:54:59.721Z | same | 14:42:50.212Z | same |

The red team reproduced (1) independently and confirmed the 100× error against production's old output.

## Red-team round 1

It could not break the units, the side mapping, the `limit` semantics, OKX's ≈ 24h retention or the
figures. What it broke was two display paths and five sentences this package wrote about itself:

| Id | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | HIGH | A well-formed `code: '0'` response whose details were all dropped (a missing `instId`, a renamed `sz`) rendered "0 · Balanced". The endpoint is **not in OKX's current v5 docs**, so drift is a live risk, and "a valid empty response is a measured 0" was wrong at a base rate of ≈ 1,640 a day | `liquidationFeedProblem`: no row for the instrument, any unreadable record, or nothing counted each **degrade** |
| R2 | HIGH | The bias card was an undated, coloured signal in the Quant Signals grid, not "the Analysis grid" as this note first said | Removed from the grid |
| R3 | MEDIUM | "Every failure path returns nulls" was false as worded. A 429, a platform 5xx or a client network error never reach the route, and the last good numbers stayed with nothing on the panel. Keeping stale data on a degraded answer was also untested | `nextLiqState`: a route answer always replaces the figures, and any other failure keeps them only marked, with the reason. Tested through a real render |
| R4 | MEDIUM | The count implied completeness: one contract only, and "OKX returns the latest 100" blamed OKX for the route's single page | Scope note on the panel; the window label now says "latest 100 only" |
| R5 | MEDIUM | Coverage overstated. Banner and fail-closed claims were source-substring checks, and a trailing `// …` comment could satisfy them. A1–A3 were untested | `react-dom/server` render tests, a comment stripper that removes trailing comments, and tests for A1–A3 |
| R6 | MEDIUM | The rewritten Analysis intro still claimed derivatives inputs, but the Analysis tab reads only the candles | Rewritten to list what it reads and say what it does not |
| R7 | MEDIUM/LOW | Records and details: the backlog marked Q-138 done before any production check. The code comment said "documented maximum" when the cap is empirical. `bkPx` was called the bankruptcy price with "USD" notional. "Last updated: just now" appeared beside a failure. `$1000.0K` at unit boundaries. Nav still said "on-chain". Two ledger citations used the wrong tree's lines. The display fixture reused live figures without a derivation | All fixed. The backlog stays `partial` until the post-deploy check. The display fixture is now hand-made round numbers |

*(Round 2 revised the net-mode handling below: counting `posSide: net` as "unclassified" was itself the
next defect.)*

## Tests and mutations

The fixtures are hand-built, with every expected value derived inline. Nothing is a captured OKX payload:
the repository is public, and committed vendor data would be redistribution (I8). There are **20 mutations**,
all failing as designed, including every one the red team showed surviving:
- A1 (truncation judged on the counted details)
- A2 (the total counting only long + short)
- A3 (side ignored)
- A5 and A6 (banner blanked or disabled)
- A7 (stale figures kept on a degraded answer)
- A8 (card value and sub swapped)
- A15 (a trailing comment standing in for the real call)
- the feed-problem check removed
- the bias card restored to the signals grid
- the formatter boundary
- the original component restored

## Named residuals

- **The window is at most 100 liquidations.** Paging with OKX's `after` parameter covered 24h in 18 pages
  (≈ 7s from Singapore; not measured from the Vercel region) and would be a feature, so the label says what
  is covered instead.
- **`degraded` is still unread on two other routes**, `/api/crypto/btc/metrics` and `/api/briefs`. A guard
  that finds producers by the flag they already set cannot see a route that fails silently without it. That
  needs a structural detector. → **Q-140**
- A sticky client banner (`derivativesError` is never cleared on success) and a CDN that serves success
  bodies up to ≈ 30s old both predate this package. → Q-140 notes.

## Red-team round 2 — the "unclassified" disclosure was the next defect

Round 2 could not break the round-1 degrade rules on real data. They are not too eager: 0 unreadable
records in 1,734 BTC-USDT-SWAP details over 24h, and none in 2,987 across 150 other underlyings. The
largest gap between liquidations was 132 minutes. It also could not break the `nextLiqState` transitions,
the render tests, the comment stripper on the current tree, the config guard after the helper move, the
scope note, the nav hint, or re-verification (2). It broke these:

| Id | Severity | Finding | Resolution |
|---|---|---|---|
| R2-1 | HIGH | A response made entirely of `posSide: net`, a value OKX documents for one-way mode, rendered "Balanced" with no flag. The round-1 fix degraded on an *unobserved* unreadable record but left the *documented* case open. The note's "disclosed on the card" was overstated: the bias card beside it contradicted it | `net` is **classified by `side`**, since a forced sell closes a long in either mode. A genuinely contradictory pairing (a long closed by a buy) now **degrades**. "Unclassified" is gone from the card and the wire |
| R2-2 | MEDIUM | The I2 cache-flag guard for this panel passed only because of an import left over from the liquidations tab. Deleting the dead import turned CI red, while `cached={false}` stayed green | The panel now **owns its fetch, state and polling**, so the file that reads `_cached` renders the badge. The lab renders a real badge for its *own* metrics cache flag instead of the text "(cached)" |
| R2-3 | MEDIUM | "Tested through a real render" was overstated. The lab-to-panel wiring was checked by substring: an early `return` before the transition, `fetched={false}` and `cached={false}` all survived | No wiring is left in the lab (it holds no liquidation state). The container is tested in **jsdom** with a mocked `fetch`: a good answer, a 429 after a good answer, a degraded answer after a good one, and a network error with nothing to keep. A Refresh button makes the second fetch drivable |
| R2-4 | MEDIUM | "This analysis reads only the daily candles" is false when the chart was last loaded at another timeframe. A reverted sentence could also hide behind a JSX comment placed after an apostrophe, because the tokenizer was not JSX-aware | The sentence now names the dependency: "last loaded on the Chart tab (daily unless you changed the timeframe there)". `stripComments` now uses the **TypeScript emitter** (`removeComments`, JSX preserved) instead of a hand tokenizer. The pre-existing "200-Day" and "20-week" labels on that tab are Q-141 |
| R2-5 | LOW | A frozen feed (newest record 20h old) rendered unflagged. Timestamps in seconds degraded with the wrong reason. "Last attempt: —" appeared straight after an attempt. An empty 200 left a blank panel with no reason. Raw codes and an internal path reached users. A card under a new label could re-read the payload | A frozen-feed check (newest record more than 6h old, about 2.7× the measured 132-minute maximum gap). A precise "none dated within the last 24h" message. Every unknown carries its attempt time. `isLiqPayload` validates `ok` bodies. `friendlyFailure` produces user-facing wording. The lab may not reference the liquidation payload at all |
| R2-6 | LOW | "$" beside a note saying USDT, and one wrong ledger citation | Values now read "1.68M USDT". The citation is fixed |

**The "jsdom hangs locally" claim was false.** It was in CLAUDE.md, in memory, and in comments I wrote in
this package, and it is why I first built node-side render tests to work around it. The check I used to confirm
it ran `timeout 120 npx vitest …`, and macOS has no `timeout` command. It exited 127 instantly with no output,
which I read as a hang. All 15 component and hook test files (11 in jsdom) run locally in 3 seconds.

**Mutations, round 2: 19, all fail as designed.** They cover the reviewer's survivors (early return, badge,
`fetched`, Refresh, the S1 comment trick, X1) and every new check. Re-verified against a third independent
pull: 100/93/7, 1,676,725 / 6,548 USDT, identical oldest timestamp. The panel read
"latest 100 only · last 27m · 1.68M USDT · Longs liquidated more".
