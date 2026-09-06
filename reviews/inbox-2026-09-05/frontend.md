# Frontend deep inspection — 2026-09-05

Territory: `app/` (pages/layouts, not API routes), `components/`, `hooks/`.
Ids `Q110-F1`–`Q110-F29` reserved. No edits made to source — every item below
is a `file:line` finding with a proposed diff for the lead to apply.

**Methodology note on CONFIRMED.** Nothing here was observed failing in a
running browser — this pass is static reading only. "CONFIRMED" means I read
the full code path end to end (state declarations, effect dependency arrays,
cleanup functions, and the render branch that consumes the state) and the
defect follows deterministically from that reading, not from a plausible
guess. "PLAUSIBLE" is used only where the defect's manifestation depends on a
runtime property I could not verify directly from the repo.

**Remount premise, resolved once, used everywhere below.** Several findings
depend on whether Next.js App Router remounts a page's client component when
navigating between two URLs matched by the *same* dynamic segment (e.g.
`/stock/AAPL` → `/stock/MSFT`). I searched for the only two things that would
force a remount: `find app -iname "template*"` returns **zero** files (only
`template.tsx` forces a remount per navigation in App Router; `layout.tsx`
deliberately does not), and `grep -rn "key={" app` (checked above) shows no
`key` is ever placed on a `page.tsx` default export or passed down through the
route tree — all `key=` usage in `app/` is on ordinary list children inside a
page. So: **same-route-tree navigation does not remount; cross-tree navigation
does.** `/stock/A` → `/stock/B` and `/sector/A` → `/sector/B` do NOT remount.
`/stock/A` → `/sector/B` DOES (different leaf segment under a different
ancestor). This is the same premise `Q107-F3` already relies on and treats as
established; I am not re-deriving it, just citing the search that grounds it.

---

## 1. Where the UI states something it does not know

### Q110-F1 — `hooks/useLiveQuote.ts:102-258` — stale quote survives a ticker-identity change (root cause) — **HIGH — CONFIRMED**

The effect that owns the SSE subscription depends on `[ticker, supported]`
(:258). When `ticker` changes, the cleanup closes the old `EventSource` and
the effect body reopens a new one for the new ticker — but **`quote`,
`marketOpen`, `lastMessageAt` are never reset.** Only `connected` is set to
`false` (:119, :211, :232, :256). So `useLiveQuote(ticker)` keeps returning
the **previous ticker's** `LiveQuote` object — price, change%, and timestamp —
until the new stream's first `quote` event arrives (could be 1–15s depending
on server poll cadence) or a boot REST fetch overwrites it at the call site.

This is the mechanism feeding both `app/stock/[ticker]/page.tsx:220-230` and
`app/sector/[slug]/page.tsx:185-198`, whose merge effects key on `[live.quote]`
— if `live.quote`'s object identity doesn't change (because the hook didn't
reset it), the merge effect doesn't even re-fire, so the OLD ticker's price
sits in the page's own `quote` state untouched until something else
overwrites it.

**Proof this is a gap, not a design choice:** the sibling hook
`hooks/useLiveQuotes.ts` (plural, multi-ticker) explicitly resets per-symbol
state on ticker-list identity change, with a documented "preserve overlap,
forget the rest" policy (:151-165: `setQuotes((prev) => { ... next[t] =
prev[t] ?? null ... })`, `setOpenBySymbol` same pattern). The plural hook is a
positive control: the author clearly knows identity changes need a reset:
the singular hook simply never got the same treatment.

**This fix alone does not change what the user sees — it must land with F2.**
Trace it: with only this fix applied, navigating AAPL→MSFT resets the hook's
own `quote` to `null`, so the page's merge effect (`useEffect(...,
[live.quote])`) re-fires on the identity change (dependency went from an
object to `null`) — but its body is `if (!live.quote) return`, so it does
nothing, and the **page's own, separately-owned `quote` state (never reset —
see F2) still renders AAPL's price under MSFT's header.** This finding is
source-level correctness and closes the gap for any *future* consumer of the
hook; F2 is the change that actually fixes the pixels on the two pages
audited here. Apply both, not either.

**Click path:** every page mounts `GlobalSearch` from the root layout
(`app/layout.tsx:86`), which does `router.push(\`/stock/${symbol}\`)`
(`components/GlobalSearch.tsx:144`) — searching from `/stock/AAPL` to
`/stock/MSFT` is a first-party, always-available, high-traffic control, not a
hypothetical.

**Proposed diff:**
```diff
--- a/hooks/useLiveQuote.ts
+++ b/hooks/useLiveQuote.ts
@@ useEffect(() => {
     if (!supported || !ticker) {
       setConnected(false)
       return
     }
 
+    // A ticker/sector-identity change subscribes to a NEW stream. The
+    // previous ticker's quote must not survive into the new subscription —
+    // otherwise the caller renders one security's price/timestamp under a
+    // different security's name until the first new `quote` event arrives.
+    // Mirrors the per-symbol reset in the sibling multi-ticker hook
+    // (useLiveQuotes.ts:151-165).
+    setQuote(null)
+    setMarketOpen(false)
+    setLastMessageAt(null)
+    setError(null)
+
     closedManuallyRef.current = false
     reconnectAttemptRef.current = 0
```

---

### Q110-F2 — `app/stock/[ticker]/page.tsx` + `app/sector/[slug]/page.tsx` — chart candles and page-level quote are never cleared on identity change — **HIGH — CONFIRMED**

Independently of F1 (page-owned state, not the hook's): `candles` (stock
:65, sector :46) is set only on fetch success/failure/empty
(`setCandles(data.candles)` stock :130, sector :109) or the initial `[]`.
**Nothing clears it when `ticker`/`sector.etf` changes.** `fetchChartData` is
recreated per-identity (`useCallback(..., [ticker])` stock :144, `[sector.etf]`
sector :122) and the effect that calls it re-fires on that recreation
(stock :175-180, sector :125-129) — but the fetch call itself only sets
`setLoading(true)`/`setChartError(null)`, never `setCandles([])` (stock
:104-106, sector :78-80).

Render logic (stock :470, sector :488): `loading && candles.length === 0 ?
<skeleton> : candles.length > 0 ? <KLineChart candles={candles} ticker={ticker} .../> : ...`.
Once a chart has loaded once, `candles.length` is never 0 again just because
the fetch restarted, so the **first branch is false** and the **third branch
renders the OLD ticker's full candle series under the NEW ticker's chart
header** (`{ticker} · Advanced Technicals`, stock :455; `{sector.etf} ·
Candlestick Chart`, sector :477) with no stale badge, for the duration of the
fetch. `KLineChart` itself has no ticker-keyed reset — it only uses `ticker`
for aria text (`grep -n "ticker\b" components/KLineChart.tsx` → 4 hits, all
aria strings at :443-449).

The page's own `quote` state has the identical shape: boot fetch
(`fetchQuote`, stock :154; equivalent sector :157-177) is recreated per
identity and re-fires, but nothing clears `quote` first, so the header price
(the single most prominent number on the page) shows the previous ticker's
price/change under the new ticker's name until the boot fetch resolves.

**Click paths:** stock↔stock via `GlobalSearch` (above). Sector↔sector via
the always-visible "Other Sectors" list, `app/sector/[slug]/page.tsx:598-611`
(`<Link key={s.slug} href={\`/sector/${s.slug}\`}>`).

**Why not just clear inside `fetchChartData`:** that function also runs on
every `activeRange` change and every intraday poll tick (stock :183-198,
sector :132-146, every 30-60s). Clearing `candles` there would flash the
chart to the loading skeleton on every routine poll — a regression, not a fix.
The reset needs to be a **separate effect keyed only on identity**:

**Proposed diff (pattern shown for stock; identical shape for sector, keyed
on `sector.etf`):**
```diff
--- a/app/stock/[ticker]/page.tsx
+++ b/app/stock/[ticker]/page.tsx
@@
+  // Reset chart + quote state on ticker-identity change. Deliberately a
+  // separate effect from fetchChartData/fetchQuote — those also fire on
+  // range changes and the intraday poll tick, and clearing state there
+  // would flash the chart to "loading" every 30-60s during normal polling.
+  useEffect(() => {
+    setCandles([])
+    setChartError(null)
+    setQuote(null)
+    setQuoteError(null)
+  }, [ticker])
+
   const fetchChartData = useCallback((range: string, signal?: AbortSignal) => {
```

---

### Q110-F3 — `app/sector/[slug]/page.tsx:191-194` — previous sector's 52W/P·E survive into the new sector's header (distinct from `Q107-F9`) — **MEDIUM/HIGH — CONFIRMED**

**Not a re-report of `Q107-F9`.** F9 is about `lib/data/mergeQuotes.ts:124-126`
fabricating `0` when **both vendors are missing the field for the same
security**. This finding is a **client-side merge bug that fabricates a
number from a DIFFERENT security** and survives even after F9 is fixed
server-side:

```ts
setQuote((prev) => ({
  ...
  high52w: prev?.high52w ?? 0,
  low52w: prev?.low52w ?? 0,
  pe: prev?.pe ?? 0,
```

`prev` here is whatever `quote` held before this render. On a sector change
(XLE → XLK, say), if the SSE stream's first `quote` event for XLK arrives
before the boot REST fetch for XLK completes (a real race — SSE first-event
latency and REST latency are not ordered), `prev` is **still XLE's stale
quote** (per F2 — the page's `quote` state is never reset on identity
change), so this line quite literally writes **XLE's 52-week high under
XLK's name**, typed as a real number, rendered via `formatCurrency` with no
missing-flag. If F2 lands first (so `prev` is `null` on identity change
instead of stale), this degrades to the F9 shape (fabricated `0`) rather than
cross-security contamination — still wrong, just a different wrong. Either
way, **F9's `mergeQuotes.ts` fix does not reach this path** — it's a separate
fallback, in a separate file, in different territory.

**Proposed diff:**
```diff
--- a/app/sector/[slug]/page.tsx
+++ b/app/sector/[slug]/page.tsx
@@
   const [quote, setQuote] = useState<{
     price: number
     change: number
     changePct: number
-    volume: number
-    high52w: number
-    low52w: number
-    pe: number
+    volume: number | null
+    high52w: number | null
+    low52w: number | null
+    pe: number | null
     quoteTime?: string | null
   } | null>(null)
@@
-      volume: live.quote!.volume ?? prev?.volume ?? 0,
-      high52w: prev?.high52w ?? 0,
-      low52w: prev?.low52w ?? 0,
-      pe: prev?.pe ?? 0,
+      volume: live.quote!.volume ?? prev?.volume ?? null,
+      high52w: prev?.high52w ?? null,
+      low52w: prev?.low52w ?? null,
+      pe: prev?.pe ?? null,
```
And at the render sites (:331, :335, :339, :343), guard exactly like
`app/ma-deviation/page.tsx` already does elsewhere in this codebase:
`quote.high52w != null ? formatCurrency(quote.high52w) : '—'`, etc.

---

### Q110-F4 — `app/briefs/sector/[sector]/LiveBriefClient.tsx:65-93` — `brief` state never resynced when a fresh `initialBrief` arrives for a new `slug` — **LOW/MEDIUM (latent) — CONFIRMED code defect, reachability unclear**

```ts
const [brief, setBrief] = useState<SectorBrief | null>(initialBrief ?? null)
...
useEffect(() => {
  if (!slug || initialBrief) return   // ← skips when the server already gave us fresh data
  ...fetch...setBrief(data)...
}, [slug, initialBrief])
```

`useState`'s initial-value argument is evaluated once, on first mount, only.
If this component does not remount across a `slug` change (same premise as
above) and the parent server component (`page.tsx`, `force-dynamic`) hands
down a **fresh, truthy `initialBrief`** for the new slug (the normal case —
the server fetches before rendering), the effect's guard skips the fetch AND
never calls `setBrief`, so **`brief` is never updated.** Unlike F1-F3, this
does not self-heal on the next tick — there is no retry path once
`initialBrief` is truthy. Meanwhile `sector` (line 66,
`SECTORS.find(s => s.slug === slug)`) is recomputed fresh every render from
the `slug` prop, so the header (name/icon/color) updates correctly while the
body (price, 52W range, summary, holdings, news) stays frozen on the first
sector this component instance ever displayed — worse than transient, it
requires a full reload to correct.

**Reachability, stated honestly:** I searched for a first-party link that
goes directly from one `/briefs/sector/[sector]` page to a **different**
`/briefs/sector/[sector]` page without passing back through `/briefs` (which
would fully unmount the subtree and reset state legitimately). `grep -n
"briefs/sector" app/briefs/BriefCard.tsx app/briefs/page.tsx` shows
`BriefCard`'s link lives on the **list** page, not on the individual brief
page; `LiveBriefClient.tsx` itself links only to `/briefs` (back) and
`/stock/{ticker}` (different route tree — remounts). **I found no such
sibling-to-sibling link today**, so this defect is latent, not actively
triggered by any current click path. It is exactly the kind of defect that
stays invisible until a future feature (a "next sector" nav, related-briefs
carousel) adds one — flagging now while the fix is a 6-line effect, before
that surface exists.

**Proposed diff:**
```diff
--- a/app/briefs/sector/[sector]/LiveBriefClient.tsx
+++ b/app/briefs/sector/[sector]/LiveBriefClient.tsx
@@
   const [brief, setBrief] = useState<SectorBrief | null>(initialBrief ?? null)
   const [loading, setLoading] = useState(!initialBrief)
   const [error, setError] = useState<string | null>(null)
 
+  // Resync when the server hands us a fresh `initialBrief` for a NEW slug.
+  // Without this, a slug change that arrives with data already attached
+  // (the common case) is swallowed by the `initialBrief` guard below and
+  // `brief` never updates — see Q110-F4.
+  useEffect(() => {
+    setBrief(initialBrief ?? null)
+    setLoading(!initialBrief)
+    setError(null)
+  }, [slug])
+
   useEffect(() => {
     if (!slug || initialBrief) return
```

---

### Q110-F5 — `app/heatmap/page.tsx:108-121` — a sector whose quote never arrives renders a malformed `"+%"` tile, indistinguishable from "still connecting" — **MEDIUM — CONFIRMED (render defect) / PLAUSIBLE (reachability)**

```tsx
{loading && !quote ? (
  <skeleton/>
) : (
  <>
    <div>{sector.name}</div>
    <div className="text-2xl ...">{isUp ? '+' : ''}{quote?.changePct.toFixed(2)}%</div>
  </>
)}
```
`isUp = (quote?.changePct ?? 0) >= 0` is always `true` when `quote` is
missing, so `'+' ` renders. `quote?.changePct.toFixed(2)` — the WHOLE optional
chain short-circuits to `undefined` when `quote` is nullish (per spec, `a?.b.c`
stops at the first `?.` and the entire reference evaluates to `undefined`,
`.toFixed` is never invoked, so this doesn't throw) — React renders nothing
for `undefined`. Net visible result once `loading` becomes `false` but this
**one** sector's quote never showed up in that poll's `/api/prices` response:
the tile shows `{sector name}` and literally `"+%"` forever, colored neutral
gray (`bgColor = quote ? getHeatmapColor(...) : 'bg-slate-800'` — the color at
least doesn't lie), sitting next to fully-populated colored tiles with no way
to tell "still loading" from "never arrived" from "genuinely 0.00%". **The
render defect is CONFIRMED by reading this file end to end; whether a
single-sector-missing response is a real, reachable shape of `/api/prices` is
PLAUSIBLE, not confirmed** — that route is out of my territory and I did not
read it. The fix below is worth taking either way: it costs nothing on the
common path and only changes behavior in the gap case.

**Proposed diff:**
```diff
--- a/app/heatmap/page.tsx
+++ b/app/heatmap/page.tsx
@@
-                    {loading && !quote ? (
+                    {loading && !quote ? (
                       <div className="animate-pulse ...">...</div>
-                    ) : (
+                    ) : quote ? (
                       <>
                         <div className="text-xs text-white/70 ...">{sector.name}</div>
                         <div className="text-2xl font-bold text-white ...">
-                          {isUp ? '+' : ''}{quote?.changePct.toFixed(2)}%
+                          {isUp ? '+' : ''}{quote.changePct.toFixed(2)}%
                         </div>
                       </>
+                    ) : (
+                      <>
+                        <div className="text-xs text-white/70 ...">{sector.name}</div>
+                        <div className="text-sm text-white/50">No data</div>
+                      </>
                     )}
```

---

### Q110-F6 — `components/backtest/LiveSignalsPanel.tsx:76-107` — a missing `summary` payload renders as a measured "NEUTRAL" market regime — **MEDIUM — CONFIRMED**

`summary` is defensively defaulted to `{}` at :71 (the comment there already
explains this covers "API can return a payload without `summary`"). But the
downstream regime classifier doesn't distinguish "zero because the field was
absent" from "zero because the market is genuinely calm":
```ts
const buyCount = summary.buySignals ?? 0     // :76
const holdCount = summary.holdSignals ?? 0   // :77
const sellCount = summary.sellSignals ?? 0   // :78
const total = buyCount + holdCount + sellCount // :79
let marketRegimeLabel = 'NEUTRAL'            // :86
...
} else {
  regimeDesc = `${buyCount} BUY / ${holdCount} HOLD / ${sellCount} SELL across ${total} instruments.` // :107
}
```
When `summary` is genuinely absent, this renders **"⚖️ NEUTRAL — 0 BUY / 0
HOLD / 0 SELL across 0 instruments"** (:173 displays `marketRegimeLabel`) — a
confident, specific-looking market read that is actually "we have no idea."
This is the exact `0.00%`-reads-as-measured shape the invariant targets, on a
prominent badge on the backtest page.

**Proposed diff:**
```diff
--- a/components/backtest/LiveSignalsPanel.tsx
+++ b/components/backtest/LiveSignalsPanel.tsx
@@
+  // Reuse the same cast the `summary` fallback two lines below already
+  // performs — `signals.summary` is `Record<string, unknown>` at this point,
+  // and this repo's strict config forbids comparing an unnarrowed `unknown`.
+  const summaryMissing = (signals.summary as Record<string, number> | undefined) == null
   const buyCount = summary.buySignals ?? 0
   const holdCount = summary.holdSignals ?? 0
   const sellCount = summary.sellSignals ?? 0
   const total = buyCount + holdCount + sellCount
@@
-  } else {
+  } else if (summaryMissing) {
+    marketRegimeLabel = 'NO DATA'
+    regimeEmoji = '—'
+    regimeColor = 'text-slate-500'
+    regimeDesc = 'Signal summary unavailable in this payload — regime cannot be computed.'
+  } else {
     regimeDesc = `${buyCount} BUY / ${holdCount} HOLD / ${sellCount} SELL across ${total} instruments.`
   }
```

---

### Q110-F11 — `app/commodities/page.tsx` — no loading/connecting state on initial mount — **LOW — CONFIRMED**

There is no `loading` state at all (compare `heatmap/page.tsx`, which has
one). Every row already guards missing data correctly (`q ? q.price.toFixed(2)
: '—'` :137, similarly for change% :140-143 — this half is a **null result**,
worth naming: I checked every numeric cell in this table and all are properly
guarded, no fabricated zeros). But on first paint, before the first
`/api/prices` response lands, **every row shows `—`** with no distinct
"connecting" affordance — indistinguishable from "we asked and every single
commodity genuinely has no data," which is the inverse of the "spinner that
never resolves" failure mode named in the brief: here there's no spinner at
all, so a slow first fetch reads as total data loss.

**Proposed diff:** add a `loading` state (`true` initially, `false` in a
`finally` alongside the existing `fetchPrices`), and render a short
"Connecting…" state matching `heatmap/page.tsx`'s existing pattern before the
table when `loading && Object.keys(quotes).length === 0`.

---

## 2. Loading / empty / error states — enumerated across all 16 `page.tsx` files

Per the brief's own ask, this is a full enumeration, not a sample.
`find app -name "page.tsx"` → exactly 16 files (matches the "2 of 16" count
CLAUDE.md's I2 section already cites for `DataFreshnessIndicator`, confirming
this is the right denominator).

**5 of 16 have no client-side fetch lifecycle at all — loading/empty/error
don't apply the same way, and this is by design, not a gap:**
- `app/crypto/page.tsx` — a 3-line server redirect to `/crypto/btc`.
- `app/auth/signin/page.tsx` — server component, `getServerSession`, no client fetch.
- `app/portfolio/page.tsx` — reads a static JSON file at build/request time (`fs.readFileSync`), no client fetch.
- `app/portfolio/factor-attribution/page.tsx` — **already fixed** (its own
  header comment, dated, explains it used to fabricate a regression input and
  now explicitly reports "cannot compute" — this is the PRIME DIRECTIVE working, not a gap).
- `app/risk/scenarios/page.tsx` — static demo positions, labelled "Demo portfolio" in the visible copy.

**9 of 16 have a client fetch lifecycle with all three states present and
correctly differentiated** (spot-checked each for a loading branch, an empty
branch, and an error branch that render visibly different markup):
`app/backtest/page.tsx`, `app/briefs/page.tsx`,
`app/briefs/sector/[sector]/page.tsx` (+`LiveBriefClient`), `app/page.tsx`,
`app/ma-deviation/page.tsx` (best-in-class — every numeric cell across the
whole page is `!= null ? value : '—'`, no exceptions found), `app/desk/page.tsx`
(per-cell `q ? ... : '—'`, but see F9 below for a mobile-only gap in its
*freshness* indicator specifically, not its loading/empty/error states),
`app/stock/[ticker]/page.tsx` and `app/sector/[slug]/page.tsx` (both have
distinct loading/error/empty chart branches — see F2 for what's still wrong
inside the identity-change case specifically), `components/crypto/BtcQuantLab.tsx`
(explicit `candles.length < 30` guard before ANY computed value is rendered —
checked this one closely since several of its intermediate values default to
`?? 0`/`?? NaN`, e.g. `latestClose = closes[closes.length-1] ?? 0` at :184; all
of that is dead code with respect to rendering because of the guard at :332 —
**null result**, no bug).

**2 of 16 have gaps, named above:** `app/heatmap/page.tsx` (F5 — a
permanently-missing single tile has no distinct state) and
`app/commodities/page.tsx` (F11 — no initial-load state at all).

---

## 3. Stale-across-navigation

Covered in full above: F1 (hook root cause), F2 (stock/sector page-level
state), F3 (sector cross-security contamination), F4 (briefs, latent).

**Also searched and found clean:** `hooks/useLiveQuotes.ts` (plural) — used
only by `app/page.tsx` with a `useMemo`'d, effectively-static ticker list
(`SECTORS.map(s => s.etf)` etc., never per-navigation identity) — resets
correctly on the rare case its key does change (:151-165), and is the
positive control cited in F1. `components/crypto/BtcQuantLab.tsx` /
`BtcChartPanel` — BTC is a single fixed instrument, no identity to go stale
across (searched for a second crypto route or symbol switcher; `app/crypto/page.tsx`
is a redirect stub, there is no second symbol).

`hooks/useLivePrices.ts` (SWR, `keepPreviousData: true`) — this is the exact
blind spot CLAUDE.md's I2 section names as unaudited ("hooks/ SWR
keepPreviousData is unchecked"). Traced its **only** consumer:
`app/desk/page.tsx`. Its ticker list (`DESK_TICKERS`) is a fixed module
constant, never identity-varying per navigation, so `keepPreviousData` here
means "keep showing last-known quotes across a failed background refresh,"
not "show ticker A's data under ticker B's name" — a real design tradeoff
(avoid flicker on a 2-15s poll) rather than a stale-identity bug. The
`error &&` banner (desk :167-170) does surface a fetch failure, but note F9
below: the ONE freshness signal for this page is hidden on mobile, so a
degraded-but-not-erroring feed (stale timestamps, still 200 OK) has no
visible signal on phones at all.

---

## 4. Accessibility / interaction correctness

### Q110-F7 — roving `tabindex` without a matching focus move — `app/stock/[ticker]/page.tsx:397-418`, `app/sector/[slug]/page.tsx:425-450` — **MEDIUM — CONFIRMED**

Both tab bars implement `role="tablist"` with `tabIndex={activeTab === tab ?
0 : -1}` — a real roving-tabindex pattern — and both `onKeyDown` handlers
correctly compute the next tab and call `setActiveTab(next)` on
ArrowLeft/ArrowRight. But neither ever moves **DOM focus**:

```tsx
onKeyDown={(e) => {
  const tabs = STOCK_MAIN_TABS.map(([t]) => t)
  const idx = tabs.indexOf(activeTab)
  if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(tabs[(idx + 1) % tabs.length]) }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length]) }
}}
```
The `onKeyDown` is bound on the **container** `role="tablist"` div, and `idx`
is read from `activeTab` (state), not from the focused element — so the
handler keeps working correctly on repeated presses via event bubbling from
whichever button still has focus; **arrow-key cycling itself does not break.**
The real defect is narrower: after `setActiveTab` fires, the OLD tab button
(the one that actually still holds DOM focus) becomes `tabIndex={-1}` on the
next render, while the NEWLY active tab (`tabIndex={0}`, `aria-selected`)
never receives focus. So the browser's visible focus ring stays on a button
that is no longer the selected tab — a direct mismatch between visual focus
and application state (WCAG 2.4.7 / APG roving-tabindex requires exactly one
focused, `tabIndex=0` element in the group at all times, not two states that
silently diverge). Concretely: a sighted keyboard user sees the outline
sitting on the wrong tab after every arrow press; if focus later leaves the
tablist and the user tabs back in, focus lands on the current `tabIndex=0`
button per spec — a different DOM node than where the ring was last seen —
which reads as focus jumping unpredictably. This is in territory, in a
component present on the two highest-traffic detail pages.

**Proposed diff (same shape both files; each tab button already has
`id={\`tab-${tab}\`}`):**
```diff
   const idx = tabs.indexOf(activeTab)
-  if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(tabs[(idx + 1) % tabs.length]) }
-  if (e.key === 'ArrowLeft')  { e.preventDefault(); setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length]) }
+  if (e.key === 'ArrowRight') {
+    e.preventDefault()
+    const next = tabs[(idx + 1) % tabs.length]
+    setActiveTab(next)
+    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus())
+  }
+  if (e.key === 'ArrowLeft') {
+    e.preventDefault()
+    const next = tabs[(idx - 1 + tabs.length) % tabs.length]
+    setActiveTab(next)
+    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus())
+  }
```

---

### Q110-F8 — `components/GlobalSearch.tsx` — `role="listbox"` with no `role="option"`, no arrow-key navigation, mounted on every page — **MEDIUM/HIGH (huge blast radius) — CONFIRMED**

`app/layout.tsx:86` mounts `<GlobalSearch/>` in the root layout — it is
present on every single page in the app, and is the primary way (besides
clicking a card) to reach a stock page. The results/recent dropdowns declare
`role="listbox"` (:242, :300) but:
- children are plain `<li>` wrapping `<button>`, none carry `role="option"`
  or `aria-selected`;
- `onKeyDown` (:161-173) handles **only `Enter`** — no `ArrowDown`/`ArrowUp`
  at all;
- Enter always selects `results[0]` (:170) regardless of which result (if
  any) is visually/logically "current" — there is no concept of a current
  option to move, because there's no roving state.

A `role="listbox"` with none of the required interaction model
(`aria-activedescendant` or roving `tabindex` + `option` children + arrow-key
support) is worse than no role: assistive tech announces "listbox, N items"
and the user reasonably expects arrow-key navigation that silently does
nothing. Tab still works as a fallback (real `<button>` elements are
naturally tabbable), but that contradicts the ARIA semantics being
announced.

**Proposed fix (shape, not a full diff — this needs new state):** add an
`activeIndex` (`-1` initially) updated on `ArrowDown`/`ArrowUp` (clamped to
`results.length`), render `role="option"` + `aria-selected={i === activeIndex}`
+ `id={`opt-${i}`}` on each result button, set
`aria-activedescendant={activeIndex >= 0 ? \`opt-${activeIndex}\` : undefined}`
on the `<input>`, and change the `Enter` handler to prefer
`results[activeIndex]` when `activeIndex >= 0`, falling back to the current
`results[0]`/direct-ticker behavior otherwise (so existing "type + Enter"
muscle memory is unchanged for the common case).

---

### Q110-F10 — `components/options/OptionsChainTable.tsx:56-65` — ITM/OTM conveyed by text color only — **MEDIUM/HIGH — CONFIRMED**

```ts
const itm = side === 'call' ? spot > contract.strike : spot < contract.strike
const cellCls = `px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`
```
All five numeric cells per contract (IV, Delta, OI, Volume, Last) get one of
exactly two Tailwind text colors depending on moneyness — no icon, no bold
weight, no text label, no `aria-label` at the cell or row level. The only
textual mention of the convention is a static caption at the bottom of the
whole table, "ITM highlighted" (:216) — a legend that exists once, not a
per-row cue. This is a clean WCAG 1.4.1 (Use of Color) violation on
information that is central to reading an options chain: a color-blind user
(or anyone in bright sunlight on a phone) cannot tell ITM from OTM contracts
apart at all, row by row.

**Proposed diff:** keep the color (it's still useful for sighted, non-CVD
users) but add a redundant, non-color cue and an accessible name:
```diff
   if (!contract) return <td className="px-2 py-1 text-gray-500 text-xs" colSpan={5}>—</td>
   const itm = side === 'call' ? spot > contract.strike : spot < contract.strike
-  const cellCls = `px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`
+  const cellCls = `px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400 font-semibold' : 'text-gray-300'}`
   return (
-    <>
+    <>
+      <td className="sr-only">{itm ? 'in the money' : 'out of the money'}</td>
       <td className={cellCls}>{fmtPct(contract.impliedVolatility)}</td>
```
(A `font-weight` difference plus an `sr-only` cell is the minimal redundant
encoding; a visible left-border accent on the row would be the fuller fix but
touches more markup than this sketch.)

---

## 5. Mobile / responsive

### Q110-F9 — `app/desk/page.tsx:162-164` — the page's one freshness indicator is hidden below the `sm` breakpoint — **MEDIUM — CONFIRMED**

```tsx
<span className="hidden sm:inline-flex">
  <DataFreshnessIndicator quoteTime={quoteTime} compact label="desk feed" />
</span>
```
`/desk` is described in its own routing comment as "the monitoring surface"
(`app/desk/page.tsx:2-5`, Q-069) — and CLAUDE.md's I2 section already flags
`DataFreshnessIndicator` as mounted on only 2 of 16 pages (`desk`, `sector`).
On desk specifically, that one instance is wrapped in `hidden sm:inline-flex`
— **invisible below 640px, i.e. on effectively every phone in portrait.**
Mobile users of the one page whose entire purpose is live monitoring get no
staleness signal at all; the only other indicator is the `fetchError` banner
(:167-170), which only appears on an actual fetch *error*, not on a
successful-but-stale response (SWR `keepPreviousData: true` — see section 3).

**Proposed diff:**
```diff
-          <span className="hidden sm:inline-flex">
-            <DataFreshnessIndicator quoteTime={quoteTime} compact label="desk feed" />
-          </span>
+          <DataFreshnessIndicator quoteTime={quoteTime} compact label="desk feed" />
```
If the `hidden sm:` was there for a real layout-width reason (the button
strip above it wraps at narrow widths), move it to its own row rather than
deleting it outright — but it must render at every breakpoint on the one page
built for monitoring.

**Also checked and found clean:** wide tables elsewhere
(`OptionsChainTable`, `InstrumentTable`, commodities/desk tables) all use
`overflow-x-auto` and degrade to horizontal scroll rather than truncating
meaning below ~380px — acceptable per the brief's own bar ("unusable or
truncates meaning"); scrolling a table is neither.

---

## 6. Free sweep — searched and found clean (named, per instructions, so a null result counts as evidence)

- **`components/SectorCard.tsx`** — every numeric render goes through
  `safeFixed` (imported from `lib/format.ts`, which returns `'—'` for
  null/undefined/NaN/±Infinity), and the whole price block is gated on
  `quote ?` with a skeleton fallback. No fabricated zero anywhere in this
  component. This is the model the sector/stock page header (F3) should be
  brought into line with.
- **`app/ma-deviation/page.tsx`** — grepped every `.toFixed(` call in the
  file; every single one is preceded by `!= null ? ... : '—'`. Best-in-class
  in this codebase; cited as the pattern for the F3/F11 fixes above.
- **`app/desk/page.tsx` and `app/commodities/page.tsx` table cells** — both
  guard every cell with `q ? value : '—'`; no fabricated zeros in either
  table body (the gaps in these two files are the freshness-indicator
  visibility (F9) and the missing initial-load state (F11), not the cell
  values themselves).
- **`components/backtest/AnalysisTab.tsx:127-136`** — display value is
  correctly `r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : '—'`; only the
  **color class** for that cell uses `(r.sharpeRatio ?? 0) >= 1 ? emerald :
  ...`, so a missing Sharpe renders a truthful `'—'` but tinted amber (the
  "neutral/borderline" color) instead of a neutral gray. Minor, cosmetic,
  not filed as a numbered finding — the text itself never lies, only its
  color affiliation implies "measured and borderline" rather than
  "unmeasured."
- **`components/crypto/BtcHeader.tsx`** — up/down always pairs an icon
  (▲/▼) with the color, never color alone.
- **`app/page.tsx:227-228`** — `price: quotes[s.etf]?.price ?? 0` looked
  like a fabrication at first read, but the only consumer
  (`tickerItems`, feeding `PriceTicker`) immediately does
  `.filter(t => t.price > 0)` (:229) — sectors with no quote yet are dropped
  from the tape entirely rather than shown at `$0.00`. No bug.
- **`components/crypto/BtcQuantLab.tsx`** — computed values that default via
  `?? 0`/`?? NaN` when `candles` is short (`latestClose`, `latestVWAP`,
  `rainbowHigh`/`Low`, etc., :184-217) never reach render: the whole
  component returns an explicit "Not enough BTC history loaded yet" panel
  when `candles.length < 30` (:332-338), before the JSX that would use those
  values. Confirmed this guard sits after all the computation but before the
  only `return` that renders it.
- **Colour-as-sole-carrier**, beyond the OptionsChainTable finding (F10):
  spot-checked `components/backtest/LiveSignalsPanel.tsx` zone/action/
  deviation/slope chips (:286-303) — every color is paired with visible text
  (`zoneLabel`, the raw action string, a signed number) — consistent with the
  sign/icon-prefix convention documented elsewhere in this codebase
  (F6.3 comments in `SectorCard.tsx`, `desk/page.tsx`). No bare color-only
  chip found in this component.

---

## Ranked: highest trust-gained per line touched

**F1 and F2 must be read as a pair — apply both, in either order, before
re-testing.** F1 is the root-cause fix (and the one that protects every
future consumer of the hook); F2 is what actually changes the pixels on the
two pages audited here today, because each page owns a second, un-reset copy
of `quote`/`candles` that F1 alone does not touch. Ranked as one unit:

1. **`Q110-F1` + `Q110-F2` (`hooks/useLiveQuote.ts` +5 lines; stock + sector
   pages +6 lines each).** Together, closes the highest-visibility instance of
   "one security's data under another's name" named in the task brief itself
   — the flagship candlestick chart and the hero price, both on the two
   most-visited detail pages — at both the shared-hook source and the two
   call sites, for every current and future consumer. Small, surgical, and
   F2 is explicitly designed NOT to regress the existing poll/range-change
   behavior (a naive fix inside `fetchChartData` would have).

2. **`Q110-F7` (focus/selection desync, ~8 lines across two files).**
   Cheapest fix on this list relative to its severity class — a WAI-ARIA APG
   roving-tabindex violation on the two busiest pages' primary tab
   navigation, and the fix is copy-paste identical in both files using an
   `id` that already exists on every button.

3. **`Q110-F3` (sector page, ~10 lines).** Same file as F2, same commit is
   natural — but a distinct bug (cross-security contamination via a
   client-side `?? 0`/`?? prev` fallback that F9's server-side fix does not
   reach), so it is filed and diffed separately rather than folded silently
   into F2.
