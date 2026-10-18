# Q-145 red-team re-gate: PR #248 at commit 4cbeea9 (2026-10-18)

Reviewer: adversarial (red team), round 2. Scope: `fix/q145-null-not-zero` at
`4cbeea9`, measured against my round-1 report (`reviews/q145-red-team-2026-10-17.md`,
untracked in this worktree).

Method:
- Read `git show 4cbeea9`, `gh pr view 248` and the new guard.
- Planted **37 mutations** against the committed tree. Each one ran the FULL suite
  (`npx vitest run`), `npx tsc --noEmit -p .` and `npx eslint --max-warnings=0`
  on the touched files.
- A Python harness asserted each target string occurred **exactly once** before
  writing. It restored every touched file with `git checkout -- <file>` in a
  `finally` block, and checked `git status --porcelain` after every run.
- One harness run aborted on a CRLF target (N9 in `app/commodities/page.tsx`). It
  aborted *before* writing anything and was re-run with a CRLF-exact target.
- I wrote an **untracked page-render probe** that mounts the real `/stock/[ticker]`
  and `/sector/[slug]` pages, with a controllable EventSource and a routed `fetch`.
  It ran as `__tests__/components/zz-regate-q145-probe.test.tsx` and was deleted
  after each run. It mounts in about 0.5 s. Its output is quoted below.
- No tracked file is left modified: every mutation was restored with
  `git checkout -- <file>`. I did not touch the ledger. At the end
  `git status --porcelain` shows only `?? reviews/q145-red-team-2026-10-17.md`
  and this file.

Baseline on `4cbeea9`:
- `npx vitest run` gives **2745 passed / 17 skipped** (191 files).
- `tsc` exits 0, and `npm run lint` (`--max-warnings=0`) exits 0.
- PR #248 CI ran on head SHA `4cbeea9`. All checks pass: test, typecheck, lint,
  coverage, benchmark, smoke, pytest, workflows, Vercel. The required-check set
  is still empty (I7), so this green is advisory.

---

## Summary

The committed code **behaves** correctly on every path I rendered:
- A no-change tick reads "— (no change data)" on both single-ticker pages.
- An unpriced ticker shows "—" with the reason, and the pulsing skeleton is gone.
- A later tick clears the reason.
- R3's "Bloomberg 0.00% overwrites Yahoo" is fixed.
- R5 is fixed.

The failures are in what is **guarded** and what is **claimed**:
- Round 2's headline says R1 is now guarded. That is true for the landing page
  only. On `/stock` and `/sector`, "keep the previous change" comes back
  lint-clean, type-clean and suite-green in four forms, and in a compound of them.
- The zero-ban is a spelling list. Seven paraphrases of a measured 0 survive,
  and the product tree has live `?? 0` on change fields today that it cannot see.
- R2's new reader puts a false "did not include this ticker" on `/stock/vix`,
  which the desk links to.
- Two deferrals point at nothing: `Q-156` does not exist, and "R7 is logged" is
  not true anywhere.

The first two point at the same missing piece: page-level render tests for
`/stock` and `/sector`. My probe mounts both pages in about 0.5 s and kills every
surviving stock/sector mutation I ran through it (N1c, N2c, N4, N5, N7, N13).

---

## Findings (ranked)

### Q145-R2-1 · HIGH · R1 is closed on the landing page only: on /stock and /sector "keep the previous change" returns with every test green

`__tests__/architecture/live-quote-merge.test.ts:50-61,75` (the decider) and
`app/stock/[ticker]/page.tsx:260,264`, `app/sector/[slug]/page.tsx:195,199`
(the sites).

`isDelegatingUpdater` decides that an updater "returns the helper's result" from
three facts:
- the callee's **identifier text** equals the helper name (`:57`);
- the first argument is the updater's own parameter (`:59`);
- nothing else.

It never resolves the binding. It never looks at the second argument. It never
looks at whether the updater is reached. The only other check on these two lines
is a **source-text** match, `` expect(src).toContain(`${helper}(prev, tick)`) ``
at `__tests__/api/marketHours.test.ts:103`. No test renders either page:
`git grep` over `__tests__/` finds no import of either page module. Every hit is a
path string read as text (marketHours, live-quote-merge, synthetic-containment,
vendor-licence-register, cache-flag-consumed, LandingSessionMoves).

Every row below is lint-clean (`eslint --max-warnings=0` exit 0) and `tsc` exit 0,
and the full suite reports **2745 passed**:

| id | mutation | full suite | page probe |
|---|---|---|---|
| N5 | stock: import `mergeStockTick as mergeStockTickBase` and declare a local `const mergeStockTick = (prev, tick) => ({ ...mergeStockTickBase(prev, tick), change: tick.change ?? prev?.change ?? null, changePct: tick.changePct ?? prev?.changePct ?? null })`. Line `:264` is **byte-identical** to the committed one, so the text match passes too | **SURVIVED** | killed |
| N4 | stock `:260` → `if (!tick \|\| tick.change == null) return` (the tick never reaches the updater) | **SURVIVED** | killed |
| N1c | stock `:264` → `setQuote((prev) => mergeStockTick(prev, { ...tick, change: tick.change ?? prev?.change ?? null, changePct: tick.changePct ?? prev?.changePct ?? null }))`, plus a comment line containing `mergeStockTick(prev, tick)` | **SURVIVED** | killed |
| N2c | the same on sector `:199` with `mergeSectorTick` | **SURVIVED** | killed |
| C1 | compound: N1c + N2c + the landing variant N3b (below), applied together | **SURVIVED** | — |

What a user sees under each:
- **N5, N1c and N2c** show the **new** tick's price and vendor `quoteTime` with the
  **previous** change. That is a stale move presented as current, the exact
  defect the helper's docstring names.
- **N4** keeps the old price and old change. Because the tick is dropped,
  `quoteTime` also stays old, so the freshness age next to it stays honest. The
  pill reads LIVE, which is the dishonest part (it keys off `live.connected &&
  live.marketOpen`, not off the rendered quote).
- **N1c and N2c** need a planted comment. Read them as evidence that a text match
  is all that stands between these pages and the defect, not as likely
  accidents. **N5 and N4** need no trick.

Control rows: what the guard does catch.
- **N2.** The sector second-argument form *without* the comment was KILLED by
  `marketHours.test.ts` alone, which is a text match.
- **N3.** The same form on the landing page was KILLED by `LandingLiveTick.test.tsx`.
- **C0.** The plain page-level analogs together were KILLED: stock second argument,
  sector `mergeSectorTick(null, tick)`, and landing `q.change == null && old ? old : …`.
  They were caught by `marketHours.test.ts`, `live-quote-merge.test.ts` and
  `LandingLiveTick.test.tsx`. eslint also flags the unused `prev`.

That contrast is the finding. The render test protects the landing page against
the behaviour. The parse-tree and text checks protect the stock and sector pages
against one *spelling*.

N5 is the I3 lesson that CLAUDE.md records three times: "Replacing one
source-text match with another is not a property; only resolution is."

**What should have been done:** add one render test per page, which is what my
probe does.
- Boot a quote with change +2 / +2%.
- Emit a tick with no change.
- Assert `— (no change data)`.

The probe passes on `4cbeea9` and kills N1c, N2c, N4, N5 and N7. If the guard
stays, resolve the callee through the TypeChecker to the `lib/liveQuoteState`
export, and require the second argument to be the effect's `tick` binding. Name
the early-return shape as a residual in the guard's header.

### Q145-R2-2 · MEDIUM · property 2 is a spelling list; seven measured-zero paraphrases survive, and live `?? 0` on change fields exists today outside its field allowlist

`__tests__/architecture/live-quote-merge.test.ts:134-173`.

The ban matches four shapes:
- `?? <numeric literal>` or `|| <numeric literal>`, where the left side is a
  **property access** named exactly `change`, `changePct`, `pe`, `high52w` or
  `low52w`;
- `as number` on a field named exactly `change` or `changePct`;
- `!` on such a field;
- an object-literal property with that exact name and a numeric literal value.

`Number(null) === 0`, ternaries, locals, named constants and string fallbacks are
all invisible. Every row below is lint-clean and `tsc` exit 0, with the full
suite at 2745 passed:

| id | file:line | mutation | output for a missing change (worked out from the expression; only N7 was also run through the page probe, where it fails) |
|---|---|---|---|
| N7 | `app/stock/[ticker]/page.tsx:386` | inline the header: `{Number(quote.changePct) >= 0 ? '▲' : '▼'} {Number(quote.change).toFixed(2)} ({Math.abs(Number(quote.changePct)).toFixed(2)}%)`, and drop the `QuoteChangeLine` import | `▲ 0.00 (0.00%)` |
| N8 | `app/heatmap/page.tsx:106` | `const pct = quote ? Number(quote.changePct) : null` | green tile, `+0.00%` |
| N9 | `app/commodities/page.tsx:140` | `const raw = q?.changePct; const pct = q ? (raw ?? 0) : null` (a local alias; `fieldName` returns null for identifiers) | `+0.00%` |
| N10 | `app/page.tsx:231` | `changePct: quotes[s.etf]?.changePct ?? FLAT_PCT` with `const FLAT_PCT = 0` | ticker tape `▲0.00%` (the round-1 M4 defect) |
| N11 | `app/commodities/page.tsx` cell | `` `${up ? '+' : ''}${q?.changePct?.toFixed(2) ?? '0.00'}%` `` | `0.00%` |
| N12 | `app/heatmap/page.tsx:106` | `quote.changePct == null ? 0 : quote.changePct` | `+0.00%` |
| N18 | `app/desk/page.tsx:227` | `const pct = q ? Number(q.changePct) : null` | `+0.00%`, and tsc stays clean, so "tsc proves each cell's null branch" does not hold |

The tree **today** carries the exact defect on change fields whose names are not
in the allowlist. None of these is a residual the guard names:
- `components/crypto/hooks/useBtcPriceWs.ts:104-105`: `change24h: d.change24h ?? 0`,
  `changePct24h: d.changePct24h ?? 0`.
- `:124`: `change24h: 0`, a hard-coded literal on the CoinGecko fallback.
- `:125`: `Number(q.bitcoin?.usd_24h_change) || 0`.
- `:53`: `open24 > 0 ? price - open24 : 0`.
- `app/api/crypto/btc/quote/route.ts:35,38`: `typeof b.usd_24h_change === 'number' ? … : 0`.
- `components/crypto/BtcHeader.tsx:13,63`: `(btcPrice?.changePct24h ?? 0) >= 0`, which
  renders `▲ 0.00%`. This is read from the code, not rendered.

These predate this PR, and Q-145 is scoped to Yahoo, so they are not a
regression. But the commit says the guard "bans `?? 0` / `|| 0` on change fields
… across the product tree". The PR body says "no product file writes `?? 0` /
`|| 0` on a change field". Both are **false** on the committed tree at
`useBtcPriceWs.ts:104-105`.

"Render tests cover the shared `QuoteChangeLine` (both headers)" is true of the
component. Nothing pins that either header still *uses* it, which is what N7 shows.

**What should have been done:**
- Narrow both sentences to "the fields named `change` / `changePct`".
- Log the crypto zeros as a new `Q-###`. Do not widen this PR.
- Add the uncaught shapes (`Number()`, ternary, local alias, constant, string
  fallback, other field names) to the guard's RESIDUAL block, so a green run is
  not read as a proof.
- Rely on render tests, not spellings, for the consumer pages (see R2-1).

### Q145-R2-3 · MEDIUM · R2's new reader shows a false "did not include this ticker" on /stock/vix, which the desk links to

`lib/liveQuoteState.ts:133,136`; `app/stock/[ticker]/page.tsx:196`;
`app/api/prices/route.ts:95,174`; link at `app/desk/page.tsx:285`.

The page asks with its URL ticker (`VIX`). The route canonicalises through
`normalizeTicker`, which maps `VIX → ^VIX` and the other `US_INDEX_SYMBOLS` the
same way. The row and `unpriced` therefore both carry `^VIX`, and
`bootQuoteFrom(data, 'VIX')` matches neither.

Rendered by the probe: response `{quotes:[{ticker:'^VIX', price:20, …}], unpriced:[]}`
on `/stock/vix`:
```
[R2-vix] ABSENT_REASON shown although the response priced ^VIX: true | $20.00 shown: false
```
Before round 2, the same mismatch gave a skeleton. Now it is a confident, false
reason sentence for a priced instrument. A later SSE tick clears it, because the
merge does not check the ticker. If the stream's initial fetch fails (`degraded`,
see R2-9) or the stream is rate-limited (10 per minute per IP), the false
sentence stays. A genuinely unpriced index gets `ABSENT_REASON` instead of
`UNPRICED_REASON`, for the same reason.

**What should have been done:** canonicalise the page ticker with the same
`normalizeTicker` before matching, or have the route echo a requested-to-canonical
map. Add a `/stock/vix` case to the boot test.

### Q145-R2-4 · MEDIUM · the guard's only named deferral cites `Q-156`, which does not exist

`__tests__/architecture/live-quote-merge.test.ts:27,180,289`; commit body; PR body.

`workspace/IMPROVEMENT_BACKLOG.json` tops out at `Q-155`. `"Q-156"` occurs in no
backlog on any `origin/*` branch, and in no working copy (I checked the main checkout and the 24 worktrees that carry a
backlog file). The `lib/options/chain.ts:92` exemption
(`change: Number(raw.change ?? 0)`) therefore defers to nothing.

This is the precedent row `R2-239-1` in the ledger, "A deferral cited Q-145,
which did not exist", rated MEDIUM.

**What should have been done:** create the backlog item in the same package, or
cite the ledger row that tracks it.

### Q145-R2-5 · MEDIUM · "R7 … is logged LOW" is false

Commit body ("Not done: R7 … is logged LOW"); PR body ("It is logged LOW").

`Q145-R7` appears in no `reviews/findings-ledger.csv` on any `origin/*` branch,
in no worktree's working copy, and in no backlog. The only place it exists is my
untracked round-1 report. CLAUDE.md: objections must be "resolved or logged".
Saying a finding is logged when it is not is the silent drop that rule exists
to prevent.

**What should have been done:** write the ledger row, through the coordinator,
before claiming it, or say "to be logged".

### Q145-R2-6 · MEDIUM (latent: needs `BLOOMBERG_BRIDGE_URL`) · the field-by-field `??` merge builds change/percent pairs from two vendors, unchecked

`lib/data/mergeQuotes.ts:116-117,132,135,169,164`.

R3 is fixed as stated: N16, which lets a null Bloomberg change win, is KILLED by
`mergeQuotes.test.ts`. But taking each field independently creates a new
inconsistency, which the probe rendered:

```
[R3-a] bb change -3 / pct null + yahoo +5 / +2.59 → {"price":190,"change":-3,"changePct":2.59,"prov":{"change":"bloomberg","changePct":"yahoo"},"dataSource":"bloomberg",...}
[R3-a] header renders: ▲ -3.00 (2.59%)
[R3-b] bb price 190 @15:00, no change + yahoo 198 @14:45 +5 → {"price":190,"change":5,"changePct":2.59,"impliedPrior":185,"yahooPrior":193,"quoteTime":"2026-10-19T15:00:00.000Z","dataSource":"bloomberg"}
[R3-c] bloomberg-only, change 2, pct null → {"change":2,"changePct":null,"prov":{...all "bloomberg"}} | header: — (no change data)
```

- **(a)** A Bloomberg change paired with a Yahoo percent can disagree in sign.
  The header renders a green up arrow over a negative change.
- **(b)** Bloomberg's price paired with Yahoo's change is a move measured against
  *Yahoo's* price at *Yahoo's* time. The row is still stamped with **Bloomberg's**
  `quoteTime` and `dataSource: 'bloomberg'`, so `price − change` (185) is not the
  prior close (193). The type's `'mixed'` value (`:53`) is never emitted. The only
  record of the mix is per-field `provenance`, which has **zero UI readers** (I1).
- **(c)** A Bloomberg-only row with a change and no percent shows "— (no change
  data)", hiding a known change. Its provenance names Bloomberg for fields that
  are null, which the row's own warning string admits (`:164`).

`tickChange` would refuse (a), but REST rows never pass through it.
`setQuote(boot.quote)` renders them as-is.

**What should have been done:**
- Take change and percent as a **pair** from one vendor.
- Or recompute both from `bb.price` and Yahoo's prior close, through `tickChange`.
- Otherwise use null.
- Emit `dataSource: 'mixed'` when any field fell back.
- Add merge tests for (a) and (b).

### Q145-R2-7 · LOW · "Every one is killed, including the red-team's compound three-page reproducer" is false as worded

Commit body, "Mutations" paragraph.

- The round-1 reproducer edits `resolveTickChange` call sites, and
  `lib/quoteChange.ts` is deleted. It **cannot be applied** to `4cbeea9`.
- The same sentence calls the set "30 single restorations", and a compound is not
  a single restoration.
- The PR body's wording, "the page-level **analogs** of the red-team's three-page
  reproducer", is the accurate one.
- I ran those analogs together (C0) and they are killed. On stock and sector,
  though, the kill comes from the `marketHours.test.ts:103` **text** match (N2),
  not from behaviour: the lint-clean compound C1 survives.
- The 30 mutations are not enumerated in the commit, the PR or a file, so the set
  cannot be reproduced.

**What should have been done:** use the PR body's wording, name the 30 (a file
under `reviews/` is enough), and say which ones die on text alone.

### Q145-R2-8 · LOW · the landing render test pins one input; a conditioned "keep the previous change" survives it

`__tests__/components/LandingLiveTick.test.tsx:54-57`; site `app/page.tsx:153`.

The only tick it emits has `marketOpen: true`. N3b,
`next[ticker] = mergeLandingTick(ticker, q.marketOpen ? q : { ...q, change: q.change ?? old?.change ?? null, changePct: q.changePct ?? old?.changePct ?? null })`,
keeps the previous change whenever the market is closed. It is lint-clean, tsc
exit 0, and the suite is 2745 green. This is the repo's seventh reachability
shape: a fixture built from the happy path.

**What should have been done:** parametrise the tick over `marketOpen` true and
false, and over a change-only and a percent-only tick.

### Q145-R2-9 · LOW · `degraded` / `live.error` still has no reader, and the pill says CLOSED for a failed stream

`hooks/useLiveQuote.ts:242-246` (the only writer); pills at
`app/stock/[ticker]/page.tsx:419` and `app/sector/[slug]/page.tsx:315`.

`grep live.error` finds zero readers on either page. Probe: boot priced, then
`onopen`, then `degraded`:
```
[R2-degraded] pill text: CLOSED | title: Live stream connected — market closed (snapshot) | any "degraded" text on page: false
```
`live.marketOpen` starts false and is set only by `quote` and `market_state`
events. A connected stream whose quote fetch failed therefore reads "CLOSED",
and its tooltip asserts a market state nobody measured. The damage is bounded:
the REST price keeps its vendor-stamp age beside it. This predates the PR, and
round 2 does not claim it, but it is the half of round-1 R2 that was left open
and is not named anywhere.

**What should have been done:** render `live.error` (for example "STREAM DEGRADED"
in place of CLOSED), or name it as an open residual in the PR.

### Q145-R2-10 · LOW · `tickChange` checks only the sign, and REST rows bypass it

`lib/liveQuoteState.ts:53`.
```
(0, 2%) @100  → {"change":0,"changePct":2}
(5, 50%) @100 → {"change":5,"changePct":50}
(-5, 0%) @100 → {"change":-5,"changePct":0}
```
`Math.sign(0) * x === 0`, so a zero on one side passes. The test comment "A zero
on either side is not a contradiction" (`__tests__/lib/liveQuoteState.test.tsx:78`)
is wrong for (0, 2%): only (0, 0) is consistent. Magnitude is never compared.
A 5-point change on 100 is 5.26%, not 50%. "Refuses impossible pairs" is
therefore narrower than it reads, and it holds for ticks only (see R2-6).

**What should have been done:** compare against the implied prior close with a
tolerance, or document the sign-only rule as such.

### Q145-R2-11 · LOW · my unverified assumption is now stated as fact

`lib/liveQuoteState.ts:42-43`; commit; PR body.

"crypto rolls its day at 00:00 UTC and CME energy at 18:00 ET." Round 1 listed
both times under **Not verified** ("R4 assumes 00:00 UTC (crypto) and 18:00 ET
(CME)"). The derivation is gone, so no code depends on it. The docstring and PR
nonetheless now present a reviewer's assumption as a measured property.

**What should have been done:** "assumed by red-team R4; not verified".

---

## 1. Round-1 reproducers re-run, adapted to the new structure

Every row ran the full suite plus `tsc`, plus `eslint` on the touched files. All
of the N rows were lint-clean, apart from C0, where eslint flagged the unused
`prev`. The probe column is the untracked page render test.

| id | round-1 analog | mutation | suite + tsc | probe |
|---|---|---|---|---|
| M1 | M1 | landing `next[ticker] = { ticker, price: q.price, change: q.change, changePct: q.changePct }` | KILLED (guard only; behaviour is now equivalent, since nothing is derived) | — |
| M2 | M2 | `mergeStockTick`: `change: tick.change ?? 0, changePct: tick.changePct ?? 0` | KILLED (`liveQuoteState.test`, guard) | — |
| M3 | M3 | the same in `mergeSectorTick` | KILLED (`liveQuoteState.test`, guard) | — |
| M4 | M4 | ticker tape `quotes[s.etf]?.changePct ?? 0` | KILLED (**guard spelling only**; paraphrase N10 survives) | — |
| M5 | M5 | PriceTicker null branch removed | KILLED (`tsc` TS18047, plus the PriceTicker render test) | — |
| M6 | M6 | heatmap `quote?.changePct ?? 0` | KILLED (**guard spelling only**; N8 and N12 survive) | — |
| M7 | M7 | commodities `q?.changePct ?? 0` | KILLED (**guard spelling only**; N9 and N11 survive) | — |
| M8 | M8 | desk `(q.changePct as number)` | KILLED (**guard spelling only**; N18 survives) | — |
| — | M9, M14 | same-session check / reuse of the old change in the derivation | N/A: the derivation is removed | — |
| M10 | M10 | single stream takes `regularMarketChangePercent` raw | KILLED (`changePctParity.test`) | — |
| M12 | M12, M13 | `QuoteChangeLine` null branch replaced with `Number(changePct)` (one component now serves both headers) | KILLED (`liveQuoteState.test` render) — the page-side paraphrase N7 survives | — |
| M15 | M15 | `mergeSectorTick` `pe: prev?.pe ?? 0` | KILLED (`liveQuoteState.test`, guard) | — |
| R6a | R6 | remove the `changePct <= -100` refusal | KILLED (`liveQuoteState.test`) | — |
| R6b | R6 | remove the `price - change <= 0` refusal | KILLED (`liveQuoteState.test`) | — |
| R6c | R6 | remove the opposite-sign refusal | KILLED (`liveQuoteState.test`) | — |
| R8 | R8 | multiplex stream accepts `price <= 0` again | KILLED (`changePctParity.test`) | — |
| N15 | M11 | `unpriced` computed from `yahooQuotes` | KILLED (`prices.test.ts`) | — |
| N16 | R3 | `change: bb.change` (null wins over Yahoo) | KILLED (`mergeQuotes.test.ts`) | — |
| N17 | R5 | brief ETF percent taken raw again | KILLED (`changePctParity.test.ts`) | — |
| N13 / N13b | R2 page wiring | JSX narrowed to `quoteMissing === FAILED_REASON ? (` on stock `:424` / sector `:320`, which puts back the skeleton for an unpriced ticker | **SURVIVED** both | killed (stock) |
| N1, N2, N3, N1c, N2c, N3b, N4, N5, C0, C1 | R1 compound and its pieces | see R2-1 and R2-8 | see above | see above |
| N7 to N12, N18 | M4, M6, M7, M8, M12 paraphrases | see R2-2 | **SURVIVED** all | N7 killed |

N13 is a residual of the R2 wiring guard. `bootMissingProblems` pins that
`setQuoteMissing(boot.reason)` is *called*. It does not pin that the JSX
*renders* every missing reason. The commit's "The parse-tree guard pins that
wiring" holds for the setter half only.

## 2. Is R2 really closed? Rendered, not read

| case | observed on `4cbeea9` |
|---|---|
| `/stock/zzzzqx`, response `{quotes:[], unpriced:['ZZZZQX']}` | "No price from the market-data vendor for this ticker." in a `role=status`; header skeleton **absent** |
| the same, then an SSE tick at 12 | `$12.00` rendered; reason **gone**; `Market Cap: —` |
| `/stock/aapl`, prices HTTP 500 | "The quote failed to load; try again shortly." |
| `/sector/technology`, `unpriced:['XLK']` | reason rendered; skeleton absent |
| `/stock/vix`, a priced `^VIX` row | **false** `ABSENT_REASON`, price not shown → R2-3 |
| stream `degraded` on an open EventSource | pill "CLOSED", no degraded text → R2-9 |

Verdict on R2: **closed for the unpriced and failed cases** on both pages. It is
open for canonical-form tickers (R2-3), for the render branch (N13), and for the
`degraded` half (R2-9).

## 3. R3 merge semantics

The R3 defect itself is closed: no Bloomberg-attributed 0.00% overwrites Yahoo,
and N16 is killed. The per-field fallback introduces mixed-vendor pairs and a
row-level label that hides them (R2-6). Provenance is correct per field, but has
no reader. The Bloomberg-only branch attributes null fields to Bloomberg.

## 4. Every sentence of the commit message and the PR body

### Commit `4cbeea9`

| claim | verdict |
|---|---|
| "The red-team found no BLOCKING defect but showed the consumer half was unguarded" | TRUE. Round 1 used no BLOCKING label; R1 and R2 were HIGH |
| R1: the three pages delegate to `mergeStockTick` / `mergeSectorTick` / `mergeLandingTick`; the helpers are tested directly | TRUE |
| the guard "checks on the parse tree that every setQuote updater RETURNS the helper's result with its own state" | PARTIAL. Decided by callee name and first argument only; defeated by N1c, N4 and N5 → **R2-1** |
| "every landing `next[...] =` IS the helper" | TRUE by name (`landingOffenders`); the behaviour is protected by `LandingLiveTick` |
| "The red-team's reproducers are its positive controls" | TRUE as paraphrases (the original diff cannot apply) |
| "bans `?? 0` / `\|\| 0` on change fields, `as number` and `!` casts … numeric literals … across the product tree" | **FALSE** as a coverage claim → **R2-2** (live at `useBtcPriceWs.ts:104-105,124-125`) |
| "lib/options/chain.ts is a named exemption pinned by a test (Q-156)" | exemption and test TRUE; **Q-156 does not exist** → **R2-4** |
| "A render test drives the real landing page with a tick that carries a price and no change" | TRUE; it kills N3 |
| R2: "`unpriced` has a reader … bootQuoteFrom tells the stock and sector boot fetch whether a quote is priced or missing" | TRUE, except for canonical-form tickers → **R2-3** |
| "A missing or failed quote renders QuoteUnavailable with its reason, instead of a pulsing skeleton" | TRUE (rendered, section 2) |
| "The parse-tree guard pins that wiring" | PARTIAL. The setter yes, the render branch no (N13 / N13b survive) |
| "A test covers a ticker priced only by the Bloomberg bridge (M11)" | TRUE; N15 killed |
| R3: the bridge says null; the merge falls back field by field with `??` and per-field provenance; no more Bloomberg-attributed 0.00% over Yahoo | TRUE; N16 killed. New pairing defect → **R2-6** |
| "the derivation of a missing change from the PREVIOUS quote is removed" | TRUE |
| "It was exact only for US equities (crypto rolls its day at 00:00 UTC, CME energy at 18:00 ET)" | roll times UNVERIFIED (my round-1 assumption) → **R2-11** |
| "a missing change is rare" | UNVERIFIED. Never measured; round 1 said so |
| "With it go nyDateYmd, the landing quoteTime and the marketHours test edits" | `nyDateYmd`: TRUE (net diff of `lib/api/marketHours.ts` against `9dbe71e` is empty). Landing `quoteTime`: TRUE. marketHours test: IMPRECISE. The round-1 landing edits are reverted, but the file still differs from `9dbe71e` by +15 / −5 (new stock/sector and helper assertions, including the text match at `:103`) |
| "tickChange still completes a change/percent pair … refuses impossible pairs: ≤ −100, non-positive prior close, opposite signs" | TRUE for exactly those three; see **R2-10** for what passes |
| R5: the sector brief normalises the ETF and holding percents | TRUE; N17 killed |
| "The dark-pool half is in #251, which owns that route" | TRUE. #251 is OPEN, touches `app/api/darkpool/[ticker]/route.ts` and adds `normalizedChangePercent` |
| R8: the multiplex stream drops a price ≤ 0 | TRUE, and tested |
| "The desk shows a known percent even when the absolute change is missing" | TRUE (code) |
| "its `as number` casts are gone, so tsc proves each cell's null branch" | casts gone TRUE. "tsc proves each cell's null branch" OVERSTATED: N18 (`Number(q.changePct)`) is tsc-clean and renders +0.00% |
| "The landing count is 'No change data', not 'No quote'" | TRUE |
| "The stock and sector headers render one shared component, QuoteChangeLine, tested by render" | component TRUE; nothing pins the headers to it (N7) |
| "Not done: R7 … is logged LOW" | **FALSE** → **R2-5** |
| "The fixture comment it named is corrected" | TRUE |
| "Mutations: 30 single restorations … Every one is killed, including the red-team's compound three-page reproducer …" | set not enumerated; the compound wording is **FALSE** → **R2-7** |
| "Full suite 2745 passed; lint 0 warnings; typecheck clean; byte-level EOL check clean" | TRUE (re-measured). EOL: the two CRLF files touched, `app/commodities/page.tsx` and `lib/yahooQuoteFields.ts`, are 185/185 and 48/48 CRLF with no lone CR |

### PR body

| claim | verdict |
|---|---|
| "Every quote producer was turning a field Yahoo didn't supply into 0 … since round 2, also the Bloomberg bridge" | Producers TRUE. The last bullet is ambiguous: it reads as "the bridge started doing it in round 2"; it means "round 2 also fixed the bridge". Nit |
| "As a result" (0.00% FLAT, $0.00, tick overwrote a real change) | TRUE (round 1) |
| "Producers now return null. `/api/prices` drops … names it in `unpriced`" | TRUE |
| single-ticker stream and sector brief passed the percent unnormalised; the parity test covers both; dark-pool half in #251 | TRUE |
| "Each page's quote transition is now a pure, tested helper" | TRUE |
| "A tick with no change renders '—'. It never shows the previous change … and never 0" | TRUE of the committed tree (rendered on both pages); NOT GUARDED on stock/sector → **R2-1** |
| "tickChange … refuses impossible pairs" | partial → **R2-10** |
| "bootQuoteFrom gives unpriced its reader … renders '—' with the reason … instead of a skeleton that never resolves" | TRUE (rendered), except **R2-3** |
| correction box: "compared calendar dates … exact for US equities but wrong for crypto (rolls at 00:00 UTC) and CME energy (rolls at 18:00 ET)" | the dates part TRUE; roll times UNVERIFIED → **R2-11** |
| "Round 1's '7 mutations, all killed' covered the producers only. The consumer reverts survived (red-team R1)" | TRUE |
| "round 2 is what guards them" | PARTIAL → **R2-1**, **R2-2** |
| What guards it, item 1 (setQuote returns its helper's result; landing `next[…]` is `mergeLandingTick`) | name-based → **R2-1** |
| item 2 ("no product file writes `?? 0` / `\|\| 0` on a change field, casts one …, or writes a numeric literal into one") | **FALSE** → **R2-2** |
| item 3 (each page turns a missing or failed boot quote into the missing state) | setter TRUE; render branch unpinned (N13) |
| "The red-team's reproducers and their paraphrases are its positive controls" | TRUE |
| "The named residuals are pinned as passing tests: a quote built in a local, and lib/options/chain.ts … (Q-156)" | tests TRUE; **Q-156 nonexistent** (**R2-4**); the residual list is incomplete (second argument, shadowed helper, early return, render-time substitution, `Number()` / ternary / alias / constant / string / other field names) |
| "A render test drives the real landing page …" | TRUE |
| "Render tests cover the shared QuoteChangeLine (both headers), QuoteUnavailable, PriceTicker and SectorCard" | components TRUE; "(both headers)": neither header is rendered by any test (N7) |
| Test plan: typecheck, lint 0, EOL; 2745 passed | TRUE |
| "30 mutations … All 30 are killed" | not reproducible as a set. Every named category I re-ran is killed, but stock/sector R1 only by a text match (**R2-7**). "R2: both pages' wiring of the missing state" is setter-only (N13) |
| "[ ] CI" | stale checkbox: CI has run on `4cbeea9` and every check passed (advisory, I7) |
| "Not done here: R7 … It is logged LOW" | **FALSE** → **R2-5** |

**The imprecision you flagged.** The PR body ("the page-level analogs of the
red-team's three-page reproducer") is accurate. The commit ("the red-team's
compound three-page reproducer") is not. The original cannot apply, and the
analogs were run as single restorations (R2-7).

## Checked and found TRUE

- **Rendered on the committed tree:**
  - A no-change tick after a priced boot gives "— (no change data)" on `/stock`
    and on `/sector`.
  - Unpriced and failed boots render the reason and no skeleton.
  - A later tick clears the reason, and market cap is "—".
- **Killed** by the full suite, with the killing file named:
  - N3, the landing second argument (`LandingLiveTick`);
  - N15, M11 (`prices.test.ts`);
  - N16, R3 (`mergeQuotes.test.ts`);
  - N17, R5 (`changePctParity.test.ts`);
  - C0, the plain three-page analogs.
- Round-1 R6 (all three named refusals) and R8 (the stream price rule) are closed
  as described, and mutation-checked: R6a, R6b, R6c and R8 are each killed.
- R4 and R9 are closed by deletion, which I read and did not mutate: the
  derivation and `nyDateYmd` are gone, and the net diff of
  `lib/api/marketHours.ts` against `9dbe71e` is empty.
- `#251` carries the dark-pool normaliser.
- The two CRLF files keep their line endings.

## Not verified

- The BTC header's `▲ 0.00%` (R2-2) is read from the code, not rendered.
- No browser render. Every page observation comes from jsdom with mocked
  `next/dynamic`, `WatchlistButton`, `next/navigation` and `localStorage`.
  Production was not loaded.
- Whether Yahoo really omits change fields, or how often. R2-6 and R2-10 are
  latent or rare-path.
- The Bloomberg bridge was not exercised live. R2-6 is shown on the merge function.
- The PR's 30 mutations, which are not enumerated.

## Verdict

**NOT DONE. Do not merge on the current text.**

Nothing here regresses production behaviour, and the committed code renders
correctly on every path I drove. What blocks is the definition of done:
objections must be resolved or logged, and "tagged code ≠ fixed effect".

**Blocking, because each is a false claim:**
- **R2-4.** The guard's only deferral cites `Q-156`, which does not exist.
  Create it, or re-cite a real ID.
- **R2-5.** "R7 is logged LOW" is not true anywhere. Log it, or reword it to
  "to be logged".
- **R2-2.** "No product file writes `?? 0` / `|| 0` on a change field" is false
  at `useBtcPriceWs.ts:104-105`. Narrow it to the named fields, and log the
  crypto zeros.
- **R2-7.** The commit's "compound three-page reproducer … killed" is false as
  worded. Use the PR body's "analogs" wording.
- **The headline claim that R1 is now guarded (R2-1).** It is true for the
  landing page only.

**R2-1 (HIGH) can close either way:**
- **Recommended, and cheap:** stock and sector page render tests. Cover a
  no-change tick after a priced boot, and an unpriced boot, as my probe does. It
  mounts in about 0.5 s and kills N1c, N2c, N4, N5, N7 and N13.
- **Alternative:** correct the claim, name the shapes in the guard's RESIDUAL
  block (second argument, shadowed helper, early return, page-side inline header,
  JSX branch narrowing), and log R2-1 in the ledger. CLAUDE.md treats closing an
  existing gap as backlog work, not a merge blocker. The false sentence is what
  blocks.

**Should be fixed in this package, not just logged:**
- **R2-3**, the false "did not include this ticker" on `/stock/vix`. Round 2's
  own reader introduced it, and the fix is one canonicalisation call.
- **R2-11**, the unverified roll times stated as fact. This is a wording change
  only.

**Can be logged:** R2-6 (mixed-vendor pairs, latent behind the bridge), R2-8
(the landing fixture is happy-path only), R2-9 (`degraded` has no reader; the
pill says CLOSED) and R2-10 (sign-only pair check).
