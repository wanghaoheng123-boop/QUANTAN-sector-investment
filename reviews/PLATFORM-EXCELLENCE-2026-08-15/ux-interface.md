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

**Root cause.** `hooks/useKLineChart.ts:563-570` — the `ResizeObserver` pushes the new width
into all four charts with `applyOptions({ width })` but **never re-runs `fitContent()`**.
lightweight-charts preserves `barSpacing` and the right anchor across a width change, so the
series stays at whatever spacing it was fit to and the extra width becomes dead space on the
left. `fitContent()` is only called in the data effect (`:827-829`, `:817`), which runs before
the container reaches its final width.

**Impact.** The chart is the core of three of the platform's pages and it is unreadable at
rest; every trader must manually zoom before doing any technical work.

**Fix.** Call `fitContent()` on all four charts inside the `ResizeObserver` callback (or
preserve the *visible time range* across the width change rather than the bar spacing), and
guard the initial `createChart` against a zero/partial container width. One-line-ish change
with an outsized payoff. **Effort** S · **Confidence** high

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

**Impact.** Cosmetic for 1–4-char tickers, broken for the 5-char (`GOOGL`, `BRK.B`) and
crypto-pair symbols the search will happily route to.

**Fix.** Truncate to 4 characters inside the tile with the full symbol on the `<h1>`, or size
the tile with `min-w-12 px-2 w-auto` and scale the font down past 4 characters.
**Effort** S · **Confidence** med (measured on an 11-char symbol; 5-char case inferred)

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

