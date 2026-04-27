# 200EMA Ranking Panel — Feature Specification

## 1. Overview & Motivation

The 200EMA Ranking panel ("EMA Strength Leaderboard") is a live, sortable table that ranks individual stocks by how strongly they are positioned relative to their 200-day exponential moving average. It gives traders and portfolio managers a single consolidated view of which names are in the most bullish vs. bearish long-term configurations across the investable universe — without needing to open 500 individual stock pages.

**What it is NOT:** A trade signal generator. It is a screening and situational-awareness tool. The Four Pillars framework (EV/Kelly, margin of safety, regime context, convexity) should be applied after the screen identifies names worth further analysis.

---

## 2. What the Page Shows

### Columns

| Column | Description | Source |
|---|---|---|
| **Rank** | 1 = closest above 200EMA and best slope; N = worst | Computed |
| **Ticker** | Stock symbol, clickable → `/stock/[ticker]` | Input list |
| **Price** | Last regular market price | `/api/prices` |
| **200EMA** | Current 200-day EMA value | Computed from `chartYahoo` 1Y daily |
| **EMA Δ%** | `(price − EMA200) / EMA200 × 100` — positive = above EMA | Computed |
| **EMA Slope** | `(EMA200_now − EMA200_20bars_ago) / EMA200_20bars_ago × 100` | Computed |
| **RSI(14)** | 14-period Wilder RSI from latest closes | Computed |
| **20EMA** | Current 20-day EMA (near-term anchor) | Computed |
| **20/200 Slope Diff** | `(EMA20_slope − EMA200_slope)` — momentum acceleration | Computed |
| **Zone** | One of 7 regime labels (Extreme Bull → Crash Zone) | `ma200Regime()` |
| **1D %** | Session change from prior close | `/api/prices` |
| **Market Cap** | In billions | `/api/prices` |

### Additional UI Elements

- **Zone badge**: color-coded pill matching the `ma200Zone` color from `lib/quant/technicals.ts`
- **Sparkline**: 30-bar (6-week) mini price chart inline in each row (using lightweight-charts or SVG path)
- **Live poll indicator**: pulsing green dot with last-updated timestamp in the header
- **Sorting**: Default sort by `EMA Δ%` descending (strongest above 200EMA first); click any column header to re-sort
- **Filter bar**: text input to filter by ticker substring; sector dropdown to filter to one of the 11 GICS sectors
- **Pagination**: 50 rows per page; total universe is configurable (default: S&P 500)

---

## 3. Algorithmic Calculation — Ranking Formula

### 3.1 Per-Ticker Data Requirements

For each ticker in the universe, the server-side computation requires:

- **310 trading days** of daily OHLCV closes → enough to compute EMA(200) with a 20-bar EMA slope lookback
- **Current quote** from Yahoo Finance (for live price and 1D change)

### 3.2 EMA200 Deviation Score

The primary ranking metric is:

```
ema200_deviation_pct = (price - ema200) / ema200 * 100
```

This is computed identically to `sma200DeviationPct()` in `lib/quant/technicals.ts`, but using EMA(200) instead of SMA(200). The EMA smoothing constant is:

```
k_200 = 2 / (200 + 1) = 2/201 ≈ 0.009950
```

### 3.3 EMA200 Slope Score

Slope measures the 20-bar rate of change of the EMA itself — positive slope means the long-term trend is rising; negative means it is rolling over:

```
ema200_slope = (ema200_current - ema200_20bars_ago) / ema200_20bars_ago * 100
```

Requires closes array of ≥ 220 bars (200 + 20 lookback).

### 3.4 Combined Ranking Score

The composite score is a **weighted sum of two normalized components**:

```
score = 0.65 * ema200_deviation_normalized + 0.35 * ema200_slope_normalized
```

**Normalization:** Each component is z-scored across the current universe, then clipped to [−2, +2] to prevent outlier domination, then rescaled to [0, 100]:

```
normalized = clamp((value - universe_mean) / universe_std, -2, 2)
rescaled = (normalized + 2) / 4 * 100
```

**Why this weighting?** The 200EMA deviation (65%) is the primary signal — how far price has run above or below the key institutional benchmark. The slope (35%) is the secondary confirmation — it filters out "dead cat bounce" names that are above the EMA but with a collapsing long-term trend. This weighting reflects institutional practice where both displacement AND trend direction matter.

**Tie-breaking:** When scores are within 0.1 of each other, the tiebreaker is `ema200_slope` descending (steeper positive slope wins).

### 3.5 RSI(14)

Standard Wilder RSI, computed from the closes array using the same formula as `lib/quant/technicals.ts`.

### 3.6 20/200 Slope Differential

```
slope_diff = ema20_slope_20bar - ema200_slope_20bar
```

Positive diff = short-term momentum accelerating faster than long-term; negative diff = short-term momentum decelerating or reversing.

### 3.7 Zone Classification

Uses the existing `ma200Regime()` function from `lib/quant/technicals.ts`, adapted to use EMA(200) instead of SMA(200) for the deviation and slope calculations.

### 3.8 Summary of Formulas

| Metric | Formula | Notes |
|---|---|---|
| `ema200` | EMA(closes, 200) | Wilder smoothing, k=2/201 |
| `ema20` | EMA(closes, 20) | k=2/21 |
| `ema200_deviation_pct` | `(price − ema200) / ema200 × 100` | |
| `ema200_slope_pct` | `(ema200_now − ema200_20ago) / ema200_20ago × 100` | |
| `ema20_slope_pct` | `(ema20_now − ema20_20ago) / ema20_20ago × 100` | |
| `rsi14` | Wilder RSI(closes, 14) | |
| `score` | `0.65 × norm(ema200_dev) + 0.35 × norm(ema200_slope)` | z-score, clipped ±2σ |
| `zone` | `ma200Regime(price, closes, rsi14)` | Uses EMA internally |

---

## 4. Stock Universe

### Default: S&P 500 Constituents

The default universe is the **S&P 500 list**. A static array of S&P 500 tickers is stored in `lib/spy500.ts`. This list is updated manually when constituents change (typically quarterly).

**Rationale:** S&P 500 is the most widely-used institutional benchmark. Ranking within the S&P 500 makes the output immediately actionable for US equity managers. If a user wants a different universe (e.g., custom watchlist), they can replace the import in the API route.

### Universe Config

```typescript
// lib/spy500.ts
export const SPY500_TICKERS: string[] = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'AAPL', ... // ~505 tickers
]
```

The API route also accepts an optional `?universe=` query param:
- `universe=sp500` (default) — full S&P 500
- `universe=sector` — 11 GICS sector ETFs only (XLK, XLE, etc.)
- `universe=desk` — the current `DESK_TICKERS` (~17 tickers: sector ETFs + SPY/QQQ/IWM/DIA/VIX + commodities)

---

## 5. Data Flow

### 5.1 Server-Side API Route (New)

**New file:** `app/api/ema-ranking/route.ts`

```
Client                    API Route                   Yahoo Finance
  |                             |                             |
  |-- GET /api/ema-ranking ---> |                             |
  |                             |-- Promise.allSettled ------> | (batch chart fetch, 1Y daily)
  |                             |   (310 calendar days)       |
  |                             |<-- OHLCV quotes (per ticker)|
  |                             |                             |
  |                             |-- compute EMA200, slope,   |
  |                             |   score, zone, rsi14, etc.   |
  |                             |-- cache result (5 min TTL)  |
  |<-- JSON: rows[] -----------|                             |
  |   (ranked, sorted)          |
```

**Cache:** In-memory `Map` with 5-minute TTL (300,000ms). Yahoo Finance rate limits are the primary constraint — batch-fetching 500 tickers at once risks 429 responses. The implementation uses `Promise.allSettled` with a concurrency cap of 20 simultaneous Yahoo requests, with 200ms delay between batches.

**CORS/cache headers:**
```
Cache-Control: public, max-age=60, stale-while-revalidate=240
CDN-Cache-Control: public, max-age=60, stale-while-revalidate=240
```

### 5.2 Client-Side Polling

| Data | Poll Interval | Source |
|---|---|---|
| EMA scores (rankings, EMA values) | 5 minutes | `/api/ema-ranking` |
| Current prices | 15 seconds | `/api/prices?tickers=...` |
| 1D change % | 15 seconds | `/api/prices?tickers=...` |

The EMA ranking does not need to be live (15s) because EMA(200) changes very slowly — it takes a significant price move over many days to shift the 200EMA. A 5-minute refresh interval is sufficient for screening purposes. The quote polling at 15s keeps the price column fresh.

### 5.3 No WebSockets

The existing architecture uses HTTP polling throughout (`setInterval` in React `useEffect`). Introducing WebSockets would require a separate server process, a new deployment target, and additional infrastructure. Given that:
- EMA(200) changes at most ~0.1–0.2% per day in normal markets
- Yahoo Finance WebSocket feeds require paid subscriptions
- The existing infrastructure has no WebSocket support

HTTP polling at 5-minute intervals for EMA data and 15-second intervals for quotes is the correct trade-off.

---

## 6. UI/UX Design

### Visual Design

Follows the existing dark theme established throughout `antigravity-sectors`:

| Element | Value |
|---|---|
| Background | `#0a0a12` (dark slate-black) |
| Card/panel bg | `bg-slate-900/60` |
| Borders | `border-slate-800` |
| Text primary | `text-white` |
| Text secondary | `text-slate-400` |
| Text muted | `text-slate-500` |
| Font: numbers | `font-mono` (JetBrains Mono) |
| Font: headings | Inter (400–700) |
| Positive values | `text-emerald-400` |
| Negative values | `text-red-400` |
| Accent/highlight | `text-blue-400` |

### Layout

```
┌─────────────────────────────────────────────────────┐
│  200EMA Strength Ranking                    ● LIVE   │
│  S&P 500 · Sorted by EMA Δ% desc                  │
│  Filter: [________] Sector: [All ▼]  [Rank▾]     │
├─────────────────────────────────────────────────────┤
│ #  Ticker  Price   EMAΔ%  Slope  RSI  Zone  1D%   │
│─────────────────────────────────────────────────────│
│ 1  NVDA   $875   +18.3  +0.42  72  🟢 ExtBull  +2.1│
│ 2  MSFT   $415   +14.7  +0.31  68  🟠 ExtBull  +1.3│
│ 3  AMZN   $198   +12.1  +0.28  65  🟢 ExtBull  +0.8│
│ ...                                                  │
│ 498 F   $12.1   -28.4  -0.61  31  🔴 Crash   -3.2  │
└─────────────────────────────────────────────────────┘
         [Page 1 of 10]  < 1 2 3 ... 10 >
```

### Row Interactions

- **Hover**: entire row highlights with `bg-slate-800/40`
- **Click ticker**: navigates to `/stock/[ticker]`
- **Click column header**: sorts by that column, toggles asc/desc; active column shows sort arrow
- **Zone badge hover**: tooltip showing zone interpretation and forward return context

### Page Route

New page at `app/ema-ranking/page.tsx`, accessible from the global nav under "Markets" or as a standalone route.

---

## 7. Files to Create or Modify

### New Files

| File | Purpose |
|---|---|
| `lib/spy500.ts` | Static array of ~505 S&P 500 ticker strings |
| `lib/quant/emaRanking.ts` | Pure functions: `calcEma200()`, `calcEmaSlope()`, `calcRankingScore()`, `calcAllEmaMetrics()` |
| `app/api/ema-ranking/route.ts` | Server-side API: fetches Yahoo data, computes rankings, caches, returns JSON |
| `app/ema-ranking/page.tsx` | Next.js client component: fetches API, renders table with sort/filter/pagination |
| `components/EmaRankingTable.tsx` | Reusable table component with sort, filter, pagination, sparkline cells |
| `components/EmaRankingZoneBadge.tsx` | Zone label badge component with tooltip |

### Files to Modify

| File | Change |
|---|---|
| `app/layout.tsx` or `components/Nav.tsx` | Add `EMA Ranking` link to navigation under Markets section |
| `components/GlobalSearch.tsx` *(if exists)* | Add EMA Ranking to search results / quick-nav |
| `lib/quant/technicals.ts` | (Optional) Export `sma200Slope` and `sma200DeviationPct` for reuse; or replicate for EMA in `emaRanking.ts` — no changes strictly required |

---

## 8. API Route Specification

### `GET /api/ema-ranking`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `universe` | `sp500` \| `sector` \| `desk` | `sp500` | Which ticker list to rank |
| `limit` | number | `505` | Max tickers to process (for `sp500`) |
| `sort` | `emaDelta` \| `emaSlope` \| `score` \| `price` \| `rsi` \| `changePct` | `score` | Sort column |
| `order` | `asc` \| `desc` | `desc` | Sort direction |

**Response Shape:**

```typescript
interface EmaRankingResponse {
  universe: 'sp500' | 'sector' | 'desk'
  computedAt: string          // ISO timestamp
  cacheExpiresAt: string      // ISO timestamp
  totalTickers: number
  rows: EmaRankingRow[]
  disclaimer: string
}

interface EmaRankingRow {
  rank: number
  ticker: string
  price: number | null
  ema200: number | null       // current 200EMA value
  emaDeltaPct: number | null  // % above (+) or below (−) 200EMA
  ema200SlopePct: number | null  // 20-bar slope of EMA200
  ema20: number | null
  ema20SlopePct: number | null
  slopeDiff: number | null    // ema20Slope − ema200Slope
  rsi14: number | null
  zone: MA200Zone | null      // from ma200Regime()
  zoneLabel: string | null
  zoneColor: string | null
  dipSignal: DipSignal | null
  score: number | null        // composite 0–100
  changePct: number | null    // 1D session change %
  marketCap: string | null   // formatted string e.g. "1.2T"
  error?: string              // 'fetch_failed' | 'insufficient_data' | null
}
```

**Error Handling:**

- If Yahoo Finance returns an error for a ticker, that row is included with `error: 'fetch_failed'` and all EMA fields null — the rest of the table renders.
- If fewer than 220 closes are returned, `error: 'insufficient_data'` is set.
- HTTP 200 is always returned; errors are per-row, not per-request.

---

## 9. Priority Order for Implementation

### Phase 1: Foundation (highest priority)
1. **`lib/spy500.ts`** — Create the static S&P 500 ticker list (manually maintained ~505 tickers)
2. **`lib/quant/emaRanking.ts`** — Pure calculation functions (EMA, slope, score, zone)
3. **`app/api/ema-ranking/route.ts`** — Server API with Yahoo batch fetch and caching

### Phase 2: Core UI
4. **`app/ema-ranking/page.tsx`** — Basic page shell with API fetch and skeleton loading
5. **`components/EmaRankingTable.tsx`** — Sortable table with all columns

### Phase 3: Polish
6. **`components/EmaRankingZoneBadge.tsx`** — Colored zone badge with tooltip
7. **Add sparkline column** — 30-bar inline mini chart per row
8. **Filter bar** — ticker search and sector dropdown
9. **Pagination** — 50 rows/page
10. **Nav link** — Add to global navigation

---

## 10. Key Design Decisions & Trade-offs

### EMA vs. SMA
The existing `ma200Regime()` uses SMA(200). This feature uses EMA(200) for the deviation/slope calculations, while the zone labels still reference the SMA-based regime classification (since that classification is based on a large empirical dataset that used SMA). This is a minor inconsistency but is intentional: the SMA-based zones provide educational context; the EMA-based score provides more responsive technical screening.

### Yahoo Finance Rate Limits
Fetching 505 tickers × 310 days of data from Yahoo Finance simultaneously will trigger rate limits (HTTP 429). The API route must:
- Use `Promise.allSettled` (not `Promise.all`) so one failure doesn't reject the whole batch
- Limit concurrency to 20 simultaneous Yahoo requests
- Add 200ms delay between batches of 20
- Accept partial results (some tickers fail, table still renders)

If Yahoo rate limits remain a problem at scale, the next step is to pre-compute and store EMA values in a database (e.g., SQLite or Postgres) updated nightly, then serve live from cache during market hours.

### S&P 500 List Maintenance
The S&P 500 constituents change ~4–8 times per year (additions, removals, rebalancing). The `lib/spy500.ts` list must be manually updated when this happens. There is no automated constituent tracking in the current system.

### 5-Minute EMA Cache vs. 15-Second Quote Poll
The 5-minute cache for EMA rankings is appropriate because:
- EMA(200) is a slow-moving indicator — it moves at most ~0.1–0.3% per day under normal conditions
- Forcing a full Yahoo re-fetch every 15 seconds for 505 tickers would quickly hit rate limits
- The price column (1D change %) is still updated every 15 seconds via the `/api/prices` route

### Score Weighting (0.65 / 0.35)
The 65/35 weighting of deviation vs. slope is a judgment call based on institutional practice. Deviation alone can rank a stock that has run +30% above its 200EMA as #1 even if the 200EMA is rolling over — which would be a red flag. The slope component penalizes names with deteriorating long-term trends. These weights can be made configurable via URL params in a future iteration.
