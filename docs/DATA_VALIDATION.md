# Data accuracy, “jumping” numbers, and validation plan

## What is real vs illustrative

| Area | Source | Notes |
|------|--------|--------|
| Sector ETF prices (home, desk, tickers) | Yahoo Finance `quote` via `/api/prices` | Updates on your refresh interval; small moves are normal market ticks. |
| Stock charts | Yahoo `chart` via `/api/chart` | OHLC is vendor data; dark-pool **markers** on chart are synthetic placement for UI. |
| Quant Lab (DCF, bands, technicals, fundamentals) | Yahoo `quoteSummary` + `chart` via `/api/fundamentals` and `/api/analytics` | Formulas are implemented in `lib/quant/*`; inputs are Yahoo fields (see code comments). |
| “Top signals”, confidence, entry/target on home & sector cards | `lib/mockData.ts` | **Demo only** — deterministic RNG seeded by **UTC calendar day** (not a trading model). |
| Sparklines on sector cards | `generateSparkline` | Demo curve; same day-stable seed. |
| Dark pool **tables** / some news on stock page | `lib/mockData` | Labelled as illustrative in UI where applicable. |

Previously, demo signals used a seed that changed every **15 seconds**, which made numbers look like they were “hallucinating” or buggy. That was intentional randomness for a prototype, not live logic. It is now **stable until UTC midnight** so the UI matches user expectations.

## Root causes addressed (jumping / confusion)

1. **Signals regenerated every 15s** on the home page alongside price refresh — fixed: only **prices** re-poll; signals set once per page load (still day-stable if you refresh tomorrow).
2. **Sparklines used the same 15s bucket** — fixed: **daily** seed in `mockData.ts`.
3. **Search capped at 5 results** — fixed: `/api/search` requests up to **50** Yahoo quotes (client asks for 40), filters non-tradeable types, uses `new YahooFinance()` like other routes.

## 50-sample check (automated)

From the project root (requires network):

```bash
npm run validate:data
# or: node scripts/validate-data-samples.mjs
```

This calls Yahoo `quote` for a diversified list of US symbols (megacaps, ETFs, some mid/small). It prints JSON with `ok` and `fail` arrays. Occasional failures are usually symbol formatting (e.g. `BRK.B` vs `BRK-B`) or Yahoo throttling — adjust symbol and retry.

**Not a performance backtest:** this script does not compute returns or strategy P&amp;L; it validates **data plumbing** (symbol resolves, finite positive `regularMarketPrice`).

## Plan for deeper correctness (optional next steps)

1. **Replace demo signals** with a rule-based overlay derived from real data (e.g. RSI/MACD from `/api/fundamentals` payload) so “signals” match Quant Lab.
2. **Sparklines** from last N closes of real `chart` for each sector ETF (small server route or embed in `/api/prices`).
3. **Rate limits:** add caching headers or Redis for `quote` in production if traffic grows.
4. **Upgrade Next.js** past 14.2.5 per security advisory (see npm warning).
5. **Unit tests** for `lib/quant/*` with frozen Yahoo-shaped fixtures.

## Compliance

Yahoo Finance data is subject to Yahoo’s terms; this app is informational only — not investment advice.
