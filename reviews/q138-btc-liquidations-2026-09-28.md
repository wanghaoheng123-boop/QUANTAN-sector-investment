# Q-138 — every number on the BTC liquidations panel was wrong, each in a different way

**Date:** 2026-09-28 · **Ticket:** Q-138 · **Ledger:** Q138-1 … Q138-6
**Kind:** migration note. A displayed calculation changes (USD volumes fall by exactly 100×), and so do the
wire semantics on failure (`0` → `null`).

## What was wrong

`/api/crypto/btc/liquidations` feeds the Liquidations tab and the "Analysis" grid of `components/crypto/BtcQuantLab.tsx`
on `/crypto/btc`. Measured on 2026-09-28 against OKX directly:

| # | Claimed | True | Cause |
|---|---|---|---|
| 1 | "$101.7M" of short liquidations | **≈ $1.02M** | `sz` on OKX swaps is **contracts**. BTC-USDT-SWAP `ctVal` is 0.01 BTC (`/api/v5/public/instruments`), so notional = `bkPx × sz × 0.01`. The route summed `bkPx × sz`, which is **100× too large** |
| 2 | "Large Trades **(24h)**" | the last **≈ 1.4 hours** | OKX's `limit` caps the number of liquidation *details* (verified: limit 1/5/20/100 returned exactly that many). The route asked for 100 and got 100 back. Nothing told the user the window was cut |
| 3 | "**>$100k notional**" | no filter exists | The smallest order in the sample was under $10 after correct scaling. The card counted every liquidation |
| 4 | "Buy (**Long** Liq)" / "Sell (**Short** Liq)" | swapped | A forced **buy** closes a **short**. The route's `buyVolume` was already short liquidations; the labels paired it with "Long" |
| 5 | Analysis card "**OI** Net Direction": `LONG_BIAS` → "MORE AGG **BUY** VOLUME" | liquidation bias, inverted | It is not open interest. `LONG_BIAS` means *longs were force-sold*, the opposite of the text |
| 6 | OKX outage → "0 · $0.0M · NEUTRAL" | unknown | Every failure path answered HTTP 200 with zeros beside `degraded: true`, and **no client read `degraded`**. A broken feed rendered as a calm market |
| 7 | Section header "**On-Chain** & Derivatives Metrics" | exchange-reported | Funding, open interest and liquidations come from Bybit and OKX, not from the chain |

## What changed

- `lib/data/providers/okxLiquidations.ts` (new, pure): `summariseLiquidations(rows, now)`.
  - Filters rows to `instId === 'BTC-USDT-SWAP'`, because the contract size is specific to it.
  - Prices with `BTC_USDT_SWAP_CT_VAL = 0.01` (a cited constant).
  - Returns `windowStart` (the oldest liquidation counted) and `truncated` (OKX's cap was hit).
  - Drops `largeTradeCount`, which was named for a size filter that never existed.
  - It lives outside the route because an App Router route may export only handlers and config; `tsc` over
    `.next/types` rejected the first draft.
- **Wire:** on every failure path the route returns `null` for each figure, plus `degraded: true` and
  `userMessage`. It stays **HTTP 200**: on a non-2xx, `fetchJsonSafe` skips `setLiq`, and the *last good*
  numbers would stay on screen unmarked. A valid response with no rows is still a measured `0`.
- `lib/liquidationDisplay.ts` (new, pure) holds the card labels, units (K/M/B), window label, bias wording and
  `—` for unknown. The component renders from it and shows `userMessage` when `degraded` is set.

## Verified against an independent source, not against the old display

At the same moment I pulled OKX directly and computed Σ `bkPx × sz × 0.01` by side, the count and the oldest
timestamp. Then I compared that with the route running in a local production build:

| | Independent | Route |
|---|---|---|
| count / long / short | 100 / 23 / 77 | 100 / 23 / 77 |
| long USD / short USD | $166,283 / $997,534 | $166,282.66 / $997,533.59 |
| oldest counted | 12:54:59.721Z | 12:54:59.721Z |
| truncated | 100 = cap | `true` |

The panel rendered "100 · last 1.5h only (OKX returns the latest 100)", "$166.3K · 23 orders",
"$997.5K · 77 orders", "Shorts liquidated more", and in the Analysis grid "Liquidation Bias · SHORTS FORCE-BOUGHT".

## Tests and mutations

The fixtures are **hand-built**, with every expected value computed in a comment. Nothing is a captured OKX
payload: the repository is public, and committing vendor data would be redistribution (I8).
12 mutations, all fail as designed:

| Area | Mutations |
|---|---|
| Route and summariser | `ctVal` back to 1; long/short mapping swapped; instrument filter removed; truncation off by one; a failure path answering `0` again, or `NEUTRAL` again |
| Display | long card showing the buy side; `LONG_BIAS` reading "buy volume" again; window hardcoded to 24h; a null count rendered as 0 |
| Component | original component restored; degraded banner removed |

My first retired-label scan was case-sensitive and missed "On-Chain" in the section header. The rendered page
showed it. The scan is now case-insensitive.

## Named residuals

- **The window is still at most 100 liquidations.** Paginating OKX would be a new feature against a 12s
  timeout, so the label says what is covered instead of widening it.
- **`degraded` is still unread on two other routes.** `/api/crypto/btc/metrics` sets it, and so does
  `/api/briefs`, where the landing page shows a silently thinned news list. A guard that defines producers as
  "routes that already set `degraded`" would repeat the cache-flag defect: it could not see a route that fails
  silently without the flag. That needs a structural detector, not a string match. → **Q-140**.
- `metrics` names Bybit's account `buyRatio` as `takerBuyVolume` on the wire. Nothing renders it today.
  → Q-140 notes.
