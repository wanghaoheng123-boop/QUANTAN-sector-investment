# UX / Interface / Trading-View Review — Wave 1 REVIEW
**Program:** PLATFORM EXCELLENCE 2026-08-15 · **Expert:** UX/interface (Opus 5) · **Mode:** read-only
**Target:** https://quantan.vercel.app (prod, main @ b3773b6) · **Source:** worktree `sweet-dubinsky-4e07b2`
**Method:** browse each route with data loaded at 1280×720 and 375×812, then confirm root cause in source.

Audit environment note: browser TZ is `Asia/Singapore`, wall clock 2026-08-15 00:05 SGT =
2026-08-14 12:05 ET, so the US session is in RTH and every page below was audited **with live
data loaded**, not in an empty state.

Out of scope per brief (not re-flagged): auth env unset in prod, nav orphans / mobile header
height / homepage contrast / reduced-motion / SSE count (#138), axe violations (#139),
sector-card copy residuals + stale NEW badges, the F1.x–F8.x ledger, and any change to
published performance numbers.

---

## Findings

### `/` — home / sector dashboard

**Job the trader hires it for:** "which sectors are moving right now, and which one do I open
next." Glance test: **fails at 1280×720** — see UX-1.

---

#### UX-1 · P1 · One number, four contradictory labels — and on the hero cards, no label at all

**Evidence.** `lib/sessionSignalsFromQuotes.ts:34` computes
`confidence = min(98, round(42 + min(40, |Δ%| × 14)))` — a rescaled absolute session move,
explicitly *not* a probability. The 08-14 copy pass fixed exactly one of its four render
sites. Live at `/` the same field appears as:

| Surface | Rendered label | Anchor |
|---|---|---|
| "Largest session moves" cards | **no label at all** — a filled bar and a bare `64%` | `components/SignalCard.tsx:88-96` |
| Sector grid cards | "Session move size" + caveat tooltip (correct) | `components/SectorCard.tsx:152-176` |
| Market-overview stat tile | **"Avg Confidence" `48%`** | `app/page.tsx:348` |
| `/sector/[slug]` full signal card | **"Move scale"** (the pre-08-14 wording) | `components/SignalCard.tsx:62,152` |

`SignalCard` even computes `barLabel` at :62 and then never renders it in the `compact`
branch, so the homepage variant is label-less by omission, not by design.

Two further defects in the same encoding:
* The scale floors at **42**, so a sector that has not moved renders a 42 %-filled bar. Live
  proof: XLF at **−0.01 %** shows `Session move size 42%` — the bar can never read empty and
  is not proportional to anything.
* `SectorCard.tsx:169-175` sets `aria-label="Session move size {n} out of 100"` but renders
  the glyph `{n}%`. The accessible name and the visible text disagree about the unit.

Checked against the 08-14 "Observations recorded, not fixed" register (which lists only the
`Prior:`/`Last:`/`prior→last`/`Move scale` **sector-card** jargon, since fixed) and against
`reviews/findings-ledger.csv` — neither the "Avg Confidence" tile nor the unlabelled compact
bar is recorded anywhere.

**Impact.** A professional trader reads `64%` next to a green bar on the site's most prominent
cards as a 64 % confidence/probability in the direction shown; it is actually "today's move is
1.55 %", and 42 of those 64 points are a constant.

**Fix.** Make the label an SSOT next to the formula: export a `SESSION_BAR_LABEL` +
formatter from `lib/sessionSignalsFromQuotes.ts`, render it in the `compact` branch (the
already-computed `barLabel`), rename the stat tile to "Avg session move size" or replace it
with the far more useful **median |Δ%|** (`app/page.tsx:214-219` already computes
`medianAbsMove` and never renders it), and drop the `%` glyph in favour of `n/100`. Rebasing
the 42 floor to 0 is a number change → owner-gated; flag separately.
**Effort** S · **Confidence** high

---

#### UX-2 · P1 · The sector-grid filter still speaks BUY / SELL / HOLD while every card says UP / DOWN / NEUTRAL

**Evidence.** `app/page.tsx:451` renders the chips `['ALL','BUY','SELL','HOLD']`; the cards
they filter render `UP`/`DOWN`/`NEUTRAL` (`components/SectorCard.tsx:75-81`), and the section
above them is captioned "UP/DOWN = vs prior close — **not buy/sell advice**"
(`app/page.tsx:323`). Observed live: clicking **BUY** leaves the seven cards that read `UP`.
Not present in the 08-14 register or `findings-ledger.csv`.

**Impact.** The one control on the page that names an action re-introduces precisely the
buy/sell reading the rest of the page's copy was rewritten to prevent — a trader filtering
"BUY" believes they are seeing a recommendation list, not a list of sectors that happen to be
green today.

**Fix.** Relabel the chips `ALL / UP / DOWN / FLAT`, mapping through the same
`sessionDirectionLabel()` helper that already exists at `components/SignalCard.tsx:25-29`, so
the vocabulary has one source. **Effort** S · **Confidence** high

---

#### UX-3 · P1 · Nothing decision-relevant is above the fold; the first screen is a wordmark and a promo

**Evidence** (measured, `getBoundingClientRect()` + `scrollY` at 1280×720, data loaded):

```
fold                       720
nav                          0 –  57
price ticker                65 –  89
hero (pill + h1 + blurb)   ~150 – 380
"Institutional Backtest" promo card
                           412 – 574
"Largest session moves"    630 – 811   (heading at the fold; cards mostly below)
market-overview stat tiles 867 – 953
market breadth            1009 – 1170
ALL SECTORS grid          1226 – 1900  ← the product
```

The 11-sector grid — the reason the page exists — begins **506 px below the fold**. The
static hero (`app/page.tsx:286-291`) plus the promotional backtest card
(`app/page.tsx:295-316`) consume 424 px of a 720 px viewport and contain zero live numbers.
Total page height 3033 px.

**At 375×812 it is far worse** (measured, same method): the sector grid starts at
**y = 2191 — 1379 px below the fold, nearly three full screens of scrolling** — and the page
is 6381 px tall (7.9 screens). No horizontal overflow at either width, so the responsive
layout itself is sound; the problem is purely what occupies the top.

**Impact.** Every session starts with a scroll before a single sector price is visible; the
24 px ticker is the only live data a trader sees on load.

**Fix.** Collapse the hero to a single status line (the LIVE pill + timestamp already carry
all of its information), demote the backtest promo below the sector grid or to a nav item,
and lift the breadth bar + stat tiles above the signal cards. Target: the sector grid's first
row visible at 720 px. **Effort** M · **Confidence** high

---

#### UX-4 · P2 · Freshness timestamp has no timezone and no relative age, on a US-market product

**Evidence.** `app/page.tsx:284` renders `Updated ${lastUpdate.toLocaleTimeString()}`.
Observed live: `LIVE · Updated 00:05:40` while the US session was mid-RTH — correct in the
viewer's locale (browser TZ `Asia/Singapore`), but a bare wall clock with no zone label and no
"…s ago". `lib/format.ts:51` already exports `formatFreshness()` for exactly this and the
homepage does not use it.

**Impact.** A trader cannot tell from the badge whether the feed is 3 seconds or 3 hours
stale, and the number shown bears no relation to the exchange clock they are trading against.

**Fix.** Render `formatFreshness()` ("4s ago") as the primary, with the absolute time in ET
(and the zone abbreviation) as a `title`/secondary. **Effort** S · **Confidence** high

---

#### UX-5 · P2 · Numeric formatting has no SSOT: 260 raw `.toFixed()` calls vs 3 files using `safeFixed`

**Evidence.** `lib/format.ts:11-17` documents `safeFixed` as the display path precisely so
non-finite values render as `—` instead of `NaN`. `grep -rn "toFixed(" app components` →
**260** hits across ~40 files; only **3** files import `safeFixed`. Worst offenders:
`components/stock/quantlab/tabs/TechnicalsTab.tsx` (34), `components/crypto/BtcQuantLab.tsx`
(17), `components/DarkPoolPanel.tsx` (16), `components/KLineChart.tsx` (14),
`components/stock/quantlab/tabs/SummaryTab.tsx` (14), `app/ma-deviation/page.tsx` (13).
Same page, both conventions: `app/page.tsx:434` formats the breadth chips with raw
`.toFixed(2)` while the cards immediately below use `safeFixed`.

**Impact.** Any upstream gap (a missing quote, a divide-by-zero in an indicator) prints
literal `NaN`/`Infinity` into a price or ratio field instead of a dash — the failure mode
`safeFixed` exists to prevent — and decimal counts drift page to page.

**Fix.** Codemod raw `.toFixed(n)` in `app/**` + `components/**` to the `lib/format` helpers,
then add a lint rule banning bare `.toFixed(` in TSX. **Effort** M · **Confidence** high

---

### `/stock/[ticker]` (AAPL, MSFT) + the shared `KLineChart` (`/stock`, `/sector/[slug]`, `/crypto/btc`)

**Job:** "show me this instrument's price action and whether institutions are accumulating."
Glance test: **fails** — the chart is illegible (UX-7) and the change % on screen contradicts
itself (UX-8).

---

#### UX-6 · P0 · Dark-pool block prints are generated by a seeded PRNG and the "ILLUSTRATIVE" badge is hidden exactly when a trader would trust them

**Evidence.**
`lib/mockData.ts:34-61` — `generateDarkPoolPrints(ticker, count=12)` fabricates 12 prints from
`mulberry32(sum of the ticker's char codes + 777)`: sizes, prices, VWAP premium, print type
(BLOCK/SWEEP/CROSS) and **BULLISH/BEARISH/NEUTRAL sentiment** are all PRNG output. Two
aggravating details in the same function:
* `const now = new Date('2026-03-23T15:00:00')` (:38) — every print's timestamp is anchored to
  a **hardcoded date five months in the past**, then rendered as a bare `HH:MM:SS` clock
  (`:52`), so the panel reads as *today's* tape.
* `const base = SEED_PRICES[ticker] || 100` (:36) — any ticker not in the seed table gets
  prints priced around **$100**. AAPL trades at $305, so its fabricated prints would sit ~67 %
  below market and read as enormous institutional accumulation.

Consumers: `app/stock/[ticker]/page.tsx:226` and `app/sector/[slug]/page.tsx:12`.

**The disclosure is conditional and backwards.** `components/DarkPoolPanel.tsx:238-242` renders
the `ILLUSTRATIVE` badge only `{!hasRealData && ...}`. `hasRealData` is true whenever the
genuine Yahoo off-exchange call (`/api/darkpool/[ticker]`) returns — i.e. for every real,
liquid instrument. So the badge **disappears precisely on the tickers a professional trades**,
while the table underneath is still 100 % synthetic. `components/ComplianceBanner.tsx:23`
promises simulated data is labelled "where labeled" — here the label is suppressed by
success of an unrelated call.

Two more unlabelled synthetic surfaces:
* `components/DarkPoolPanel.tsx:205-227` — the "Off-Exchange Flow BEARISH↔BULLISH" gauge is
  computed from the synthetic `prints` (`bullishPct`, :70-75), is gated on the tautology
  `{(hasRealData || true) && ...}`, and renders **immediately below** the real-data
  provenance line "Source: Yahoo Finance aggregate off-exchange trading data. Fetched: …"
  (:195-202). Real attribution, synthetic number, no separator.
* `app/stock/[ticker]/page.tsx:651-670` and `app/sector/[slug]/page.tsx:557-575` — the
  sidebar "Dark Pool Summary → Total Block Vol / Bullish Prints n/12" tiles carry **no label
  of any kind**.

**Live proof it is not real data:** `https://quantan.vercel.app/stock/APPLEZZZQQQ` — a symbol
that does not exist, whose chart API 500s — still renders
`DARK POOL SUMMARY · Total Block Vol 3M · Bullish Prints 9/12`.

**Confirmed on the Dark Pool tab of `/stock/AAPL`, with AAPL trading at $305.40.** Captured
live:

```
Off-Exchange Vol —   Short Interest 0.01% (141.61M shares)   Days to Cover 2.6   Float 14.59B   ← REAL (Yahoo)
Source: Yahoo Finance aggregate off-exchange trading data. Fetched: 15/08/2026, 00:39:59.      ← REAL provenance
BEARISH ── Off-Exchange Flow ── BULLISH    51% / 49%                                            ← from synthetic prints
Block Prints — AAPL          [no ILLUSTRATIVE badge]                                            ← badge suppressed
  14:58:00  334K  $100.07  +0.54%  BLOCK
  14:30:00  114K  $100.59  +0.63%  SWEEP
  14:15:00  517K  $100.85  +0.07%  CROSS
  13:58:00  115K   $99.82  −0.27%  SWEEP        … 10 rows, all ≈ $100
```

Three things this settles:
1. **The `ILLUSTRATIVE` badge is genuinely absent on AAPL** — real Yahoo short-interest/float
   data loaded, so `hasRealData` is true and the label is suppressed. The headline claim is
   confirmed, not inferred.
2. **The fabricated prints are priced at ≈ $100 while AAPL trades at $305.40** — the
   `SEED_PRICES[ticker] || 100` fallback, i.e. institutional blocks shown crossing **67 % below
   market**, in a table that simultaneously reports them as within ±0.6 % of VWAP. The table is
   internally impossible, and it sits directly beneath the real Yahoo provenance line.
3. The `Signal` column renders **blank on every row**, yet the sidebar tile derived from it
   reports `Bullish Prints 7/12` — so the sentiment that drives the summary is not even shown.

Timestamps read `12:10`–`14:58`, from the hardcoded `2026-03-23T15:00:00` anchor, so they
present as today's tape.

**Impact.** The homepage sells "Dark Pool Intelligence — block prints, sweep orders,
institutional flow sentiment, VWAP premium/discount". A professional trader reading
"9/12 bullish prints" on AAPL is reading a hash of the letters A-A-P-L, unlabelled, next to a
Yahoo source citation, on a page that also carries a real-time feed-status panel.

**Fix.** (a) Never render synthetic prints unlabelled: make the `ILLUSTRATIVE` badge
unconditional on the synthetic table and add it to the two sidebar summary tiles and the
Off-Exchange Flow gauge; (b) stop deriving the flow gauge from `prints` when `hasRealData` —
derive it from `apiData` or hide it; (c) return `[]` from `generateDarkPoolPrints` when the
quote lookup failed, so unknown symbols show an empty state; (d) drop the hardcoded
`2026-03-23` anchor. The honest end-state is to delete the synthetic prints entirely and show
only `/api/darkpool` — that is a product decision, so ship (a)–(d) first.
**Effort** S (a–d) / M (deletion) · **Confidence** high

---

#### UX-7 · P0 · The price chart draws 252 bars into 15 % of the pane — 85 % of every chart is dead space

**Evidence.** `https://quantan.vercel.app/stock/MSFT`, default `1Y`, fresh navigation (not
resize-induced — reproduced on AAPL and MSFT on first paint). `/api/chart/MSFT?range=1Y`
returns **252 candles** (verified via fetch). Pixel-scanning the price canvas for saturated
candle-colored columns:

```
main price canvas          1652 device px wide (826 CSS px)
candle ink spans x = 1400 … 1651
series occupies            15.2 % of the pane
empty space to the left    84.7 %
⇒ 251 bars over 251 device px = barSpacing 1 device px (0.5 CSS px) — the library floor
```

At 0.5 CSS px per bar no candle body, wick, or EMA crossing is resolvable; the RSI, MACD and
ATR sub-panes inherit the same compression (ATR renders visually empty).

**The same measurement on `/crypto/btc` (92 candles, `1D`) makes the mechanism unambiguous:**

```
canvas 1608 device px · candle ink spans x = 1515 … 1607
series occupies 5.7 % of the pane · 94.2 % empty
```

252 bars → 251 px, 92 bars → 92 px. **The rendered width of the series equals the bar count in
device pixels on every page**, i.e. `barSpacing` is pinned at the library floor and is never
recomputed for the pane width — `fitContent()` demonstrably never takes effect. The defect
gets *worse* the shorter the series, so intraday timeframes are the least readable of all.

**The defect is in the *initial fit only* — and forcing a re-fit demonstrably repairs it.**
Two controls confirm this:

* **At 375 px the same chart renders correctly.** Fresh mobile load of `/stock/AAPL` 1Y:
  candles fill the pane, individual bodies and wicks are resolvable, EMA lines legible
  (screenshotted). So the data, the series and the renderer are all fine.
* **Resizing the viewport without reloading fixes the desktop chart.** After going
  mobile → desktop with no navigation, the AAPL 1Y chart renders across the full pane with a
  complete month axis (2026, Feb … Aug), visible volume histogram and legible EMAs — i.e.
  exactly what it should have looked like on load. The repair is reproducible on demand.

**Root cause (mechanism med-confidence; symptom and repair are high).** `fitContent()` is
called only from the data effect, `hooks/useKLineChart.ts:827-829` (and `:817` for ATR), which
runs before the chart's grid cell (`xl:col-span-3`, beside the indicator sidebar) has settled
at its final width. Bar spacing is computed against that early, narrower width and is then
**never recomputed**, because the `ResizeObserver` at `:563-570` pushes the new width in with
`applyOptions({ width })` and does not re-run `fitContent()`:

```ts
resizeRef.current = new ResizeObserver((entries) => {
  const { width } = entries[0].contentRect
  main.applyOptions({ width })            // ← no fitContent()
  rsiChartRef.current?.applyOptions({ width })
  …
})
```

lightweight-charts preserves `barSpacing` and the right anchor across a width change, so the
extra width becomes dead space on the left. At mobile the initial and final widths are the
same, so no defect appears — which is why this has survived. (A related observation while
resizing: the chart canvas did not track the container width at all until a re-render, so the
RO path is worth checking end-to-end, not just for the missing re-fit.)

**Impact.** The chart is the core of three of the platform's pages and is unreadable at rest
**on desktop — where professionals trade**; every trader must manually zoom or resize before
doing any technical work.

**Fix.** Call `fitContent()` on all four charts inside the `ResizeObserver` callback, and/or
defer the initial fit to a `requestAnimationFrame` after layout settles. The manual-resize
repair above is direct evidence this is sufficient. **Effort** S · **Confidence** high
(symptom + repair measured; exact trigger med)

---

#### UX-8 · P0 · The chart's change % is the candle body, not the session change — it shows the opposite sign and colour from the header on the same screen

**Evidence.** `components/KLineChart.tsx:269-274`:

```ts
const isUp   = latestCandle ? latestCandle.close >= latestCandle.open : true
const chgPct = latestCandle && latestCandle.open > 0
  ? (((latestCandle.close - latestCandle.open) / latestCandle.open) * 100).toFixed(2)
```

That is **open→close of the last bar**, not change **vs prior close** — the convention every
other surface on the site uses, and the one every trading platform uses. `isUp` drives both
the ▲/▼ glyph and the green/red colour from the same wrong basis.

Read simultaneously from the live DOM on `/stock/AAPL`:

| Surface | Value | Colour | Anchor |
|---|---|---|---|
| Page header | `$305.27 ▲ +0.01 (0.00%)` | green | live quote, vs prior close |
| **Chart legend** | **`▼ $305.27 −0.25%`** | **red** | `KLineChart.tsx:366-371` |
| Session snapshot | `−0.01%` (observed `+0.00%` a tick earlier) | flipped between reads | `app/stock/[ticker]/page.tsx:640-642` |

On `/stock/MSFT` the same instant: header `+0.12 %`, chart legend `+0.23 %` — same sign, ~2×
apart. On any gap day the two disagree in **direction**.

Secondary: `isUp` uses `>=`, so a perfectly flat bar renders green `▲ +0.00%`; the header does
the same (`quote.changePct >= 0`, `app/stock/[ticker]/page.tsx:640`). Zero is not "up" — it
should be neutral/slate.

**Impact.** A trader glancing at the chart sees red-down on an instrument the header says is
up. On a shared component used by `/stock`, `/sector/[slug]` and `/crypto/btc`, that is three
pages showing two contradictory directional colours for one instrument.

**Fix.** Compute the legend change against the **previous candle's close**
(`sortedCandlesPreview[n-2].close`), falling back to the live quote's `changePct` when the
last bar is the current session; label it explicitly ("1D" / "vs prev close"); and treat
`chg === 0` as neutral in both the glyph and the colour. **Effort** S · **Confidence** high

---

#### UX-9 · P1 · An unknown ticker renders a complete, confident instrument page whose only error is a raw "HTTP 500"

**Evidence.** `https://quantan.vercel.app/stock/APPLEZZZQQQ` (reachable straight from the
global search — its own hint at `components/GlobalSearch.tsx:222` invites it: "symbol + Enter
opens the stock page even if the list is empty"; `looksLikeDirectTicker` :18-23 accepts any
`^[A-Z0-9^.\-=*]{1,24}$`). The page renders: the ticker as an `<h1>`, the tagline "Live prices
& charts + Quant Lab", all five tabs, the full timeframe rail, the indicator panel, a
"Real-Time Data Feed Status" card, and the fabricated Dark Pool Summary (UX-6). Network:

```
GET /api/chart/APPLEZZZQQQ?range=1Y   → 500     ← unknown symbol returns a server error
GET /api/prices?tickers=APPLEZZZQQQ   → 200
GET /api/stream/APPLEZZZQQQ           → 200     ← an SSE stream is opened and held
```

The only user-visible signal is inside the chart frame: **"Chart unavailable / HTTP 500 /
Retry chart"** — a raw status code, and one that says "our server broke", not "no such
symbol". "Retry chart" invites the user to retry something that can never succeed.

**Impact.** A fat-fingered symbol is indistinguishable from a data outage; the trader retries,
waits, and meanwhile the page shows them fabricated dark-pool flow for an instrument that does
not exist. A held SSE stream per bogus symbol is also a free resource leak.

**Fix.** Have `/api/chart/[ticker]` return **404** for a symbol Yahoo does not resolve
(reserve 500 for genuine failures), and have the page branch on it: render a
"Symbol not found — check the ticker" state that suppresses the tabs, the feed-status card and
the dark-pool panel, and offers the search box back. Map error copy to plain language
generally; never surface `HTTP <code>` to a trader. **Effort** M · **Confidence** high

---

#### UX-10 · P2 · Every browser tab is called "QUANTAN — Market Intelligence"

**Evidence.** `document.title` on `/stock/AAPL`, `/stock/MSFT` and `/stock/APPLEZZZQQQ` is
`"QUANTAN — Market Intelligence"` in all three cases (read from the live DOM). No route below
`app/layout.tsx` exports `metadata` / `generateMetadata`:

```
$ grep -rn "export const metadata\|generateMetadata" app --include=page.tsx   → (none)
```

**Impact.** Traders run many tabs. With every tab identically titled, tab-switching, browser
history and bookmarks are all unusable, and shared links have no context.

**Fix.** Add `generateMetadata` per dynamic route (`{TICKER} $price · QUANTAN`, `{Sector} ·
QUANTAN`) and static `metadata.title` on the fixed routes. Because these pages are client
components, either lift a small server `layout.tsx` per segment or set the title from the
quote effect. **Effort** S · **Confidence** high

---

#### UX-11 · P2 · The instrument avatar tile is a fixed 48 px box holding an unbounded ticker string

**Evidence.** `/stock/APPLEZZZQQQ`, measured: the tile is
`div.w-12 h-12 … text-xl font-bold font-mono` → **48 × 48 px** at `font-size: 20px`, containing
the whole ticker. Observed: the text spills out of both sides of the tile and collides with the
`<h1>` beside it. Anchor: `app/stock/[ticker]/page.tsx` (avatar tile in the page header block).

**It also breaks at four characters — measured, at desktop width.** On `/stock/AAPL`
(1280×720), the tile div and its text node:

```
tile   48 × 48 px   (w-12 h-12, font-size 20px)
text   54.4 px wide  → 6.4 px of overflow
tile.scrollWidth 50 > tile.clientWidth 46
```

So this is not an edge case for long symbols or a mobile-only artefact — it is wrong for the
most common ticker length, at every viewport, on the platform's most-visited page.

**Impact.** Visible text overflow on the instrument header of every stock page at mobile
width, and at any width for 5-char (`GOOGL`, `BRK.B`) or crypto-pair symbols.

**Fix.** Truncate to 4 characters inside the tile with the full symbol on the `<h1>`, or size
the tile with `min-w-12 px-2 w-auto` and scale the font down past 4 characters.
**Effort** S · **Confidence** high (observed at 4 and 11 characters)

---

#### UX-12 · P2 · Two breadcrumb trails on one page, with different paths

**Evidence.** `/stock/AAPL` renders `<nav aria-label="Breadcrumb">` in the sticky header —
`Home / Markets / AAPL` — and, 44 px below it in the page body, a second, non-landmark trail
`Markets / Individual Stock` (`div.flex.items-center.gap-2.mb-0.5`, anchors verified in the
live DOM). Different depth, different leaf, only one of them a navigation landmark.

**Impact.** Redundant chrome above the fold on a page that already fails the glance test, and
a screen-reader user gets one trail as a landmark and one as loose text.

**Fix.** Keep the header `Breadcrumbs` component as the single trail; delete the in-page
duplicate (or demote it to the page's eyebrow label without the slash-separated path).
**Effort** S · **Confidence** high

---

### `/backtest`

**Job:** "is this strategy worth allocating to, and where does its edge come from."
Glance test: **fails on latency** (UX-13) and **misleads on the verdict** (UX-15).

---

#### UX-13 · P1 · 12 seconds of blank page before any number, with a message that promises 20

**Evidence.** `https://quantan.vercel.app/backtest`. Measured with a DOM poll from navigation:
**12.3 s** from navigation to the disappearance of the loading state (on a warm/cached load —
the page's own copy warns "Fetching 5Y history for 56 instruments (**may take ~20s**)"). For
that entire window the viewport contains a centred spinner and two lines of text: no header
metrics, no skeleton, no partial instrument rows, no progress indication, and no way to start
reading anything. The `Refresh` button re-enters the same blocking state.

**Impact.** Twelve to twenty seconds is far past the point where a professional abandons a
page; and because the wait is undifferentiated (spinner, no progress), there is no signal
distinguishing "working" from "hung".

**Fix.** Render the page shell + metric tiles as skeletons immediately, stream the six header
metrics as soon as the portfolio aggregate resolves (they do not need all 56 instrument
series), and progressively fill the Instruments/Trades tabs. If the 56-instrument fetch must
stay monolithic, at minimum show `n/56 instruments loaded` so the wait is legible.
**Effort** M · **Confidence** high

---

#### UX-14 · P1 · The page states its transaction-cost assumption two different ways, and one contradicts the engine's own SSOT

**Evidence.** Both strings render on `/backtest` at the same time:

* `app/backtest/page.tsx:247-248` — "include round-trip transaction costs of **≈22 bps
  (11 bps/side)**"
* `components/backtest/OverviewTab.tsx:37` — STRATEGY RULES → Transaction Costs:
  "**~11bps round-trip** (IBKR: $0.005/sh + 0.05% spread + 0.5bps slippage)"

The engine SSOT is unambiguous: `lib/backtest/executionModel.ts:26` — "Decimal per-side cost
(entry OR exit). SSOT for the 0.0011 (11 bps) literal"; `:31` round-trip = 2× that;
`lib/quant/constants.ts:107` — "Round-trip = 22 bps". So the OverviewTab string is a
hardcoded literal that **halves the modelled friction**, on the one row a trader reads to
decide whether the backtest is honest about costs.

**Impact.** Cost assumptions are the first thing a professional checks in a backtest. A page
that states them inconsistently forfeits trust in every number above it — and the wrong
version is the more flattering one.

**Fix.** Derive the row from `executionModel` (`TX_COST_PCT_PER_SIDE`, round-trip helper)
rather than a literal, so the copy cannot drift again; add a unit test asserting the rendered
string matches the SSOT. This is a copy/derivation fix, not a change to any published
performance figure. **Effort** S · **Confidence** high

---

#### UX-15 · P1 · The verdict tile row reads green-first; the number that says "don't use this" is second and unranked

**Evidence.** The six header tiles render left-to-right (`/backtest`, live):

```
PORTFOLIO RETURN  +3.33%   (green, first)      Ann: +1.14%
ALPHA VS B&H    −129.93%   (red)               B&H avg (matched window): +133.26%
SHARPE RATIO        1.58                       Risk-adj return
MAX DRAWDOWN       −0.7%                       Portfolio peak-to-trough
WIN RATE           64.4%   (green)             219 total trades
INSTRUMENTS           56
```

Colour here encodes **sign**, not **merit**, and position encodes nothing. A trader glancing
for <5 s sees a green return, a green 64.4 % win rate and a 1.58 Sharpe, and forms a positive
impression; the fact that the strategy trailed simply holding the same universe by 130 pp over
the same window is one tile in from the left, at identical weight.

To be explicit: the page is **honest** — the alpha tile, the survivorship caveat
(`app/backtest/page.tsx`, "How these are measured…") and the T+1/cost note are all present and
well written. The defect is purely hierarchy: the decision-relevant number is not dominant.

**Impact.** The page's own headline finding is discoverable only by reading all six tiles and
knowing which one matters.

**Fix.** Promote **Alpha vs B&H** to a single dominant verdict block (largest type, first
position, with the B&H comparator inline), demote the remaining five to a secondary strip, and
add a one-line plain-language read-out under the verdict. No published number changes — this
is layout and rank only. **Effort** S · **Confidence** high

---

#### UX-16 · P2 · Two of the four tab bars declare `role="tab"` but never implement the keyboard pattern

**Evidence.** Verified live on `/backtest`: focusing the `overview` tab and pressing
`ArrowRight` leaves both focus and `aria-selected` on `overview`; all five tabs carry
`tabIndex=0` (no roving tabindex) and none has `aria-controls`. Source:

| Tab bar | Arrow keys | Anchor |
|---|---|---|
| `/sector/[slug]` | ✅ | `app/sector/[slug]/page.tsx:417-418` |
| `/stock/[ticker]` | ✅ | `app/stock/[ticker]/page.tsx:385-386` |
| **`/backtest`** | ❌ | `app/backtest/page.tsx:274-276` |
| **`/crypto/btc`** | ❌ | `components/crypto/BtcTabBar.tsx:26-31` |

Two implementations of the same pattern diverged; the ARIA role promises behaviour the widget
does not have.

**Impact.** Keyboard and screen-reader users are told these are tabs, try the arrow keys that
role implies, and get nothing — then must Tab through all five to reach the content.

**Fix.** Extract one `<TabList>` component (roving `tabIndex`, `ArrowLeft/Right/Home/End`,
`aria-controls` → panel `id`) and use it in all four places. **Effort** S · **Confidence** high

---

#### UX-17 · P2 · The instrument filter — the page's only real input — has no accessible name and no feedback

**Evidence.** `/backtest`, the "Instruments:" filter:
`<input type="text" placeholder="Search ticker (e.g. AAPL, NVDA)">` — measured live: **no
`id`, no `aria-label`, not wrapped in a `<label>`, no `label[for]`**. Its only name is the
placeholder, which disappears on first keystroke. There is no result count feedback beyond the
static "Showing all 56 instruments. Type a ticker to filter.", no clear (×) affordance, no
"no matches" state, and no indication that it filters the tabs below rather than searching the
site (it sits ~200 px under the global ⌘K search box with near-identical styling).

**Impact.** The one control that lets a trader narrow 56 instruments is unlabelled, easily
confused with global search, and gives no confirmation that a typo simply matched nothing.

**Fix.** Add a visible `<label for>` ("Filter instruments"), make the helper text live
(`Showing n of 56`), add a clear button and an explicit empty state, and visually differentiate
it from the global search field. **Effort** S · **Confidence** high

---

#### UX-18 · P3 · Date/number copy drift on the backtest header

**Evidence.** `/backtest` header reads `Last computed / 15/08/2026, 00:18:21 / live` —
`toLocaleString()` in the viewer's locale, so DD/MM/YYYY here and MM/DD/YYYY for a US trader,
with no timezone (same root cause as UX-4). `components/backtest/SectorHeatmap.tsx:52` renders
`{n} tickers` unconditionally → "**1 tickers**" for the Crypto row. The Crypto row also shows
`+0.00% / +0.00% total`, indistinguishable from "measured and flat" versus "never traded".

**Fix.** Use a fixed `YYYY-MM-DD HH:mm ET` format for all computed-at stamps; pluralise;
render "no trades" rather than `+0.00%` when the instrument produced zero closed trades.
**Effort** S · **Confidence** high

---

### `/desk`

**Job:** "one dense strip I leave open all session to spot outliers." Glance test: **fails on
first visit** — the top 387 px is documentation.

---

#### UX-19 · P1 · The densest page on the platform opens with a 387 px instruction panel; only 5 of 28 quote rows are above the fold

**Evidence** (measured live at 1280×720, data loaded):

```
DashboardGuide section   y =  81 … 468   (387 px tall, expanded by default)
h1 "Trading desk"        y = 484
quote table starts       y = 585
rows in table            28   ·  rows above the 720 px fold: 5
```

**At 375×812 the quote table starts at y = 956 — the entire table is below the fold and the
first screen contains no quotes at all.**

`components/DashboardGuide.tsx:36-37` — `useState(true)`, "Default OPEN on first ever visit".
The panel explains what a quote strip is, what 2s/5s/15s means, and what green and red mean —
to an audience the page's own subtitle calls "floor-style monitoring".

There is a second, subtler cost: `components/DashboardGuide.tsx:54-55` renders
`isOpen = hydrated ? open : true`, so a **returning** user who collapsed the panel still gets
it server-rendered open, then sees it collapse after hydration — a 387 px layout shift that
yanks the whole quote table upward on every visit. (Same component, same behaviour, on
`/sector/[slug]:356`.)

**Impact.** The page whose entire value proposition is information density spends more than
half its first screen on prose, and returning users get a visible jump on every load.

**Fix.** Default the guide **collapsed** with a persistent "How to read this" affordance
(one line, not a panel); if first-visit onboarding is wanted, keep it open only when
`localStorage` has no entry at all *and* render it below the table. Fix the hydration flash by
gating the open state on a cookie read server-side, or by rendering the panel collapsed until
hydrated (the opposite of the current default). **Effort** S · **Confidence** high

---

### `/heatmap`

**Job:** "which sector is leading and lagging, instantly." Glance test: **fails** — the colour
encoding collapses to two shades on a normal session.

---

#### UX-20 · P1 · The heatmap quantises into ±1 % buckets, so 10 of 11 tiles render in the same two colours

**Evidence.** `app/heatmap/page.tsx:64-71`:

```ts
if (changePct >=  2) return 'bg-green-600'
if (changePct >=  1) return 'bg-green-700'
if (changePct >=  0) return 'bg-green-900'
if (changePct >= -1) return 'bg-red-900'
if (changePct >= -2) return 'bg-red-700'
return 'bg-red-600'
```

Observed live, the 11 sector moves spanned **−0.51 % … +1.42 %** — a completely ordinary
session. Result: XLE (+1.42 %) got `green-700`; the other six advancers (+0.20 … +0.65 %) all
got `green-900`; all four decliners (**−0.07 %, −0.16 %, −0.41 %, −0.51 %**) all got
`red-900`. XLF at −0.07 % is painted identically to XLK at −0.51 %. Since typical daily sector
dispersion sits well inside ±1 %, the "heatmap" is a binary up/down grid on almost every
session, and the tile colour carries strictly **less** information than the number printed on
it.

Three compounding defects on the same page:
* **No size encoding.** Every tile is `h-32` in a uniform grid (`:92`, `:101`). The `Quote`
  interface even declares `marketCap` (`:12`) and never uses it — a sector heatmap normally
  sizes by weight.
* **No sorting.** `SECTORS.map` in declaration order (`:59`); the comment at `:58` says so
  outright — "Order sectors by market cap or alphabetically. Right now using just standard
  order." The trader must read all 11 numbers to find the leader. The homepage breadth strip
  *is* sorted (`app/page.tsx:222`), so the two views of the same data disagree.
* **The legend has six swatches and no numbers** (`:132-140`), so a shade cannot be mapped
  back to a magnitude.

**Impact.** The page that exists purely to answer "where is the money going" answers it worse
than a sorted list, and equates a flat sector with a −0.5 % sector.

**Fix.** Replace the buckets with a continuous diverging scale normalised to the **session's
own** range (or a rolling σ), keep a neutral band around 0 so flat reads flat, sort tiles by
change descending, size them by index weight, and label the legend with the actual breakpoints.
**Effort** M · **Confidence** high

---

#### UX-21 · P3 · `/heatmap` renders `+%` if the quote fetch fails after the loading flag clears

**Evidence.** `app/heatmap/page.tsx:120` — `{isUp ? '+' : ''}{quote?.changePct.toFixed(2)}%`.
The optional chain guards `quote`, so when `quote` is absent the expression yields `undefined`
and the tile renders a bare **`+%`**. `:42` clears `loading` in a `finally` even on a failed
fetch, and `:95` defaults a missing `changePct` to `0`, i.e. "up". So a provider failure
produces a green tile reading `+%` rather than an error state. Same `safeFixed` gap as UX-5.
Also `:87` prints `Poll · {toLocaleTimeString()}` — bare local clock, no zone (UX-4 family),
and this page polls `/api/prices` every 15 s while the rest of the site is on SSE.

**Fix.** Route the value through `safeFixed`, render `—` and a neutral tile when the quote is
missing, and surface a fetch error instead of clearing `loading` silently.
**Effort** S · **Confidence** high

---

### `/sector/[slug]` (technology) + the shared timeframe rail

**Job:** "is this sector trending, is institutional flow with me, what's the level."
Glance test: **fails** — 380 px of instructions first (UX-19), and the header, the chart legend
and the signal card give three different session changes.

---

#### UX-22 · P1 · Selecting a 1-minute timeframe labels the chart "DAILY+ BARS"

**Evidence.** Live on `/stock/AAPL`: clicking the `1m` pill and waiting for the reload leaves
the chart badge reading **`DAILY+ BARS`**. Root cause is a hand-maintained list that drifted
between the two pages that share the rail:

* `app/stock/[ticker]/page.tsx:451` —
  `activeRange === '1D' || '1W' || '5m' || '15m' || '1H' || '4H' ? 'INTRADAY' : 'DAILY+'`
  — **omits `1m` and `3m`**.
* `app/sector/[slug]/page.tsx:229` —
  `['1m','3m','5m','15m','1H','4H','1D','1W'].includes(activeRange) ? 'INTRADAY' : 'DAILY+'`
  — the complete set.
* `lib/chartYahoo.ts:12-13` — `isStockIntradayPollRange()` already holds the correct 8-element
  set as an SSOT that neither page's badge uses.

**Impact.** The chart states the wrong bar granularity on the platform's most-used detail page.
A trader reading "DAILY+" on a 1-minute chart will misjudge every level, every indicator
period and every stop distance derived from it.

**Fix.** Delete both inline lists and call `isStockIntradayPollRange(activeRange)` — the SSOT
already exists two imports away. Add a test asserting the badge for all 15 tokens.
**Effort** S · **Confidence** high

---

#### UX-23 · P1 · The timeframe rail is 15 identical pills conflating bar interval with lookback, including the `1m` / `1M` trap

**Evidence.** `lib/chartYahoo.ts:5-7`:

```ts
export const STOCK_CHART_RANGES = [
  '1m','3m','5m','15m','1H','4H','1D','1W','1M','3M','6M','1Y','2Y','5Y','ALL',
] as const
```

Rendered as one flat, ungrouped row of visually identical `font-mono` pills
(`app/stock/[ticker]/page.tsx:409`, `app/sector/[slug]/page.tsx:443`). Two orthogonal axes are
mixed in one control: **bar interval** (`1m 3m 5m 15m 1H 4H`) and **lookback range**
(`1D 1W 1M 3M 6M 1Y 2Y 5Y ALL`). `1m` (one minute) and `1M` (one month) sit eight positions
apart and differ **only by letter case**, with no separator, no group label, and no tooltip.
The constant's own name (`..._RANGES`) treats intervals as ranges.

Defaults also differ between the two pages that share the rail: `/stock/[ticker]` opens on
`1Y`, `/sector/[slug]` opens on `6M` (both observed live).

**Impact.** Mis-clicking `1m` for `1M` silently swaps a one-month daily chart for a
one-minute chart — and thanks to UX-22 the badge confirms the wrong one. This is the classic
timeframe-control failure every professional platform designs around.

**Fix.** Split into two controls — an **Interval** selector (1m/3m/5m/15m/1H/4H/1D) and a
**Range** selector (1D/5D/1M/3M/6M/1Y/2Y/5Y/ALL) — or at minimum group them with a visible
divider + group labels and disambiguate the labels (`1min` vs `1mo`). Align the default
timeframe across `/stock`, `/sector` and `/crypto/btc`. **Effort** M · **Confidence** high

---

#### UX-24 · P2 · Three different sign conventions for change %, and the two detail-page headers strip the minus sign

**Evidence.** Observed live on `/sector/technology`, header:
**`▼ -0.99 (0.52%)`** — the dollar change carries its sign, the percentage in the same
15-character string does not.

```
app/sector/[slug]/page.tsx:267   {isUp ? '▲' : '▼'} {formatSignedNumber(quote.change)} ({Math.abs(quote.changePct).toFixed(2)}%)
app/stock/[ticker]/page.tsx:326  (identical line)
```

Across the platform the same quantity is rendered three ways:

| Convention | Example | Anchor |
|---|---|---|
| signed % | `−0.52%` | `app/desk/page.tsx:225`, `components/SectorCard.tsx:101` |
| arrow only, unsigned | `▼0.54%` | `components/PriceTicker.tsx:101` |
| **mixed — signed $, unsigned %** | `▼ -0.99 (0.52%)` | `app/sector/[slug]:267`, `app/stock/[ticker]:326` |

(The signed variants also mix U+2212 `−` with the ASCII hyphen, so copy-pasted values differ
byte-wise between pages.)

**Impact.** The two primary detail pages print a positive-looking percentage on a down day.
Anyone reading, screenshotting or copying that number out of context gets the wrong sign.

**Fix.** One `formatChange(quote)` helper in `lib/format.ts` returning the arrow, the signed
value and the signed percent with a single minus-glyph convention; use it on all five
surfaces. **Effort** S · **Confidence** high

---

#### UX-25 · P3 · `/sector/[slug]` shows a permanently-empty "Risk/Reward Ratio" field

**Evidence.** `/sector/technology` right column: `Risk/Reward Ratio —`.
`components/SignalCard.tsx:37-38` — `formatRiskReward()` returns `'—'` unconditionally when
`signal.source === 'yahoo-session'`, and every sector signal is `yahoo-session`
(`lib/sessionSignalsFromQuotes.ts`). The row can therefore never display a value on this page.

**Impact.** A field that always reads `—` trains the user to ignore the panel, and implies a
risk framework the session signal does not have.

**Fix.** Hide the row when the signal source cannot produce it (or show an explicit
"not applicable to session signals" note once, rather than a dash in a data slot).
**Effort** S · **Confidence** high

---

### `/briefs` and `/briefs/sector/[sector]` — **BOTH BROKEN IN PRODUCTION RIGHT NOW**

---

#### UX-26 · P0 · An entire top-level nav section is down: `/briefs` renders empty and `/briefs/sector/technology` hard-errors — while the underlying API is healthy

**Evidence, captured live 2026-08-15:**

`https://quantan.vercel.app/briefs` →
> **No briefs available. All Yahoo Finance requests failed.**

…rendered directly beneath a green pulsing dot reading **"Live data from Yahoo Finance"**.

`https://quantan.vercel.app/briefs/sector/technology` →
> ⚠ **Failed to load brief** · ID: 2384324333
> "An error occurred in the Server Components render. The specific message is omitted in
> production builds to avoid leaking sensitive details. A digest property is included on this
> error instance which may provide additional details about the nature of the error."

**The API is not down.** Fetched from the same browser session, same origin:

```
GET /api/briefs/technology  → 200, 3351 bytes
GET /api/briefs/energy      → 200, 3269 bytes
GET /api/briefs             → 200, 11941 bytes   (the homepage news rail renders this fine)
```

**These are two distinct bugs and must be triaged separately.**

**26a — `/briefs` renders empty.** `app/briefs/page.tsx:33-36` is a server component that fans
out **11 self-fetches** over the network to `${appBaseUrl()}/api/briefs/${slug}` with
`cache:'no-store'`. `:37` turns any non-ok response into `null`, `Promise.allSettled` swallows
every throw, and `:42` filters them all out — so 11 failures collapse into one sentence that
blames Yahoo. The self-fetch is failing while the endpoint it targets returns 200 to the
browser. `lib/appUrl.ts:5-7` resolves the base from `NEXT_PUBLIC_APP_URL`, else `VERCEL_URL`
(the *deployment-specific* host rather than the production alias) — the usual way this pattern
breaks — but production env values are not visible from this audit, so treat that as the lead,
not the confirmed trigger.

**26b — `/briefs/sector/[sector]` throws.** This one **cannot** be the self-fetch:
`app/briefs/sector/[sector]/page.tsx:19-21` wraps it in `try { … } catch { return null }`, and
`LiveBriefClient` handles a null brief cleanly (`:94-101` "Sector not found" branch, `:108-121`
loading skeleton, `:123-127` error banner, and every field guarded behind
`{brief && !loading && …}` at `:123`). So a null brief renders a skeleton, not an exception —
yet the segment's error boundary fires with digest **2384324333**. The throwing code is
elsewhere in that segment and is **not identifiable from the client**; the fix wave should read
the Vercel runtime log for that digest first. Filed as observable-only.

Three separate UX failures stack on top of the outage:
* **The copy blames Yahoo** (`app/briefs/page.tsx:69`) for a failure in the app's own
  internal fetch. Whoever reads that message will debug the wrong system.
* **The "Live data from Yahoo Finance" pill is hardcoded** (`app/briefs/page.tsx:61-64`) —
  it renders unconditionally, so the page asserts it is live in the same viewport where it
  says everything failed.
* **The error boundary prints React's internal developer text verbatim.**
  `app/briefs/sector/[sector]/error.tsx:28` renders `{error.message}`; in a production build
  a server-component error message *is* that boilerplate paragraph. A professional trader is
  shown a note about digest properties and production builds.

Also: `app/briefs/sector/[sector]/page.tsx:27` computes `const sector = SECTORS.find(...)` and
never uses it — an unknown sector slug is neither validated nor 404'd.

**Impact.** The "Briefs" item in the main nav and the homepage's "View all briefs →" both lead
to a dead end. Two of the seventeen audited routes are non-functional, and the interface
insists it is live while showing nothing.

**Fix.** (1) For **26a**: stop the server-side self-fetch entirely — import the brief builder
from `app/api/briefs/[sector]/route.ts` into a shared `lib/` function and call it directly in
the server component (removes 11 network round-trips per page view as well as this whole
outage class). As an interim, make `appBaseUrl()` prefer `VERCEL_PROJECT_PRODUCTION_URL` over
`VERCEL_URL`. (2) For **26b**: read the runtime log for digest 2384324333 before proposing a
code change. (3) Distinguish "upstream provider failed" from "internal fetch failed" in the
copy, and drive the live pill from actual result state. (4) Replace `{error.message}` with a
written fallback and keep the digest as small diagnostic text. (5) 404 unknown sector slugs.
**Effort** M · **Confidence** high on both outages (observed live, with the API returning 200
alongside); the *cause* is med for 26a and unknown for 26b — deliberately not guessed.

---

### `/portfolio` and `/portfolio/factor-attribution`

---

#### UX-27 · P0 · Hardcoded constants render as personalised portfolio risk alerts — with specific hedging instructions and no "demo" label

**Evidence.** `https://quantan.vercel.app/portfolio` renders two alert banners, styled amber
and red:

> **Realized skew is negative while volatility exceeds its mean — tail risk elevated.**
> Suggestions: Consider protective puts · Put spreads on index hedge · VIX call calendars
>
> **Portfolio vega -600,000 USD — short vol exposure.**
> Suggestions: Buy OTM puts · Reduce short vol premium positions · Add VIX hedge

`components/risk/TailRiskBanner.tsx`:

```tsx
/** Demo banner — wire live skew/vol/vega in Phase 16. */
export function TailRiskBanner() {
  const alerts = evaluateTailRisk({
    realizedSkew: -0.6, realizedVol: 0.22, volMean: 0.18, portfolioVegaUsd: -600_000,
  })
```

All four inputs are **literals**. The word "Demo" exists **only in the source comment** — the
rendered output carries no badge, no caveat, no qualifier. And there is no portfolio anywhere
in the product: no positions, no upload, no account, no broker link. The page asserts a
specific dollar vega for a book the user has never entered, and attaches four concrete
options trades to it.

**The correct pattern already exists two clicks away.** `/risk/scenarios` renders its subtitle
as *"Six canned shocks (…). **Demo portfolio — wire live positions in Phase 16.**"* — same
Phase-16 provenance, disclosed in the UI. `/portfolio` simply omits it.

**Impact.** This is the most hazardous surface on the platform: fabricated, unlabelled,
position-specific risk analysis carrying actionable hedging instructions, on a page reached
from the main nav's Portfolio menu. It is materially worse than UX-6 because the output is
phrased as advice.

**Fix.** Immediately: label the banner in the rendered UI exactly as `/risk/scenarios` does,
and strip the "Suggestions" line (or reframe it as "what this alert type would suggest") until
real positions exist. Properly: gate `TailRiskBanner` behind actual portfolio input and render
nothing when there is none. **Effort** S · **Confidence** high

---

#### UX-28 · P1 · The portfolio page tells the user to run an npm script, because it reads a file that does not exist in the deployment

**Evidence.** `https://quantan.vercel.app/portfolio` renders, verbatim:

> Run `npm run portfolio:backtest` to populate metrics.

`app/portfolio/page.tsx:11-19` loads its data with
`readFileSync(join(process.cwd(), 'scripts/portfolio-backtest-results.json'))` at request time,
and `:34-37` falls back to that sentence when the file is absent. The file **does exist in the
repo** (`scripts/portfolio-backtest-results.json`, 136 KB) — but `scripts/` is not imported by
any module, so Next.js file tracing does not bundle it into the serverless function, and
`existsSync` is false in production. The three metric tiles (Best config / Win rate / Max
drawdown) at `:39-52` are therefore **unreachable in production**.

**Impact.** A nav-reachable page shows a developer shell command to end users and never shows
its actual content. Combined with UX-27, `/portfolio` presents fabricated risk alerts *and*
no real metrics.

**Fix.** Move the results JSON into a traced location (`import` it, or put it under `lib/` /
`app/` so tracing picks it up), or serve it from an API route / `public/`. Replace the
fallback copy with a user-facing empty state. Add `outputFileTracingIncludes` for the path if
`readFileSync` must stay. **Effort** S · **Confidence** high

---

#### UX-29 · P2 · `/portfolio/factor-attribution` ships as five zeros in unstyled body text

**Evidence.** Live: `MKT: 0.000 · SMB: 0.000 · HML: 0.000 · MOM: 0.000 · QMJ: 0.000`,
`Alpha (daily): 0.00000 · R²: N/A (multivariate OLS deferred)`, labelled "5-factor loadings
(demo series)". `app/portfolio/factor-attribution/page.tsx` is 31 lines. Every value is zero,
the regression is explicitly deferred, and the page is the only route on the platform with no
visual design at all — a bare `<p>` list, no cards, no table, no chart, while every sibling
page uses the rounded-card system.

**Impact.** A main-nav destination (Portfolio → Factor attribution) that a professional opens
once, finds empty, and never returns to. It also breaks the visual system, which reads as
"unfinished product" more loudly than a missing page would.

**Fix.** Either hide the route from nav until the OLS lands, or render an explicit
"Not yet available — planned for Phase 16" state using the standard card component. Do not
ship a table of zeros. **Effort** S · **Confidence** high

---

### `/ma-deviation`

Strongest page in the audit: real sortable table with `aria-sort`, a spectrum chart, an
explicit methodology section and a disclaimer. Two defects hold it back.

---

#### UX-30 · P1 · The column the page calls "the Key Variable" is empty on every row

**Evidence.** Live, all **13** rows render `—` in the **200MA Slope** column.
`app/ma-deviation/page.tsx:100-101` — `SlopeChip` returns `—` whenever `positive === null`, so
`regime.slopePositive` is null for every instrument in production.

The page's own copy makes the slope the centre of its methodology:
* `:219` — "Combines deviation%, **200MA slope**, and RSI to distinguish true dips from falling
  knives."
* `:557` — a highlighted callout headed "📐 **The 200MA Slope is the Key Variable**".
* `:533` — the Strong Dip Buy checklist requires "The 200MA slope is **still positive**".
* `:553` — the Watch Zone rule: "Only add if the 200MA slope shows signs of flattening."

So the page teaches a decision rule, insists the slope is what separates a dip from a falling
knife, and then shows a dash where the slope belongs — with no "unavailable" note. It also
explains why the summary shows `0 Strong Dip Buy` and `0 Falling Knife`: both classifications
require the slope.

**Impact.** The page cannot deliver the judgement it promises, and gives no indication that
the omission is a data gap rather than a genuine reading.

**Fix.** Compute and populate `slopePositive`/`slopePct` in the regime provider (the field is
already typed at `:13-14` and the detail-drawer renderer at `:426-428` is written and waiting);
until then render an explicit "slope unavailable" state and suppress the two slope-dependent
classifications rather than reporting them as zero counts.
**Effort** M (data) / S (honest empty state) · **Confidence** high

---

#### UX-31 · P2 · Three different taxonomies for one classification on one page, and the summary chips contradict the table

**Evidence.** The same 13 instruments are labelled three ways on `/ma-deviation`:

| Surface | Vocabulary |
|---|---|
| Summary chips | Strong Dip Buy · Watch / Caution · Falling Knife · **In Uptrend** |
| Dip Signal column | Watch — Caution · **In Uptrend** · **Overbought** |
| Deviation Spectrum | First Dip Zone · Healthy Uptrend · Extended Bull Run · Extreme Overextension |

The chip reads **"11 In Uptrend"**, but only **6** table rows say "In Uptrend"; the other 5 say
"Overbought". Root cause `app/ma-deviation/page.tsx:199`:

```ts
const bullCount = data?.rows.filter(r => r.regime?.dipSignal === 'IN_TREND'
                                      || r.regime?.dipSignal === 'OVERBOUGHT').length ?? 0
```

The chip deliberately merges the two, so the headline hides that **5 of 13 instruments —
including SPY, QQQ and XLK at +20.5 % above its 200-day SMA — are flagged Overbought**, which
on a dip-buying page is the most decision-relevant state there is. XLK is simultaneously
"Overbought" (table), "Extreme Overextension" (spectrum) and counted as "In Uptrend" (chip).

**Impact.** A trader who counts rows gets a different answer from the summary, and the summary
suppresses the page's own warning signal.

**Fix.** Give Overbought its own chip (5 states, matching the column), and unify the three
vocabularies onto one enum used by chips, column and spectrum alike.
**Effort** S · **Confidence** high

---

### Cross-cutting findings

---

#### UX-32 · P2 · Two independent freshness indicators sit side by side and can contradict each other

**Evidence.** Observed live on `/stock/AAPL` and `/sector/technology`: the header renders
`● LIVE` immediately followed by `● live` — two separate widgets:

* `app/stock/[ticker]/page.tsx:360` — a pill driven by **stream state**:
  `live.connected ? (live.marketOpen ? 'LIVE' : 'CLOSED') : 'RECONNECT'`.
* `components/DataFreshnessIndicator.tsx:57-72` — driven by **quote-timestamp age**:
  `<10s → "Live"`, `<120s → "~Ns ago"`, `≥120s → "Stale — refresh"`.

They measure different things, so a connected stream delivering stale quotes renders
**`LIVE` next to `Stale — refresh`**. At best the pair is redundant ("LIVE live"); at worst it
is a direct contradiction about whether the price on screen can be traded on.

Note that `DataFreshnessIndicator` is the *good* component — relative age, three graded states,
proper `role="status"` + `aria-live` + a full `aria-label`. It is used on exactly **two** pages
(`app/desk/page.tsx`, `app/sector/[slug]/page.tsx`); the homepage's bare
`Updated {toLocaleTimeString()}` (UX-4), `/heatmap`'s `Poll · …`, `/backtest`'s
`Last computed …` and `/ma-deviation`'s `Computed: …` each reinvent it worse.

**Fix.** Make `DataFreshnessIndicator` the single freshness SSOT on every page; fold the
connection state into it as a fourth variant (`RECONNECTING`) instead of a second widget.
**Effort** S · **Confidence** high

---

#### UX-33 · P2 · Three of the six data tables cannot be sorted — including the two that most need it

**Evidence.**

| Table | Sortable | Anchor |
|---|---|---|
| `/ma-deviation` | ✅ `aria-sort` + 4 keys | `app/ma-deviation/page.tsx:151-171` |
| Backtest → Instruments | ✅ | `components/backtest/InstrumentTable.tsx:29-55,94` |
| Backtest → Signals | ✅ | `components/backtest/LiveSignalsPanel.tsx:24-25,244-246` |
| **`/desk` quote strip (28 rows)** | ❌ | `app/desk/page.tsx` — no `sortKey` |
| **`/commodities` (12+ rows)** | ❌ | `app/commodities/page.tsx` — no `sortKey` |
| `/risk/scenarios` (6 rows) | ❌ | `app/risk/scenarios/page.tsx` |

`/desk`'s stated purpose is "scan for outliers (large % moves vs sector average)" — the exact
task a sort on `Chg %` performs — and it is the one table where sorting is missing. Both
unsortable tables render in fixed declaration order.

**Impact.** The trader must visually scan 28 rows to find the biggest mover on the page
designed for exactly that, while the same interaction works two pages away.

**Fix.** Extract the `SortTh` + sort-state pattern already written in
`app/ma-deviation/page.tsx:123-146` into a shared hook/component and apply it to `/desk` and
`/commodities`, defaulting `/desk` to `|Chg %|` descending. **Effort** S · **Confidence** high

---

#### UX-34 · P2 · Clicking "Sign in" shows end users a deployment runbook

**Evidence.** `/auth/signin` — reachable from the "Sign in" button in the global header on
every page — renders a panel headed "OAuth not configured" containing:
`openssl rand -base64 32`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL=https://your-deployment.vercel.app`,
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` with callback paths, the same for GitHub,
"Copy variable names from `.env.example` in the repo", "See README → OAuth setup", and
instructions to navigate Vercel → Project → Settings → Environment Variables and redeploy.

**Explicitly not re-flagging the env state itself** — that is owner-gated and on the
do-not-flag list. The finding is that the *fallback UI for that state* is written for the
repo's maintainer and is shipped to the public.

The page does get one thing right that no other route does: it is the **only** page with its
own `metadata.title` (`app/auth/signin/page.tsx:7-8` → "Sign in · QUANTAN"), which is the
pattern UX-10 asks for everywhere else.

**Impact.** Any prospective user clicking the most prominent button in the header is shown
secrets-management instructions and the project's internal file names.

**Fix.** Show a user-facing message ("Accounts aren't enabled yet — everything on QUANTAN
works without one; your watchlist is saved in this browser") and move the setup runbook behind
a dev-only condition (`process.env.NODE_ENV !== 'production'`) or into the README.
**Effort** S · **Confidence** high

---

#### UX-35 · P3 · The chart legend advertises "Dark Pool" and "News" series that carry no data

**Evidence.** `components/KLineChart.tsx:390-397` renders the `● Dark Pool` and `▲ News` legend
entries **unconditionally**, regardless of whether the marker arrays are populated.
On `/crypto/btc` the page passes `EMPTY_DARK_POOL_MARKERS`
(`components/crypto/BtcChartPanel.tsx:94`), so the BTC chart legends a dark-pool series that
(a) has zero points and (b) does not exist as a concept for crypto — there is no FINRA
off-exchange print reporting for Bitcoin. `newsMarkers` was empty on every chart response
observed (`/api/chart/AAPL?range=1Y` → `newsMarkers: 0`), so the News entry is unpopulated
everywhere too.

**Fix.** Render each legend entry only when its marker array is non-empty. **Effort** S ·
**Confidence** high

---

#### UX-36 · P3 · `/risk/scenarios` reports identical greeks under all six shocks

**Evidence.** Live: every one of the six scenarios (Fed +100bps, S&P −10 %, VIX +50 %,
2008-style, COVID crash, Flash crash) reports **Δ = 150.0** and **Vega = −1500**. Only P&L
varies. A stress table whose greeks are invariant under the stress is showing the *unshocked*
position repeated six times. Losses are also rendered in default slate rather than the red used
for negative values everywhere else on the platform, so a −37 % row reads visually neutral.

To its credit this page carries the disclosure the rest of the risk surface lacks —
"Demo portfolio — wire live positions in Phase 16" — which is why this is P3 and UX-27 is P0.

**Fix.** Either reprice greeks per scenario or drop the two columns until they are shocked;
apply the standard negative-value colour to the P&L columns. **Effort** S ·
**Confidence** high

---

### Mobile (375 × 812) — summary

Good news first: **no page produced horizontal document scroll**, and wide tables correctly
scroll inside their own `overflow-x-auto` containers (`/desk`: `scrollWidth 387 > clientWidth
349` on an inner container, document `scrollWidth === 375`). The responsive plumbing is sound.
What fails at mobile width is what the layout chooses to put first, plus two chart issues:

* **UX-3 at mobile** — sector grid at y = 2191 on an 812 px viewport (≈3 screens down);
  page 6381 px tall.
* **UX-19 at mobile** — `/desk` quote table starts at y = 956: **zero quote rows on the first
  screen**.
* **UX-23 at mobile is materially more dangerous** — the 15-pill timeframe rail wraps to two
  rows as `1m 3m 5m 15m 1H 4H 1D 1W` / `1M 3M 6M 1Y 2Y 5Y ALL`, which places **`1M` directly
  beneath `1m`** as the first pill of consecutive rows. The two tokens that differ only by
  letter case become vertically adjacent tap targets.
* **Chart legend occludes the chart** — on `/stock/AAPL` at 375 px the floating legend
  (`components/KLineChart.tsx:364`, `absolute … left-3 right-3 z-10`) wraps to four lines and
  covers roughly the top third of an already-short plot, and gains its own internal horizontal
  scrollbar. Combined with UX-7 the mobile chart is effectively unusable.
  **Fix:** collapse the legend to price + change on narrow viewports and move the indicator
  swatches below the plot. **Effort** S · **Confidence** high

---

### Trading view — table-stakes features, verified against the rendered control set

Controls that **are** present and work (not deficiencies): 15-token timeframe rail; overlay
chips EMA / VWAP / BB / Fib / All; a Chart Indicators panel offering **20 moving-average
periods** (4…250) with multi-select; VWAP, BB(20,2), Fib and Vol SMA(20) toggles with ON/OFF
state; RSI(14), MACD(12,26,9) and ATR(14) sub-panes; a `role="img"` + `aria-label` text
alternative for the canvas; and an accessible chart-failure fallback. That is a genuinely
strong indicator set. The gaps below were each verified against what the DOM actually renders.

---

#### UX-37 · P1 · The crosshair OHLCV readout is fully implemented and never rendered on any chart page — while the on-page guide promises it

**Evidence.** `components/KLineChart.tsx:190`:

```ts
const showBuiltinTimeframes = hideTimeframeSelector !== true && onTimeframeChange != null
```

All three call sites pass `hideTimeframeSelector` (because each page owns its own range rail):
`app/stock/[ticker]/page.tsx:479`, `app/sector/[slug]/page.tsx:501`,
`components/crypto/BtcChartPanel.tsx:99`. The crosshair O/H/L/C/Vol readout lives at
`components/KLineChart.tsx:336-353`, **inside** the `{showBuiltinTimeframes && (…)}` block
opened at `:311`. It is therefore unreachable on every page in the product. The hook still
subscribes to crosshair moves and maintains `crosshairData` on every mouse move — the value is
computed and thrown away.

**Verified live**: hovering the AAPL chart draws the crosshair and its axis labels, and shows
**no OHLCV values anywhere**; the legend keeps displaying the *last* bar's numbers, not the
hovered bar's.

**And the interface promises this feature.** The `/sector/technology` DashboardGuide reads,
verbatim: "*Hover crosshair shows OHLCV at any bar.*"

**Impact.** Reading open/high/low/close/volume at a chosen bar is the single most-used chart
interaction for a professional. It is documented on-page, invisible in practice, and the code
to fix it already exists.

**Fix.** Move the crosshair readout out of the `showBuiltinTimeframes` block — render it in
the always-present legend row (replacing the last-bar summary while hovering, restoring it on
mouse-out). Roughly a block move. **Effort** S · **Confidence** high

---

#### UX-38 · P2 · Daily charts stamp a meaningless time-of-day on the crosshair, in the viewer's timezone

**Evidence.** Hovering the AAPL **1Y daily** chart shows the time-axis label
**`21 Jul '26 03:30`** — a wall-clock time on a daily bar, rendered in the browser's local zone
(`Asia/Singapore` here), i.e. a US daily close labelled 03:30. Root cause:
`hooks/useKLineChart.ts:351` sets `timeScale: { … timeVisible: true, secondsVisible: false … }`
unconditionally, for daily and intraday alike.

**Impact.** Traders read the crosshair label to identify the bar; a spurious local-time
component makes daily bars look intraday and misidentifies the session date near midnight
boundaries.

**Fix.** Set `timeVisible` from the active range (`isStockIntradayPollRange(range)` — the same
SSOT that fixes UX-22), and format intraday labels in exchange time rather than browser-local.
**Effort** S · **Confidence** high

---

#### UX-39 · P2 · VWAP / BB / Fib each have two separate controls on the same screen, and the 20 MA buttons are 20 × 21 px

**Evidence** (measured live on `/stock/AAPL`, indicator controls audited for roles, state and
keyboard):

*The semantics are good* — every overlay switch is a real `<button>` with correct
`aria-pressed` (`VWAP false`, `BB(20,2) false`, `Fib false`, `Vol SMA(20) true`), and all 20
moving-average buttons carry `aria-pressed` **and** an action-phrased `aria-label`
(`"Show EMA4"` / `"Hide EMA9"`), all keyboard-focusable. This is the best-instrumented control
cluster in the product. Two problems remain:

1. **Duplicated controls.** `VWAP`, `BB` and `Fib` appear **twice**: as chips in the row above
   the chart (x = 487/543/582, y = 299) *and* as labelled ON/OFF switches in the sidebar
   "Chart Indicators" panel. Same state, two widgets, two visual languages, no indication they
   are linked. The chip row additionally offers `EMA` and `All`, which have no sidebar
   equivalent, so neither control is a superset of the other.
2. **Target size.** The MA period buttons measure **20 × 21 px** (and 26 × 21 / 33 × 21 for the
   two- and three-digit periods) — below the 24 × 24 CSS px minimum for a pointer target, in a
   grid of 20 packed into a narrow sidebar. On touch these are unhittable without zooming.
   (Filed as a UX/target-size finding, not an axe result — axe does not check this rule by
   default, so it is not covered by the closed #139 wave.)

**Fix.** Pick one home for overlay toggles — keep the sidebar panel (it has labels and explicit
ON/OFF) and reduce the chip row to a preset selector, or vice versa. Raise the MA buttons to a
≥ 24 px hit area with padding while keeping the compact visual.
**Effort** S · **Confidence** high

---

### Cross-page workflow: signal → evidence → action

Traced end-to-end as a trader would: **home → sector card → sector page → chart → dark pool →
stock page → back**.

**What works.** Every sector card, heatmap tile, breadth chip and desk row is a real link to
`/sector/[slug]`; the sector page cross-links to five sibling sectors; `/desk` has a per-row
"Drill → chart" affordance; the ⌘K search resolves to `/stock/[ticker]` and keeps a recent-
searches list with per-item removal; `Watchlist` buttons persist to `localStorage`; the
breadcrumb trail is present on every deep route. There are **no navigational dead ends** in
the sector→stock path, and the empty state for a failed search is well written
("No Yahoo matches. Try a symbol (e.g. MSFT) and press Enter.").

**Where the chain breaks — all already filed above, listed here as workflow consequences:**

1. **Signal → evidence fails at the chart.** The trader arrives at `/sector/technology` or
   `/stock/AAPL` to verify a move and the chart is 85–94 % dead space (UX-7), the change % on
   it contradicts the header (UX-8), and they cannot read OHLCV at a bar (UX-37).
2. **Evidence → conviction fails at the dark pool.** The "institutional flow" evidence the
   guide sends them to is PRNG output (UX-6), unlabelled precisely when real data is present.
3. **The briefs branch is severed.** "View all briefs →" on the home page and the "Briefs" nav
   item both land on an empty page or a hard error (UX-26).
4. **There is no action step.** The workflow terminates at analysis: no alert, no watchlist→
   monitor view, no note, no export, no position sizing from the chart. `/portfolio` — the
   only page that could close the loop — shows fabricated alerts (UX-27) and an npm command
   (UX-28).
5. **Vocabulary shifts at every hop**, so the trader re-learns the same concept three times:
   BUY/SELL/HOLD vs UP/DOWN/NEUTRAL (UX-2), four labels for the session-move number (UX-1),
   three taxonomies on `/ma-deviation` (UX-31), three sign conventions for change % (UX-24).

**The highest-yield workflow addition** (new, not a defect fix): the watchlist is already
persisted and has a button on every instrument page, but there is **no page that shows the
watchlist**. `hooks/useWatchlist.ts` exists, `/desk` has a "Watchlist only" filter — surfacing
a watchlist view would convert the existing storage into the missing "monitor" step for ~S
effort.

---

### Coverage

| Route | Audited | Data loaded | Mobile checked |
|---|---|---|---|
| `/` | ✅ | ✅ | ✅ |
| `/backtest` | ✅ | ✅ (12.3 s wait) | — |
| `/briefs` | ✅ | **broken** | — |
| `/briefs/sector/technology` | ✅ | **hard error** | — |
| `/commodities` | ✅ | ✅ | — |
| `/crypto` → `/crypto/btc` | ✅ (redirect) | ✅ | — |
| `/crypto/btc` | ✅ | ✅ | — |
| `/desk` | ✅ | ✅ | ✅ |
| `/heatmap` | ✅ | ✅ | — |
| `/ma-deviation` | ✅ | ✅ | — |
| `/portfolio` | ✅ | fallback state | — |
| `/portfolio/factor-attribution` | ✅ | zeros | — |
| `/risk/scenarios` | ✅ | ✅ (demo, labelled) | — |
| `/sector/technology` | ✅ | ✅ | — |
| `/stock/AAPL`, `/stock/MSFT` | ✅ | ✅ | ✅ |
| `/stock/AAPL` → Dark Pool tab | ✅ | ✅ | — |
| `/stock/AAPL` → Quant Lab tab | ✅ | ✅ | — |
| `/stock/APPLEZZZQQQ` (invalid) | ✅ | error path | — |
| `/auth/signin` | ✅ | n/a | — |

**Controls exercised** (not just read): ⌘K search (typing, no-match empty state, Enter-to-
navigate, direct-ticker route), the `/backtest` tablist (arrow keys — inert), the `/backtest`
instrument filter, the `/stock` tablist (arrow keys + roving tabindex — correct), the
chart timeframe rail (`1m` selection → wrong badge), the chart crosshair (hover — no OHLCV),
the IndicatorPanel overlay switches and all 20 MA period buttons (roles, state, size), and the
homepage sector filter chips.

**Checked and clean — no finding:** `/stock/AAPL` → **Quant Lab** was scanned for the
`NaN`/`Infinity` leakage UX-5 predicts (`TechnicalsTab.tsx` has 34 raw `.toFixed`,
`SummaryTab.tsx` 14) — **zero bad tokens** in the rendered output on AAPL. Quant Lab is in fact
the best-documented surface in the product: an explicit DATA LINEAGE block naming every Yahoo
module used, an ISO-8601 fetch timestamp, a freshness indicator, a cache-window note, and a
"transparent heuristics, not an unbiased oracle" caveat. UX-5 therefore stands as a
maintainability/robustness finding, not an observed defect.

---

## Severity roll-up

**39 findings — P0 = 5, P1 = 14, P2 = 15, P3 = 5.**

| Sev | Count | IDs |
|---|---|---|
| **P0** | 5 | UX-6, UX-7, UX-8, UX-26, UX-27 |
| **P1** | 14 | UX-1, UX-2, UX-3, UX-9, UX-13, UX-14, UX-15, UX-19, UX-20, UX-22, UX-23, UX-28, UX-30, UX-37 |
| **P2** | 15 | UX-4, UX-5, UX-10, UX-11, UX-12, UX-16, UX-17, UX-24, UX-29, UX-31, UX-32, UX-33, UX-34, UX-38, UX-39 |
| **P3** | 5 | UX-18, UX-21, UX-25, UX-35, UX-36 |

Two of the P0s (UX-26, UX-27) and one P1 (UX-28) are **live production failures**, not design
opinions: a nav section that errors, fabricated risk advice, and a page instructing users to
run an npm script.

---

## TOP 10 BY YIELD

Ranked by (trader impact × number of surfaces fixed) ÷ effort. Every entry has a file:line
anchor and a live observation in its full write-up above.

| # | ID | Sev | What | Effort | Why it ranks here |
|---|---|---|---|---|---|
| 1 | **UX-7** | P0 | Charts render the whole series in 5–15 % of the pane; re-fit on resize / after layout (`hooks/useKLineChart.ts:563-570`, `:827-829`) | **S** | One callback fixes the primary chart on `/stock`, `/sector` and `/crypto/btc`. Measured 84.7 % dead space on AAPL, 94.2 % on BTC — and **forcing a resize repairs it live**, so the fix is pre-validated. Largest visible-quality gain per line changed in the audit. |
| 2 | **UX-6** | P0 | Dark-pool block prints are seeded PRNG output; the `ILLUSTRATIVE` badge is suppressed exactly when real data loads (`lib/mockData.ts:34-61`, `components/DarkPoolPanel.tsx:238-242`) | S | Verified on AAPL: **no badge, and every fabricated print priced ≈ $100 while AAPL trades $305.40**, under a "Source: Yahoo Finance" line. The badge condition is inverted against the trader's interest; two summary tiles and the flow gauge carry no label at all. |
| 3 | **UX-26** | P0 | `/briefs` empty + `/briefs/sector/*` hard error while `/api/briefs/*` returns 200 (`app/briefs/page.tsx:33`, `lib/appUrl.ts:5-7`) | M | An entire top-level nav section is **down in production right now**. Killing the SSR self-fetch also removes 11 network round-trips per page view. Nothing else on the list is a live outage. |
| 4 | **UX-27** | P0 | `/portfolio` renders hardcoded constants as personal tail-risk alerts *with hedging instructions*, no label (`components/risk/TailRiskBanner.tsx`) | **S** | Fabricated position-specific advice is the platform's biggest trust/compliance exposure. `/risk/scenarios` already ships the correct disclosure — copy it. Two-line fix. |
| 5 | **UX-8** | P0 | Chart legend % is `(close−open)/open`, not vs prior close — shows red ▼ beside the header's green ▲ (`components/KLineChart.tsx:269-274`) | **S** | Two contradictory directional colours for one instrument on one screen, on three pages. A handful of lines. |
| 6 | **UX-37** | P1 | Crosshair OHLCV readout is written but gated off on every page (`components/KLineChart.tsx:311` vs `:336-353`) | **S** | The most-used chart interaction there is, already implemented, promised verbatim by the on-page guide, unlocked by moving one block out of a conditional. |
| 7 | **UX-1 + UX-2** | P1 | One session-move number under four labels (incl. "Avg Confidence" and no label at all), and BUY/SELL/HOLD filter chips over UP/DOWN/NEUTRAL cards (`app/page.tsx:348,451`, `components/SignalCard.tsx:62,88-96`) | **S** | Both are the homepage telling a trader a normalised move size is a probability and a direction is a recommendation. Pure copy/SSOT work, no logic risk. |
| 8 | **UX-3 + UX-19** | P1 | Nothing decision-relevant above the fold: sector grid 506 px (desktop) / 1379 px (mobile) below it; `/desk` opens with a 387 px instruction panel | M / S | Measured, not taste. Fixes the first five seconds of the two pages traders open most, and `/desk` is a one-line default flip. |
| 9 | **UX-22 + UX-23** | P1 | `1m` labelled "DAILY+ BARS" (`app/stock/[ticker]/page.tsx:451`), and one flat rail mixes interval with range so `1m`/`1M` sit adjacent — vertically stacked on mobile | S / M | UX-22 is a wrong factual claim about the chart and the SSOT to fix it already exists (`lib/chartYahoo.ts:12-13`). Ship UX-22 first, UX-23 next. |
| 10 | **UX-13 + UX-14** | P1 | `/backtest` blocks 12 s on a blank spinner, and states its transaction cost as both "≈22 bps" and "~11bps round-trip" (`components/backtest/OverviewTab.tsx:37` vs `lib/backtest/executionModel.ts:26`) | M / **S** | UX-14 is a one-string fix on the row professionals check first, and it contradicts the engine's own SSOT — highest credibility-per-byte on the list. |

**Suggested wave-1 edit slice (all S, disjoint files, ~1 day):**
UX-7 (`hooks/useKLineChart.ts`) · UX-8 + UX-37 + UX-35 (`components/KLineChart.tsx`) ·
UX-27 (`components/risk/TailRiskBanner.tsx`) · UX-14 (`components/backtest/OverviewTab.tsx`) ·
UX-22 (`app/stock/[ticker]/page.tsx`) · UX-1 + UX-2 (`app/page.tsx`, `components/SignalCard.tsx`) ·
UX-6 (`components/DarkPoolPanel.tsx`) · UX-19 (`components/DashboardGuide.tsx`).
UX-26 and UX-28 are their own slice (deployment/data-path, not styling).

**Deliberately not proposed:** any change to a published performance figure (WR, alpha, the
42-point floor on the session-move scale) — those are owner-gated; the findings above change
only labels, colours, ranks and units.


