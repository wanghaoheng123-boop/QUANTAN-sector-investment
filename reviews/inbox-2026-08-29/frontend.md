# Frontend territory report — Q-107 rectification wave (2026-08-29)

Territory: `components/`, `hooks/`, `app/` page/layout files (API routes excluded —
another agent's territory; I read two route files only to verify a claim, and
propose no edits to them). Reserved ids `Q107-F1`–`Q107-F19`; used `F1`–`F9` (`F2` is the design writeup
for the provenance badge, no separate id; `F1`, `F3`–`F9` are the numbered
findings below).

No source files were edited. Three evidence tiers are used and labeled
explicitly, because this repo has a named failure mode for blurring them
(`Q088-6`/`Q088-6F`, §0): **CONFIRMED** (read directly, no inference);
**CODE-PATH DEFECT** (the defect is confirmed in source — a missing guard, a
missing reset — but whether it produces a user-visible flash depends on a
runtime fact — component remount behavior on client-side navigation — that I
did not reproduce in a browser, same evidentiary bar as `Q088-6`); **PLAUSIBLE**
(reasoned, not directly read). `file:line` is exact against
`chore/Q-107-rectification-wave` @ `873e654`.

---

## 0. What was already on record (do not re-file)

Before treating anything below as new, I read `reviews/findings-ledger.csv` for
overlap. Three rows already cover ground this brief asked me to walk:

- **`Q079-I1-1`** — the zero-`.provenance`-consumers finding, `OPEN`, filed as
  `Q-101`. Task 1 below **reconfirms** it and adds the concrete remediation
  design the row doesn't contain.
- **`Q079-I2-1`** — the cache-substitution half of I2 (now CLOSED per
  `CLAUDE.md`, ledger row text is stale) *and* it names the exact blind spot
  this brief sent me after: "Declared blind spot: hooks/ SWR keepPreviousData
  unchecked." Task 2 below is that investigation.
- **`Q100-21` / `Q100-22`** — already cover exactly what Task 3 asked me to
  confirm (LlmTab decision banner, ComplianceBanner collapse state). I did not
  file new rows for these; see §3.

One more overlap worth flagging to the lead even though it's not my file to
edit: **`Q088-6`** (`components/NewsFeed.tsx`, "open, unassigned, next" in the
ledger) appears to already be **fixed** in the current tree —
`components/NewsFeed.tsx:78-83` clears `news`/`fetchedAt` before every fetch,
with a comment citing `Q088-6` by name. Worth a status check before the lead
carries it forward as open. I did not touch the ledger.

That NewsFeed fix is also the **precedent pattern** for the remediation I
propose in §2: clear identity-bound state before the fetch/subscribe that will
replace it, don't wait for the response to overwrite it.

---

## 1. I1 — provenance has zero consumers (confirmed; design attached)

**Verification, with search scope stated:**

```
grep -rn "\.provenance" components/ app/ hooks/        # 123 .ts/.tsx files under these three roots
→ 0 real hits. 4 case-insensitive hits, all comments referencing the gap
  (components/NewsFeed.tsx:81, components/DarkPoolPanel.tsx:230, app/page.tsx:119)
  plus the API route's own declaration (app/api/options/[ticker]/route.ts:82).
```

Confirmed still true: **zero** UI consumer of `QuoteProvenance`
(`lib/data/mergeQuotes.ts:18-28`) or of the options route's `dataProvenance`
object anywhere in my territory.

**The DELAYED-badge promise is confirmed broken.**
`app/api/options/[ticker]/route.ts:82-86` emits
`dataProvenance: { provider: 'yahoo-finance2', delayedMinutes: 15, realtime: false }`
with a comment literally saying "Surface this so UI can render an explicit
'DELAYED' label." The only fetcher of this endpoint is
`app/stock/[ticker]/page.tsx:268-293` — it destructures `data.calls`, `.gex`,
`.unusualFlow`, `.sentiment` into state and **never reads `data.dataProvenance`
at all**. `grep -n "DELAYED\|delayedMinutes\|realtime" app/stock/[ticker]/page.tsx
components/*.tsx` returns nothing. The options tab renders live-looking
prices with a 15-minute vendor delay and no disclosure.

**Design — smallest real consumer, and what it renders when provenance is missing**

Surface: the price header on `app/stock/[ticker]/page.tsx:337-343` (also
present, same shape, on `app/sector/[slug]/page.tsx:320-359`). This is the
single highest-traffic number-render in the app — every ticker drill-down
lands here — and it's the same surface implicated in the I2 findings below, so
one PR can fix both.

1. **CONFIRMED, read directly (not inferred — the earlier draft of this report
   asserted this without reading the response construction, which is exactly
   the calibration failure I8's history in `CLAUDE.md` warns about; corrected
   here):** `app/api/prices/route.ts:162` builds
   `const quotes = mergeYahooAndBloomberg(yahooQuotes, bbMap)` — the full
   `UnifiedQuote[]`, `provenance` field included — and `:168` embeds it
   **wholesale**, `NextResponse.json({ quotes, timestamp, dataSources })`, no
   `.map()`/pick that would strip fields. So both `dataSource` *and* the
   full per-field `provenance` object (`lib/data/mergeQuotes.ts:18-28`)
   reach the client on the wire today, via the REST boot fetch
   (`app/stock/[ticker]/page.tsx:154-172`, `fetchQuote`). It's discarded
   client-side: `setQuote(q)` at line 164 stores the whole REST object into
   `quote`, but the page's local `quote` type (line 66) doesn't declare
   `dataSource` or `provenance`, and the merge effect at `220-230` rebuilds
   `quote` from scratch on every SSE tick, dropping whatever field isn't
   explicitly listed.

2. Add `dataSource?: string` **and** `provenance?: { price: FieldSource; changePct: FieldSource }`
   (a narrow slice of `QuoteProvenance`, not the whole 10-field shape — the
   badge only needs to speak to the two numbers next to it) to the page's
   local quote type (line 66) and to the equivalent type in
   `app/sector/[slug]/page.tsx`.

3. New tiny presentational component, `components/QuoteProvenanceBadge.tsx`,
   reading `.provenance` first with `.dataSource` as a coarser fallback —
   **this is the part that actually matters for `Q079-I1-1`/`Q-101`: a badge
   that reads only `.dataSource` leaves `grep .provenance` at zero forever,
   which is the exact defect being closed. Reading `.provenance` is what
   flips that grep from 0 to 1.**
   ```tsx
   interface Props { dataSource?: string; provenance?: { price: string } }
   export function QuoteProvenanceBadge({ dataSource, provenance }: Props) {
     const source = provenance?.price ?? dataSource
     if (!source) {
       return (
         <span className="text-[10px] text-slate-500" role="status"
           title="This price came from the real-time stream, which does not report which vendor supplied it">
           — source unknown
         </span>
       )
     }
     const label = source === 'bloomberg' ? 'Bloomberg'
       : source === 'yahoo' ? 'Yahoo' : source
     return <span className="text-[10px] text-slate-500" title={`Source: ${source}`}>via {label}</span>
   }
   ```
   Mount it next to `formatCurrency(quote.price)` at `app/stock/[ticker]/page.tsx:339`
   and next to the equivalent block in `app/sector/[slug]/page.tsx`.

4. **What it renders when provenance is missing, and why that state is
   guaranteed to occur, not hypothetical:** the SSE merge effect
   (`app/stock/[ticker]/page.tsx:220-230`) writes `{price, change, changePct,
   marketCap, quoteTime}` — no `dataSource`/`provenance` key — because
   `hooks/useLiveQuote.ts`'s `LiveQuote` type (line 44-52) never had one; the
   SSE payload contract (`app/api/stream/[ticker]/route.ts`, not my
   territory) doesn't send a vendor label. So on every page, within roughly
   one 15-second SSE tick of load, the badge will flip from `via Yahoo` to
   `— source unknown` with no further code change needed to observe it — the
   gap already exists, this just makes it visible instead of silent.

5. **Test** (place at `__tests__/components/QuoteProvenanceBadge.test.tsx`,
   following the existing jsdom pattern in `__tests__/components/stock/`):
   render with `provenance={{price:'yahoo'}}`, assert text `via Yahoo`;
   render with both `dataSource` and `provenance` undefined, assert text
   `— source unknown` and `role="status"`. This is the literal "test that
   watches a number [-adjacent value] become `—`" requested — I did not
   extend it to blanking the price number itself (see next paragraph). A
   second, numeric instance of the same requirement is in `Q107-F9` below.

**Explicitly out of scope, flagged as a product decision, not silently
punted:** I1's text says the *value* should render `—`, not just an
annotation next to it. Blanking `quote.price` itself every time an SSE tick
arrives with no vendor label (i.e., continuously, for the life of every
session) would hide the primary number on the page's main surface — that is
a real UX regression, not a small change, and needs an owner call, not an
agent's unilateral judgment. The honest middle state I'm proposing (number
stays, provenance annotation goes to `—`) is a truthful, minimal first
consumer; closing I1 for real on this surface requires
`app/api/stream/[ticker]/route.ts` to start emitting a vendor label per tick
— API-route territory, logged here as a dependency, not proposed as a diff.

`app/api/options/[ticker]/route.ts`'s DELAYED badge is a second, smaller,
independent win (data's already on the wire, just needs a `useState` +
render) — worth doing, not the headline recommendation.

### Q107-F9 — the actual "a number becomes `—`" instance, already in the tree today

The badge above is an *annotation* next to a number; I1's text is about the
*number itself*. There is a real, already-shipping instance of a number
rendering with no honest provenance, entirely in my territory, no design
needed — just a guard:

`app/sector/[slug]/page.tsx:339` — `{quote.pe.toFixed(1)}×` — and `:331`/`:335`
— `{formatCurrency(quote.high52w)}` / `{formatCurrency(quote.low52w)}`.
`quote.pe`/`high52w`/`low52w` are typed as plain `number` on `UnifiedQuote`
(`lib/data/mergeQuotes.ts:39,37-38`) and built via `bb.pe || y.pe` /
`bb.high52w || y.high52w` (value construction: `:126,124-125`; the adjacent
`provenance` object at `:110-112` tracks which side "won" the same `||` but
is a separate literal, not the value itself) — when **both** vendors are
missing the field, this expression evaluates to `0`, not `null`. The page
renders that as `0.0×` / `$0.00` — a real, present-tense number with a
`FieldSource` provenance tag attached to it (`'yahoo'` or `'bloomberg'`,
whichever "won" the fallback) that is **false**: the tag claims a vendor
supplied a value when in fact no vendor did.

**The fix is a client-side heuristic, not a data-layer rewrite, and the
codebase's own comments already justify why it's directionally safe for
these three fields specifically:** `mergeQuotes.ts:70-82`'s own comment
distinguishes "genuine zero-volume during a halt" (real, must not be dashed)
from "genuine missing-field zero" (fake, should be dashed) and calls the
ambiguity a known, accepted tradeoff pending a data-layer fix. P/E and 52-week
high/low don't have volume's halt exception — a live security cannot
legitimately report a trailing P/E of exactly `0.0` or a 52-week high/low of
exactly `$0.00`; `0` on these three fields specifically is always the missing
sentinel, never a real value. **Volume is not safe to gate this way** (`:334`,
`{formatCompactNumber(quote.volume)}`) — leave it alone, per the code's own
comment.

Proposed diff, `app/sector/[slug]/page.tsx:331,335,339`:
```tsx
52W High: <span className="text-white font-mono ml-1">
  {quote.high52w > 0 ? formatCurrency(quote.high52w) : '—'}
</span>
...
P/E: <span className="text-white font-mono ml-1">
  {quote.pe > 0 ? `${quote.pe.toFixed(1)}×` : '—'}
</span>
```
**Test:** mount with `quote.pe = 0`, assert rendered text is `—` not `0.0×`;
mount with `quote.pe = 18.4`, assert `18.4×`. This is the literal number
requested, not an adjacent badge — flag as HEURISTIC in the PR description
(zero-as-missing-proxy, not a true null from the data layer) so it isn't
mistaken for I1 being closed on this field; a genuine close needs
`mergeQuotes.ts`/`bridgeClient.ts` to carry `null` through instead of `0`,
which is data-layer territory, not mine.

---

## 2. I2 — staleness: the SWR blind spot is real, but not where the audit named it

**`DataFreshnessIndicator` mount count is stale (correction, not a new gap).**
`grep -rln "DataFreshnessIndicator" components/ app/ hooks/` →
`app/desk/page.tsx:163`, `app/sector/[slug]/page.tsx:358,508`,
`app/stock/[ticker]/page.tsx:467`, `components/crypto/BtcQuantLab.tsx:410`
(mounted from `app/crypto/btc/page.tsx`). Against 16 total `page.tsx` files,
that's **4 of 16** reachable today, not the 2/16 the 2026-08-17 audit
recorded — it has grown since, in the right direction. Two of those four
mounts (`stock/[ticker]:467`, `BtcQuantLab:410`) are `cached`-only badges for
chart data, not a price-freshness readout. The audit's own citation for the
sector-page mount, `app/sector/[slug]/page.tsx:352`, has also drifted: `:352`
is now the Top Holdings `<Link>`; the `<DataFreshnessIndicator>` itself is at
`:358`. Six lines of drift from list edits, not a wrong claim — noting it
because stale `file:line` in an auditable trail is a recurring, named problem
in this repo (`I8`'s "18 of 46 citations were wrong" history).

**`keepPreviousData` — one use, confirmed benign, stated precisely so a null
result is evidence:**
```
grep -rn "keepPreviousData" hooks/ components/ app/   → 1 hit: hooks/useLivePrices.ts:80
grep -rln "from 'swr'"       hooks/ components/ app/   → 1 file: hooks/useLivePrices.ts
```
Its only caller is `app/desk/page.tsx:46`, with `tickers = DESK_TICKERS`
(`lib/deskTickers.ts:5-14`) — a **module-level constant array**, not derived
from route params or user selection. The SWR key
(`hooks/useLivePrices.ts:91-93`) therefore never changes across this
component's lifetime; `keepPreviousData` here does exactly its documented
job (smooth the 5s poll) and cannot serve one ticker's data under another's
name, because the key identity never changes. **This is not the audit's
blind spot.**

**The blind spot is real, just implemented via SSE state, not SWR.** Same
failure mode the audit described — "a hook that serves the previous ticker's
data while a new one loads is showing one security's numbers under another's
name" — has its mechanism confirmed in source, in `hooks/useLiveQuote.ts` and
its two page-level consumers.

**Evidence checked for the remount premise (read this before F3–F6).** Every
finding below fires only if `app/stock/[ticker]/page.tsx` and
`app/sector/[slug]/page.tsx` keep the same React component instance across a
client-side navigation between two values of the dynamic segment (e.g.
`/stock/AAPL` → `/stock/MSFT`) — if the App Router remounts the page instead,
every `useState` re-initializes to its declared default and none of this
manifests. I did not reproduce either outcome in a browser. What I checked in
the tree, so the null result carries weight:
- `find app/stock app/sector -type f` → **only** each directory's own
  `page.tsx`. No `layout.tsx`, `template.tsx`, or `loading.tsx` at either
  segment (`find app -iname template.tsx` → repo-wide zero hits) — none of
  the three mechanisms that would force Next.js to remount the segment exist.
- `grep -rn "key={" app/` → every hit in both files (`app/sector/[slug]/page.tsx:352,434,456,599`,
  `app/stock/[ticker]/page.tsx:406`) is a `.map()` list key, not a `key` prop
  on the page's own root or on a route/Suspense boundary that would key the
  instance to the ticker.
- Internal tell, not proof: `fetchQuote`, `fetchChartData`, and the options
  effect all list `ticker`/`sector.etf` in their dependency arrays specifically
  to force a re-fetch on identity change — dead weight if the component
  remounted anyway, since a fresh mount would re-run them for free.

This is the same evidentiary situation the ledger already has a name for:
`Q088-6`/`Q088-6F` describe the identical mechanism on `NewsFeed` and record
it as **"NOT reproduced under React Testing Library... recorded as a
code-path defect, not a measured flash."** F3–F6 below use that same label
and, per that precedent, treat the fix as safe regardless: if the remount
premise is wrong, clearing state in an effect that fires on an identity change
that never happens is an inert no-op, not a regression. The fixes are worth
shipping either way; only the "does a user ever actually see it" claim is
gated on the premise, and I'm not asserting that claim as measured.

### Q107-F3 — CODE-PATH DEFECT (HIGH if the premise holds) — options chain has no ticker-scoped reset
`app/stock/[ticker]/page.tsx:263-293`:
```ts
useEffect(() => {
  if (activeTab !== 'options') return
  if (optionsChain) return  // already loaded
  ...fetch(`/api/options/${ticker}`)...
}, [ticker, activeTab, optionsChain])
```
**CONFIRMED, independent of the remount question:** the `if (optionsChain)
return` guard is textually ticker-blind — it asks "do we have some chain,"
never "do we have *this ticker's* chain" — and `optionsChain` has exactly one
setter (`setOptionsChain` on fetch success, line ~273) and no reset path
anywhere in the file. **Conditional on the remount premise:** if the page
instance survives a ticker change, switching ticker while the Options tab
stays active permanently stops refetching — the previous ticker's calls,
puts, GEX (`GexChart`), max pain (`MaxPainGauge`), and unusual flow
(`FlowScanner`) keep rendering, unlabeled, under the new ticker's header,
with no self-recovery short of a full reload. Fix either way: scope the
guard to the ticker it was loaded for, or reset
`optionsChain`/`optionsGex`/`optionsFlow`/`optionsSentiment` in a small
effect keyed on `[ticker]`.

### Q107-F4 — CODE-PATH DEFECT (HIGH if the premise holds) — stock page price header
`app/stock/[ticker]/page.tsx:66-67` (`quote` state), `:154-172` (`fetchQuote`),
`:337-343` (render). **CONFIRMED:** `fetchQuote` never clears `quote` before
issuing its request (unlike the fixed `NewsFeed`, `Q088-6` precedent, §0), and
`quote` is rendered unconditionally whenever truthy (`:337`) with no
ticker-identity check anywhere in the render path. **Conditional on the
remount premise:** if the component survives navigation, the old ticker's
`price`/`change`/`changePct`/`marketCap` render under the new
`<h1>{ticker}</h1>` for the REST round-trip. Reachability for this
navigation is not hypothetical even though the flash is unmeasured:
`components/GlobalSearch.tsx:144` calls `router.push('/stock/'+symbol)` and
is mounted globally (`app/layout.tsx`), so it's present *on* the stock page
itself — a user can search a new ticker while already viewing one, entirely
via client-side routing. `formatFreshness(quote.quoteTime)` (`:377`,
`lib/format.ts:51-62`) makes the failure mode worse *if it fires*, not better:
it returns `'live'` for anything under 30s old, purely time-based with no
identity check, so it would tell the user the wrong security's price is live
rather than saying nothing.

### Q107-F5 — CODE-PATH DEFECT — chart candles, same pattern
`app/stock/[ticker]/page.tsx:104-144` (`fetchChartData`), render gate at
`:468` (`loading && candles.length === 0`). **CONFIRMED:** `candles` is never
cleared on ticker change, and the loading skeleton
(`"Connecting to Data Feed..."`) is gated on `candles.length === 0` — once any
candles exist, that skeleton cannot reappear regardless of what triggered the
new fetch. **Conditional on the remount premise:** the previous ticker's OHLC
bars would render under the label `"{ticker} · Advanced Technicals"` (`:454`,
`ticker` already updated) until the new fetch resolves.

### Q107-F6 — CODE-PATH DEFECT — sector page has the identical price-header defect
`app/sector/[slug]/page.tsx:156-196` (boot fetch + merge effect, same shape as
F4 — **confirmed**, `quote` never cleared before the boot fetch), `:320-359`
(render, same unconditional-if-truthy pattern; `DataFreshnessIndicator` at
`:358` would suffer the identical false-"Live" problem if F6 fires, since it's
also purely time-based, no identity check). Reachability for the triggering
navigation is concrete and doesn't depend on the remount premise: the page
renders its own "Other Sectors" list at **`:599`**
(`<Link href={`/sector/${s.slug}`}>`) — a direct sector-to-sector navigation
control sitting on the same page whose state I'm describing.

### Q107-F7 — CONFIRMED (root cause) — `hooks/useLiveQuote.ts` never resets on identity change
`hooks/useLiveQuote.ts:102-121`. **CONFIRMED, no remount premise involved —
this is entirely internal to the hook, independent of what the page around it
does:** the `useEffect` keyed on `[ticker, supported]` tears down and rebuilds
the `EventSource` on ticker change, but the `quote`, `lastMessageAt`, and
`marketOpen` `useState`s (`:103-107`) are untouched by that effect — they
carry forward from the old subscription's last value until the new one's
first `quote`/`heartbeat` event arrives (server cadence: ~15s during market
hours per the hook's own docstring, line 8). Whether this reaches the DOM
depends on the same remount question as F4/F6 (a fresh page mount would also
reset the hook's own state for free), but the defect inside the hook itself
is unconditional. Fix: add `setQuote(null); setLastMessageAt(null);
setMarketOpen(false)` at the top of the effect, before the `!supported ||
!ticker` early return. This removes the SSE-sourced half of F4 and F6 in one
place — both page-level `fetchQuote` paths still need their own REST-side
clear (F4/F6 diffs) because the REST boot fetch is a second, independent
source of the same stale-carryover.

### Q107-F8 — low/informational — freshness-indicator inconsistency
`app/stock/[ticker]/page.tsx:377` uses the bare `formatFreshness()` text
helper for the price header instead of the shared `<DataFreshnessIndicator>`
component that `app/sector/[slug]/page.tsx:358` and `app/desk/page.tsx:163`
use — no color-coded dot, no `cached` semantics, weaker signal on the
higher-traffic page. Style/consistency, not correctness; bundle with the F4
fix since both touch the same lines.

**Proposed remediation shape for F3–F6** (diffs, not committed — mirroring
the `NewsFeed`/`Q088-6` "clear before fetch" precedent):
```ts
// app/stock/[ticker]/page.tsx — new effect, declared before the fetch-
// triggering effects so it clears in the same commit the new fetch starts in.
useEffect(() => {
  setQuote(null)
  setQuoteError(null)
  setCandles([])
  setChartError(null)
  setChartCached(false)
  setOptionsChain(null)
  setOptionsGex(null)
  setOptionsFlow([])
  setOptionsSentiment(null)
}, [ticker])
```
Plus the `hooks/useLiveQuote.ts` reset in F7. `app/sector/[slug]/page.tsx`
needs the equivalent for `quote`/`darkPoolApiData`, keyed on `[sector.etf]`.

**Test shape:** render the page (or the merge-effect logic extracted to a
testable hook) with ticker A's REST quote resolved, then change the `ticker`
prop and assert the price header reads `—`/skeleton (not A's price) before
B's fetch resolves — same shape as whatever regression test would prove
`Q088-6` for NewsFeed, applied to price/candles/options chain.

**Hooks/components checked and found clean, stated so the negative is
evidence:** `hooks/useLiveQuotes.ts` (multiplexed SSE, `app/page.tsx` only
consumer) is guarded by its own documented contract ("Tickers list … must be
STABLE") and demultiplexes by the `ticker` field inside each payload, not by
component identity — not implicated. `components/crypto/hooks/useBtcCandles.ts`,
`useBtcPriceWs.ts`, `useBtcKlineWs.ts` — single fixed asset (BTC), no
ticker-identity dimension, not implicated. `components/options/OptionsChainTable.tsx`
only mentions `useLiveQuote` in a comment; it receives quote data as a prop
from the page, doesn't call the hook itself.

---

## 3. Q100-22 / Q100-21 adjacent — confirmed from the render tree, not re-filed

**`components/ComplianceBanner.tsx`** (read-only, not my file to edit):
`useState(false)` at line 7 means the detail block (`#compliance-detail`,
lines 29-42) is collapsed by default and requires a click. **But** the
always-visible summary line (lines 19-25, outside the `{open && ...}` gate)
already says *"Not investment advice. Signals, dark pool panels, and briefs
are illustrative or simulated where labeled — verify all data…"* without a
click. What's hidden behind the toggle specifically is the **vendor-data**
paragraph — "Market data is delayed or aggregated per your data provider
(e.g. Yahoo Finance…)" (line 35) — which is the paragraph most relevant to
I8's vendor-terms concern. This matches `Q100-22`'s existing description
exactly (collapsed-by-default, MiFID/SEC self-classification omitting MAS,
false "delayed" claim for the browser-direct crypto feeds); I'm confirming
it, not filing a duplicate.

**`components/stock/quantlab/tabs/LlmTab.tsx:397-420`:** confirmed — the
"Final decision" banner renders a large (`text-4xl`), color-coded
(green/red/yellow by `decisionGrade`) BUY/SELL/HOLD grade with **zero**
inline disclaimer text or link; the only accompanying copy is a small caption
(`confidence · elapsed · provider/model`, line 414-418). The nearest
disclaimer is the global `ComplianceBanner`, mounted exactly once at
`app/layout.tsx:100`, positioned **after** `<main>{children}</main>` and
**before** the page `<footer>` — i.e. below all tab content on a page that
has five main tabs (`chart`/`quant`/`options`/`darkpool`/`news`) each with
their own scroll length. A user on the LLM sub-tab of the Quant Lab tab would
need to scroll past the entire page to reach even the always-visible summary
line. Matches `Q100-21`'s existing description; confirming, not filing a
duplicate.

---

## Ranked list

**Implement now (mechanical, low-risk, `file:line` diffs above are close to
final — worth shipping regardless of how the remount premise resolves, per
the §2 note: these are inert no-ops if it turns out the page already
remounts, and close a real defect if it doesn't):**
1. `Q107-F9` — gate P/E and 52W high/low to `—` when `0` (missing-sentinel,
   not a real value). Smallest, most certain fix in this report: no premise
   dependency, no design judgment call, matches the codebase's own stated
   rationale for treating `0` as ambiguous.
2. `Q107-F3` — options chain ticker-blind "already loaded" guard. The
   ticker-blindness itself is unconditionally true; HIGH if the remount
   premise holds, since it's sticky (no self-recovery) on an analytical
   surface (GEX/max-pain/flow), not just cosmetic.
3. `Q107-F7` — clear `quote`/`lastMessageAt`/`marketOpen` in
   `hooks/useLiveQuote.ts` on ticker change. Single-file, fixes the SSE half
   of F4/F6 everywhere the hook is used.
4. `Q107-F4` / `Q107-F5` / `Q107-F6` — REST-side "clear before fetch" for
   price/candles/quote on both stock and sector pages, same shape as the
   `Q088-6` NewsFeed precedent already in the tree.
5. `Q107-F1` (options DELAYED badge) — data's already fetched, just needs a
   state var and a render; smallest possible I1 win on the annotation side.
6. `Q107-F8` — swap `formatFreshness()` text for `<DataFreshnessIndicator>`
   on the stock page price header. Bundle with #4 above.

Before merging F3–F6, it would cost one manual check (open `/stock/AAPL`,
search MSFT via the header search box, watch the network tab and the price)
to convert "code-path defect" to "measured" — cheap enough that the lead may
want it done rather than taken on inference, given this report's own
correction history above.

**Needs a product/owner decision before implementing (do not ship silently):**
1. `Q107-F2` design as written (provenance badge + `—` fallback) is safe to
   ship on its own judgment — but the deeper question of whether `/api/stream`
   should carry a per-tick vendor label (the only way to make the *price
   number itself* satisfy I1's literal text, not just an adjacent badge) is
   an API-route change outside this territory and changes what "done" means
   for I1 on this surface — flag for the lead to route to whoever owns
   `app/api/stream/[ticker]/route.ts`.
2. Whether to blank `quote.price` itself (not just the provenance badge) when
   provenance is unknown — I did not propose this; it's a real UX-tradeoff
   call, not mine to make unilaterally.
3. `Q100-21`/`Q100-22` — already routed to `Q-083` (MAS) per the ledger; no
   action from me, confirmation only.
