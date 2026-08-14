# ALGORITHMS — LIVE COMPUTATION PATH REVIEW
**Wave 1 / REVIEW phase — 2026-08-15**
Reviewer: senior quantitative-systems reviewer (Opus 5, read-only — no source edits, no commits)
Repo: worktree `sweet-dubinsky-4e07b2`, branch `claude/investment-platform-overhaul-cc514b`, baseline main @ `b3773b6`

Scope: the LIVE computation path that serves prod pages today. NOT backtest research
methodology (closed area — MASTER-PLAN §4 register respected throughout).

> **STATUS: COMPLETE** — full brief scope covered (fixture-vs-live gap, signal correctness,
> recompute cadence, cross-surface consistency, disclosure). 12 findings: 2×P0, 5×P1, 2×P2,
> 3×P3 — plus a checked-and-clear register (AL-12) so future waves don't re-audit settled ground.
> All numeric claims carry runtime-probe evidence.

---

## 0. HEADLINE

Three things are true at once, and together they are the wave's yield:

1. **The signal engine has no live market data.** `/api/backtest/live` — source of every
   BUY/HOLD/SELL, confidence, Kelly fraction and regime zone on `/backtest` — reads
   **committed JSON fixtures** refreshed by a **weekly GitHub Actions cron**. Worst case a
   displayed action is built on a close **5 completed sessions** old (every weekend).
2. **The UI affirmatively denies this**, printing *"Live data refreshes every 60s"* under
   week-old numbers.
3. **A live board asserts a trend fact it never computed.** `/api/ma-deviation` fetches a
   310-calendar-day window = **214 trading bars**, but the 200-SMA slope needs **221**. The
   slope is therefore `null` on every row of that board, and `ma200Regime` has no null arm —
   so any ETF in the −10%…−30% band is labelled **FALLING_KNIFE / "a DECLINING 200-day SMA"**
   from a slope that was never calculated. The sibling function `regimeSignal` already has
   this exact fix; it was never ported. This is a wrong number reaching a trading decision,
   it is unconditional, and it has nothing to do with the staleness problem.

Findings 1–2 are one root cause (fixture cadence) split into structural (P1) and disclosure
(P0) halves. Finding 3 is independent, is the only true math P0, and is the cheapest to fix.

---

## 1. LIVE-PATH MAP

Two disjoint data worlds exist and are not reconciled:

| Surface (user-visible) | Route | Computed where | Data source | Trigger / cadence | Verdict |
|---|---|---|---|---|---|
| Signals table: action, confidence, Kelly, zone, dipSignal, RSI, ATR, MACD, %B | `/api/backtest/live` | `lib/backtest/liveSignal.ts` → `resolveBacktestSignal` | **fixture JSON** | per-request, 60 s memo over frozen inputs | ⛔ **FIXTURE-FROZEN** |
| Backtest results, portfolio alpha, Sharpe | `/api/backtest` | `lib/backtest/engine.ts` | **fixture JSON** | per-request, 1 h memo | 🟡 fixture (legitimate — backtests are historical; disclosure gap only, AL-8) |
| HMM regime + posteriors | `/api/regime/[ticker]` | sidecar / fallback, fed by `loadStockHistory` | **fixture JSON** | per-request, `s-maxage=3600` | ⛔ **FIXTURE-FROZEN, zero disclosure** |
| GARCH 20-bar conditional vol | `/api/conditional-vol/[ticker]` | sidecar / EWMA fallback, fed by `loadStockHistory` | **fixture JSON** | per-request, `s-maxage=86400` | ⛔ **FIXTURE-FROZEN + 24 h CDN cache on week-old data** |
| QuantLab Technicals: `ma200Regime` zone/dipSignal, RSI, SMA | `/api/fundamentals/[ticker]` → `buildFundamentalsPayload` | `lib/quant/technicals.ma200Regime` | **live Yahoo** (800 d) | per-request | ✅ live — but contradicts the Signals table (AL-4/AL-5) |
| MA-deviation board: price, sma200, sma50, rsi14, regime | `/api/ma-deviation` | route-inline + `lib/quant/technicals` | **live Yahoo** (310 d ⇒ **214 bars**) | per-request, 5 min memo | 🟥 live data, but window is **7 bars short of the slope minimum** ⇒ AL-4 fires on every row |
| Sector rotation scores | `/api/sector-rotation` | `lib/quant/sectorRotation` | **live Yahoo** (2 y) | per-request, `s-maxage=3600` | ✅ live |
| Analytics: winRate252d, beta, corr vs SPY | `/api/analytics/[ticker]` | route-inline | **live Yahoo** (5 y) | per-request, `s-maxage=300` | ✅ live |
| ML prediction | `/api/ml/[ticker]` | Python sidecar | sidecar-internal | per-request | ⚪ sidecar-gated (unset in prod ⇒ `available:false`) |

**Vercel Cron does not exist.** `vercel.json` has no `crons` key at all — the brief's premise
is not met. Every scheduled job is GitHub Actions (AL-6).

---

## 2. FINDINGS

### AL-1 — `/api/backtest/live` is not live: signals computed on data up to 5 completed sessions old
**Severity: P1** (materially stale — the structural half; the disclosure half is AL-2, the P0)
**Confidence: HIGH — measured**

**Evidence.** `app/api/backtest/live/route.ts:11-13,37,44` loads via `loadStockHistory` /
`loadBtcHistory`, which read `scripts/backtestData/*.json` (`lib/backtest/dataLoader.ts:28-46,53-131`).
The route's own header is candid — *"latest available daily close from locally pre-fetched
data files. No external API calls"* (`route.ts:3-5`). The route **name**, the payload field
`computedAt`, and the UI label all say otherwise.

Runtime probe (read-only, this session):

```
AAPL fetchedAt=2026-08-09T22:28:19.772Z n=1254 lastBar=2026-08-07 close=313.33
NVDA fetchedAt=2026-08-09T22:28:19.501Z n=1254 lastBar=2026-08-07 close=223.96
XOM  fetchedAt=2026-08-09T22:28:20.114Z n=1254 lastBar=2026-08-07 close=153.04
JPM  fetchedAt=2026-08-09T22:28:20.879Z n=1254 lastBar=2026-08-07 close=357.52
BTC  fetchedAt=2026-08-09T22:28:26.499Z n=1826 lastBar=2026-08-09 close=65181.05

lastBar histogram across all 56 fixtures: {"2026-08-07": 55, "2026-08-09": 1}
all 56 fixtures ≥ 200 bars (min 1254) — see AL-9
```

Cadence: `.github/workflows/refresh-data.yml:4-6` → `cron: '0 22 * * 0'` = **Sunday** 22:00 UTC.
(The brief said Saturday; it is Sunday.) Commit history confirms it runs and is weekly:
`0c25245 (2026-08-09)`, `a12ff7d (08-02)`, `84ec79a (07-26)`, `0e4f9de (07-19)` — all Sundays.

**Staleness, measured as completed sessions missing from the fixture** (the robust metric —
calendar-day counts mislead across weekends):

| Reading the page on | Fixture's newest bar | Completed sessions missing |
|---|---|---|
| Mon (pre-open) | prior Fri | 0 |
| Tue | prior Fri | 1 (Mon) |
| Wed | prior Fri | 2 |
| Thu | prior Fri | 3 |
| Fri (mid-session) | prior Fri | 4 (Mon–Thu) |
| **Sat / Sun before 22:00 UTC** | prior Fri | **5** (Mon–Fri) |

At the probe timestamp (`2026-08-14T16:05Z`, Friday mid-session) the missing set is
Aug 10/11/12/13 = **4 completed sessions**. The weekly **maximum is 5**, reached every
Saturday and Sunday before the 22:00 UTC refresh — once Friday's session completes and before
the cron runs. This report is dated Saturday 2026-08-15, so its own reading day is the 5 case
(missing Aug 10/11/12/13/14).

**Impact.** Every action, confidence, Kelly fraction, regime zone and `deviationPct` on the
Signals tab can be built on a close five sessions stale. A Monday gap-down is invisible until
the following Sunday night. **BTC is worse in kind**: a 24/7 instrument on a weekly cadence
has no "market closed" interval during which an unchanged number is legitimate.

**Proposed fix** (staged):
1. **Disclosure first (S)** — AL-2; ships independently and removes the active harm.
2. **Live last-bar overlay (M).** Keep the fixture as the *history spine*; fetch only the
   current bar live. A single batched quote call covers all 56 symbols (~1 upstream request,
   ~300–800 ms — trivially inside the 300 s ceiling), versus 56 `chart` calls which would not
   be. **Partial-bar rule is mandatory and must be specified up front:** splice a live bar
   ONLY when that session has closed. During market hours either (a) leave the last completed
   session as the signal bar and show the live price as separate context, or (b) splice and
   mark the signal `provisional: true`. Without this rule RSI/ATR/MACD/%B flicker intra-session
   and disagree with their own post-close values — trading §2's "partial-bar handling" problem
   for the staleness problem. Recommend (a): the engine is a daily-close model; a provisional
   intraday signal is a different estimator than the one benchmarked.
3. **Daily post-close refresh (M).** Move `refresh-data.yml` from weekly to
   `0 22 * * 1-5`, so the spine is ≤1 session stale even without the overlay. This is the
   cheapest large win — a one-line cron change plus AL-6's freshness gate. Cost: 5×/week
   Actions minutes and 5 commits/week to `scripts/backtestData/` (~56 files, already the
   established pattern).

**Effort: M** (S for step 3 alone). **Confidence: HIGH.**

---

### AL-2 — UI states "Live data refreshes every 60s" over data that refreshes weekly
**Severity: P0** (affirmative false freshness claim on the trading surface)
**Confidence: HIGH — measured**

**Evidence.** `components/backtest/LiveSignalsPanel.tsx:209-212`:

```tsx
{latestDataDate && (
  <div className="text-[10px] text-slate-400">
    Data as of: <span className="…">{latestDataDate}</span> · Live data refreshes every 60s
  </div>
)}
```

The `60s` traces to `CACHE_TTL_MS = 60 * 1000` (`app/api/backtest/live/route.ts:21`) — the
memoisation window for **recomputing the same frozen inputs**. Re-running an identical
computation over an identical week-old fixture every 60 s returns an identical answer. The
claim has no referent in market data.

Compounding: `route.ts:111` stamps `computedAt: new Date().toISOString()` (always *now*), and
the panel sets `lastFetched` from `new Date().toLocaleTimeString()` at fetch time
(`LiveSignalsPanel.tsx:37`). **Three** freshness signals report *now*; the one truthful field
(`lastDate` → `latestDataDate`, `liveSignal.ts:79-82`) renders at `text-[10px]` immediately
beside the false sentence.

**Impact.** Undisclosed staleness is P1. **Denied** staleness is P0: a professional reading
"Live data refreshes every 60s" concludes prices are near-real-time, and correctly reading the
widget requires disbelieving the sentence next to the date. This is the single cheapest
high-yield fix in the wave.

**Proposed fix.**
- Delete the "Live data refreshes every 60s" clause.
- Replace with a computed staleness disclosure driven by `latestDataDate`:
  `Close of {latestDataDate} · {n} sessions old · next refresh Sun 22:00 UTC`, amber at
  `n >= 1`, red at `n >= 3`.
- Add top-level `dataAsOf` (max `lastDate`) and `dataAgeSessions` to the payload so every
  consumer inherits the disclosure instead of re-deriving it. Change `dataSource: 'local'` →
  `'fixture-weekly'`; `'local'` describes storage, not freshness.
- Follow-up (L, separate wave — public path): rename `/api/backtest/live`. The word "live"
  in the URL is itself a claim.

**Effort: S.** **Confidence: HIGH.**

---

### AL-3 — `changePct` is labelled as a daily move but describes two stale bars
**Severity: P1**
**Confidence: HIGH**

**Evidence.** `lib/backtest/liveSignal.ts:61-63`:

```ts
const price = closes[closes.length - 1]
const prevPrice = closes[closes.length - 2]
const changePct = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : null
```

Rendered as a "Change %" column in the Signals table (`LiveSignalsPanel.tsx:18` sort key
`changePct`) with no date qualifier. On a Friday read this is **last Thursday→Friday's**
move, presented in a column a trader reads as *today's*.

Distinct from AL-1 in kind: staleness makes a number *old*; this makes it *mislabelled*.
A stale RSI is still that instrument's RSI as of a stated date. A "Change %" with no date, in
a table headed "live", is read as today's change and is not.

Secondary: `prevPrice ?` is a **falsy** check, not a null check — a legitimate `prevPrice === 0`
yields `null` (correct by luck), but the idiom should be `Number.isFinite(prevPrice) && prevPrice > 0`
to match the codebase's own convention in `sma200DeviationPct` (`indicators.ts:61-65`).

**Proposed fix.** Rename the column to `Δ vs prior close` and label it with the bar date, or
drop it until the AL-1 overlay lands. Tighten the guard to the finite-and-positive idiom.
**Effort: S.** **Confidence: HIGH.**

---

### AL-4 — `ma200Regime` emits "FALLING KNIFE … a DECLINING 200-day SMA" when the slope is uncomputable
**Severity: P0** (a wrong, alarming trading label asserted from missing data — on the live Yahoo path)
**Confidence: HIGH — runtime probe**

This is the genuine math P0 and is **independent of the fixture/staleness problem** — it sits
on the *live* per-request path (`/api/fundamentals/[ticker]` → QuantLab Technicals tab).

**Evidence.** Two off-by-one-linked facts:

- `lib/quant/buildFundamentalsPayload.ts:349-350` gates the call at **`closes.length >= 220`**:
  ```ts
  const ma200RegimeVal: MA200Regime | null =
    price != null && closes.length >= 220 ? ma200Regime(price, closes, rsi14) : null
  ```
- `lib/quant/indicators.ts:71-77` — `sma200Slope` returns `null` below **221** closes:
  ```ts
  export function sma200Slope(closes: number[]): number | null {
    if (closes.length < 221) return null
  ```

So at exactly **220 closes** the gate opens and the slope is `null` ⇒ `slopePositive === null`.
`ma200Regime`'s DEEP_DIP / BEAR_ALERT branches have **no null arm** — `if (slopePositive === true) … else …`
(`technicals.ts:232-243`) — so unknown falls into the `else`, which asserts a declining SMA as fact.

Runtime probe (`npx tsx`, synthetic series, this session):

```
=== B. DEEP_DIP at exactly 220 closes (slope UNCOMPUTABLE, needs 221) ===
  sma200Slope(220 closes) = null
  ma200Regime  : DEEP_DIP / FALLING_KNIFE
    text: FALLING KNIFE RISK: Price is -14.9% below a DECLINING 200-day SMA. This pattern (2000–2002...
  regimeSignal : DEEP_DIP / WATCH_DIP / action HOLD conf 20
  >> dipSignal AGREE? false
```

The sibling function `regimeSignal` **already has this exact fix** — `lib/backtest/regimeSignal.ts:153-161`,
the Q05-1 fail-closed, with a comment describing precisely this bug class:

> *"at 200–220 bars sma200Slope() returns null … The zones below treated unknown like negative
> and emitted a confident FALLING_KNIFE SELL (82–95%) from missing-slope data … Unknown trend
> in a deep-dip zone → low-confidence HOLD, never a SELL."*

**The fix was applied to `regimeSignal` and never ported to `ma200Regime`.** This is not a
relitigation of a closed decision — it is an unfinished fix, and `ma200Regime` is on the live
path for every individual stock in QuantLab.

**Reach — two call sites, and the second one is unconditional.**

*(a) `buildFundamentalsPayload` (QuantLab): exactly `closes.length === 220`.* The gate is `>= 220`
and the slope needs `>= 221`, so the defect window is a **single integer** — one day per newly
listed ticker, as its bar count crosses 220. Narrow.

*(b) `/api/ma-deviation` (the MA-deviation board): every request, every row, permanently.*
`app/api/ma-deviation/route.ts:38-39` sizes the fetch window as:

```ts
period1.setDate(period1.getDate() - 310) // ~310 calendar days → ~220 trading days
```

The comment sized the window to the **SMA** (200) and not to the **slope** (221). Measured
against real trading dates rather than the 5/7 approximation:

```
=== /api/ma-deviation window sizing (period1 = now - 310 days) ===
  real trading days in a 310-calendar-day window (AAPL): 214
  sma200Slope requires >= 221 closes
  >> slope computable? false
  sma200Slope(actual window) = null

=== ma200Regime on that exact window, price -15% vs 200SMA ===
  zone: DEEP_DIP / dipSignal: FALLING_KNIFE
  slopePct: null / slopePositive: null
  text: FALLING KNIFE RISK: Price is -15.0% below a DECLINING 200-day SMA. This pattern (2000–2002, 2008, 2022) historically pre...
```

**214 < 221 always.** The only length guard before the call is `quotes.length < 10`
(`route.ts:73`), so `ma200Regime` is invoked with a sub-221 array for **all 13 tickers (11
sector ETFs + SPY + QQQ) on every request**. Consequently, on that board `slopePct` and
`slopePositive` are `null` on every row today, and **any ETF that falls into the −10%…−30%
band is labelled FALLING_KNIFE and told the 200-day SMA is "DECLINING" — from a slope the code
never computed.** In a sector drawdown this fires on real rows in front of the user.

**Impact.** The user is told a fact about the trend that the system does not know, in the most
alarming language the codebase contains, on a live user-visible board, unconditionally. This is
the reach that earns AL-4 the P0 — call site (b), not (a).

**Proposed fix** (all three; any one alone leaves a hole):
1. Add the null arm to `ma200Regime`'s DEEP_DIP / BEAR_ALERT / CRASH_ZONE branches, mirroring
   `regimeSignal.ts:158-161` — unknown slope ⇒ `WATCH_DIP` with "insufficient history to
   confirm 200MA slope" text. The FIRST_DIP branch (`technicals.ts:228-230`) already does
   exactly this and is the in-file precedent to copy.
2. Raise the `buildFundamentalsPayload` gate 220 → **221** (`buildFundamentalsPayload.ts:350`).
3. **Widen `/api/ma-deviation`'s window: 310 → ~400 calendar days** (`route.ts:39`), giving
   ~275 trading days and comfortable headroom over 221. *Without this, fix 1 makes the board
   render "insufficient history to confirm slope" on all 13 rows forever* — correct but
   useless. Fix 1 makes it honest; fix 3 makes it work.
4. Regression tests: `ma200Regime` on exactly 220 closes in a DEEP_DIP series must not return
   `FALLING_KNIFE`; and an assertion that ma-deviation's window yields ≥221 bars.

**Effort: S.** **Confidence: HIGH.**

---

### AL-5 — Two implementations of the 200-SMA dip classifier return contradictory labels on identical input
**Severity: P1** (cross-surface contradiction in a trading label — the §4 SSOT-drift precedent, live)
**Confidence: HIGH — runtime probe**

**Evidence.** The same conceptual quantity ("where is price vs the 200-SMA, and is this a dip
worth buying") is computed by two functions on two surfaces:

| | `regimeSignal` | `ma200Regime` |
|---|---|---|
| File | `lib/backtest/regimeSignal.ts:95` | `lib/quant/technicals.ts:111` |
| Surface | Signals table (`/api/backtest/live`) | QuantLab Technicals + MA-deviation board |
| Data | fixture (weekly) | live Yahoo |
| Uses `priceWasNearSmaRecently` (FIX D) | **yes** (`:109,141`) | **no** |
| Null-slope fail-closed (Q05-1) | **yes** (`:158-161`) | **no** → AL-4 |
| Emits `action`/`confidence` | yes | no |

Zone boundaries and the `slope > 0.005` threshold **do** agree (both call the F-6 SSOT
`sma200DeviationPct` / `sma200Slope` — `indicators.ts:61,71`), so the *zone* is consistent.
The **`dipSignal`** is not. Probe:

```
=== A. DEEP_DIP, rising 200MA, 400 bars (slope KNOWN positive) ===
  ma200Regime  (QuantLab /api/fundamentals): DEEP_DIP / WATCH_DIP
  regimeSignal (Signals /api/backtest/live): DEEP_DIP / STRONG_DIP / action BUY conf 88
  >> dipSignal AGREE? false

=== C. BEAR_ALERT, rising 200MA, 400 bars ===
  ma200Regime  : BEAR_ALERT / WATCH_DIP
  regimeSignal : BEAR_ALERT / STRONG_DIP / action BUY
  >> dipSignal AGREE? false
```

**Same ticker, same day, same input ⇒ the Signals table says `STRONG_DIP` / BUY at 88%
confidence while QuantLab says `WATCH_DIP` for the identical instrument.** Add the fixture/live
data split (AL-1) and the two surfaces can disagree on *zone* as well, for a second, independent
reason.

**Impact.** A trader cross-checking a BUY on the Signals table against the stock's own QuantLab
page is told to wait. There is no disclosure anywhere that these are different estimators. This
is the sector-color-SSOT / sma200-dupe precedent repeating in the number-producing layer.

**Proposed fix.** Make `regimeSignal` the SSOT for `dipSignal` and have `ma200Regime` delegate
to it, keeping its own presentation layer (label/color/interpretation/forwardReturnContext)
on top. Concretely: `ma200Regime` computes zone as today, then calls `regimeSignal` for
`dipSignal`/`slopePositive` and maps the explanation text off that result. This also fixes AL-4
for free. If full delegation is judged too invasive for one wave, at minimum port FIX D and the
null-slope arm into `ma200Regime` and add a parity test asserting
`ma200Regime(...).dipSignal === regimeSignal(...).dipSignal` across a zone/slope/nearSma matrix.
**Effort: M.** **Confidence: HIGH.**

---

### AL-6 — No Vercel Cron; no freshness gate; a silent refresh failure is undetectable
**Severity: P1**
**Confidence: HIGH**

**Evidence.** `vercel.json` in full:

```json
{ "regions": ["iad1"], "buildCommand": "npm run build",
  "outputDirectory": ".next", "installCommand": "npm ci", "framework": "nextjs" }
```

No `crons` key. All scheduled work is GitHub Actions: `refresh-data.yml` (Sun 22:00 UTC),
`nightly-backtest.yml` (`0 6 * * 1-5`), `stryker-weekly.yml`, `a11y-axe.yml`.

Two gaps compound:

1. **`refresh-data.yml` exits 0 when nothing changes** (`refresh-data.yml:36-40`):
   ```bash
   if git diff --quiet -- scripts/backtestData/; then
     echo "No data changes — skipping commit."; exit 0
   fi
   ```
   A Yahoo outage, a schema change, or a silently-empty fetch produces *no diff* and a
   **green check**. The pipeline cannot distinguish "market data unchanged" (impossible across
   a week for 56 instruments) from "fetch returned nothing". Nothing asserts the fixture's
   newest bar is recent.
2. **`nightly-backtest.yml` runs Mon–Fri and would catch signal regression, but its floor is
   a WR check on the *label* benchmark** — it validates the signal against history, not the
   data's freshness. A frozen fixture yields a perfectly stable WR forever. **The nightly gate
   is structurally incapable of detecting that the data stopped updating.**

Note (checked, clear): `scripts/benchmark-signals.ts:3,9,63,212` forces
`QUANTAN_USE_ENHANCED_SIGNAL=0` and passes `productionPath: true`, so the nightly floor
measures the **same regime-only path prod serves**. No gate/prod mismatch here — verified, not
assumed.

**Proposed fix.**
- Add a freshness assertion to `refresh-data.yml`: after fetching, fail if
  `max(lastBar) < today − 4 calendar days`. Turns a silent no-op into a red build.
- Move the refresh to `0 22 * * 1-5` (see AL-1 step 3).
- Add a lightweight prod freshness probe — either a Vercel Cron hitting a
  `/api/health/data-freshness` route that returns the fixture's newest bar and 503s past a
  threshold, or extend the existing nightly workflow to curl prod and assert `dataAsOf`
  (the field AL-2 introduces). The Vercel Cron route is the better long-term home and is the
  natural place to hang the AL-1 scheduled recompute later.
**Effort: S.** **Confidence: HIGH.**

---

### AL-7 — Prod displays MACD / ATR% / BB%B beside an action those indicators do not influence
**Severity: P2** (misleading attribution — the user infers confluence that is not there)
**Confidence: HIGH**

**Evidence.** `lib/featureFlags.ts:10-17`:

```ts
if (raw === '1' || raw === 'true') return true
if (raw === '0' || raw === 'false') return false
if (process.env.NODE_ENV === 'production') return false   // ← prod
return true                                               // ← dev/test
```

In prod `resolveBacktestSignal` takes the regime-only branch (`signals.ts:334-355`), which
returns `confirms: []`, `weightedConfirms: []`, `totalWeightedScore: 0`, `multiTfScore: 0`,
`volumeZone: null`. The action is **`regime.action` alone** — i.e. `regimeSignal(price, closes, rsi14)`,
a pure 200-SMA deviation + slope + near-SMA classifier. Of the displayed indicators, **only
RSI participates**, and only as a confidence bump (`regimeSignal.ts:146`: `rsi14 < 35 ? 90 : 75`
in FIRST_DIP).

Yet `liveSignal.ts:65-73` independently computes `rsi14`, `macdHist`, `atr14`/`atrPct`, `bbPctB`
and ships them, and `LiveSignalsPanel` renders them as sortable columns adjacent to `action`
and `confidence`. A trader reads the row as "BUY, and here is the confluence behind it."
MACD/ATR/BB are decorative in prod.

*This is not a relitigation of the closed "enhanced stack OFF in prod" decision* — that
decision is respected. The finding is that the **UI does not reflect it**.

**Secondary (efficiency, same root):** `signals.ts:351` calls `detectRegime(closes, bars)` on
the disabled branch purely to populate a `volRegime` field that `liveSignal.ts` never reads —
56 instruments × a full regime computation discarded on every uncached request.
`multiTimeframeSignal` and `volumeProfile` are reachable **only** from `enhancedCombinedSignal`
(verified: sole call sites `signals.ts:128,131`), so they are dead on the prod live path — worth
recording so no future wave audits them as live-path code.

**Proposed fix.** Either (a) label the indicator columns as "context, not inputs" and visually
separate them from action/confidence, or (b) surface `signalReason` (already computed at
`liveSignal.ts:117`, then **stripped** from the API payload at `route.ts:29-34`) so the user
sees the actual driver: `"{zone} [regime-only path; enhanced disabled in production]"`. (b) is
strictly better and nearly free — the string already exists and is deliberately discarded.
Also drop the dead `detectRegime` call on the disabled branch. **Effort: S.** **Confidence: HIGH.**

---

### AL-8 — `/api/backtest` portfolio metrics carry no as-of / window / net-vs-gross disclosure
**Severity: P2**
**Confidence: MEDIUM-HIGH**

**Evidence.** `app/api/backtest/route.ts:95-119` returns `avgReturn`, `avgAnnReturn`, `alpha`,
`sharpeRatio`, `sortinoRatio`, `winRate`, `profitFactor`, `avgTradeReturn` with `computedAt`
(= now) and `runId` — but **no** field stating the data window (first/last bar), the hold
horizon the engine used (H=60), or whether `winRate` is net or gross of costs.

The repo is unusually careful about this distinction internally — `nightly-backtest.yml`
tracks `aggregateNetWinRate` and `aggregateWinRate` separately against separate floors, and
`reviews/invariants-baseline.md` §1b freezes both. **None of that reaches the API consumer.**
Given the register's explicit warning that engine WR (H=60) and label WR (H=20) are different
quantities that must never be compared, shipping a bare `winRate` with no horizon or
net/gross tag is an invitation to exactly that error.

**Proposed fix.** Add to the portfolio payload: `dataWindow: { from, to }` (from the
instrument bars actually used), `holdDays: 60`, `winRateBasis: 'gross' | 'net'`, and
`costModel` summary. Render window + basis next to the headline numbers on `/backtest`.
**Effort: S.** **Confidence: MEDIUM-HIGH** (payload shape is certain; which UI surfaces render
which metric was not exhaustively traced).

---

### AL-9 — `/api/regime` and `/api/conditional-vol`: stale inputs, wall-clock forecast dates, and a `model` field that misreports the estimator
**Severity: P3** (orphan routes — no UI consumes them; P1 the moment one does)
**Confidence: HIGH**

**Scope correction, verified:** a repo-wide grep for `conditional-vol` / `api/regime/` outside
the route files, tests and docs returns **nothing**. Neither route is wired to any page,
component or hook. They are reachable public endpoints but not user-visible surfaces today.
Severity is set accordingly — this is a latent trap, not live harm.

Three defects, all live if either route is ever wired up:

1. **Stale inputs, zero disclosure.** Both feed `loadStockHistory` (fixture — AL-1) into the
   sidecar/fallback (`regime/route.ts:36-41`, `conditional-vol/route.ts:35-40`). Unlike the
   Signals panel, neither response carries *any* date: `regimeHmmClient` returns
   `{ ticker, currentState, probabilities, source }` (`:18-23,38`) — no as-of at all.
2. **Forecast dates come from the wall clock, not from the data.** `garchClient.ts:63`
   (`ewmaVolForecast`) does `const cursor = new Date()` and emits the next N business days
   **starting tomorrow**, while `closes` end at the fixture's last bar. On a Friday the
   response asserts a vol forecast for `2026-08-15 …` computed from data ending `2026-08-07`
   — a 5-session gap that is invisible in the payload. The forecast should originate from the
   last input bar, not from `now`.
3. **`model: 'GARCH(1,1)'` is returned on the EWMA fallback path.** The interface hardcodes
   the literal (`garchClient.ts:13`) and the fallback return sets it (`:55`) alongside
   `source: 'ewma-fallback'`. `QUANT_FRAMEWORK_URL` is commented out in `.env.example:61`, so
   **prod always takes the fallback** — every response claims GARCH(1,1) while running
   EWMA(λ=0.94), which the file's own comment notes is *"mathematically flat in multi-step
   forecasts"* (all 20 horizon points share one value). `source` discloses it; `model`
   contradicts it.

**Proposed fix.** Anchor forecast dates to the last input bar; add `asOf` (last bar date) to
both payloads; make `model` reflect the estimator actually used (`'EWMA(0.94)'` on fallback)
and keep `source`. Do this **before** either route is wired to UI. **Effort: S.** **Confidence: HIGH.**

---

### AL-10 — Live/backtest admission thresholds disagree (200 vs 100 bars) — latent today
**Severity: P3** (latent — no instrument currently in the band)
**Confidence: HIGH — measured**

`/api/backtest` admits an instrument at `rows.length >= 100` (`route.ts:75,85`);
`buildLiveInstrumentSignal` returns `null` below **200** (`liveSignal.ts:57`), and
`live/route.ts:93` drops nulls with no error and no count. An instrument with 100–199 bars
would appear in backtest results and **silently vanish** from the Signals table.

Probe — this band is currently empty:

```
bands: <100: 0   100-199: 0   >=200: 56      (min bars across all 56 fixtures = 1254)
```

So this is latent, not active. Recording it because the universe is owner-editable
(`SECTORS.topHoldings`) and adding a recently-listed name would activate it silently. Note
also that `regimeSignal` itself returns `INSUFFICIENT_DATA`/HOLD below 200
(`regimeSignal.ts:96-102`) and `sma200Slope` needs 221 — so the *useful* floor is 221, above
both thresholds.

**Proposed fix.** Hoist a single `MIN_BARS_FOR_SIGNAL = 221` constant used by both routes, and
have `/api/backtest/live` report skipped instruments in the payload (mirroring
`/api/sector-rotation`'s `excludedSectors`, which is the good in-repo precedent). **Effort: S.**

---

### AL-11 — QuantLab slope indicator can render an up-arrow labelled "Declining"
**Severity: P3**
**Confidence: HIGH**

`components/stock/quantlab/tabs/TechnicalsTab.tsx:139` derives the arrow from `slopePct > 0`
but the word from `slopePositive`, which is `slope > 0.005` (`technicals.ts:137`). For any
slope in `(0, 0.005]` the UI renders **"↗ Declining"**. The 0.005 deadband is deliberate
(FIX A, noise filter) but is being rendered as a binary direction. **Proposed fix.** Drive both
from `slopePositive`, with a third "Flat" state for the deadband. **Effort: S.**

---

### AL-12 — Checked and clear (do not re-audit)
Recorded so future waves don't redo the work:

| Check | Result |
|---|---|
| `BRK.B` ticker normalization across `availableTickers()` (`-`→`.`) vs `SECTORS.topHoldings` | **Clear.** `topHoldings` uses `'BRK.B'`; `availableTickers()` maps `BRK-B.json` → `BRK.B`. Membership check succeeds; no silent drop. |
| Nightly benchmark measures the prod signal path | **Clear.** `benchmark-signals.ts:9,63` forces `QUANTAN_USE_ENHANCED_SIGNAL=0` + `productionPath: true`. Gate and prod agree. |
| Live path feeds `resolveBacktestSignal` the same inputs as the label path | **Clear.** Both use `rowsToSignalInputs` (`benchmarkLabel.ts:34-46`); live passes the full array, label passes `rows.slice(0, i+1)` — identical at the last bar. |
| Zone boundaries / slope threshold between `regimeSignal` and `ma200Regime` | **Clear** (both use the F-6 SSOT `sma200DeviationPct` / `sma200Slope`, same 0.005). Only `dipSignal` diverges — that is AL-5. |
| NaN propagation from `rsiArray`/`macdArray`/`atrArray`/`bollingerArray` last element | **Clear.** All four pre-fill `NaN` and gate on length; `liveSignal.ts:106-110` converts non-finite → `null`, and `regimeSignal.ts:146` (`rsi14 != null && rsi14 < 35`) is NaN-safe (false ⇒ conf 75). Degenerate warmup yields blank cells, not wrong actions. |
| `lastDate` timezone handling | **Clear.** Yahoo daily bars are stamped at the open (13:30 UTC = 09:30 ET); `.toISOString().split('T')[0]` (`liveSignal.ts:79-82`) yields the correct session date, and stays correct across US DST since the stamp never crosses midnight UTC. |
| `multiTimeframe`, `volumeProfile` | **Not on the prod live path** — sole call sites are inside `enhancedCombinedSignal` (`signals.ts:128,131`), which is OFF in prod. Do not audit as live-path code. |

---

## 3. RECOMPUTE CADENCE — current vs proposed

| Surface | Current trigger | Effective data age | Proposed |
|---|---|---|---|
| Signals (`/api/backtest/live`) | per-request, 60 s memo over fixture | **0–5 sessions** | daily post-close refresh (`0 22 * * 1-5`) + completed-session live overlay; emit `dataAsOf` + `dataAgeSessions` |
| Backtest (`/api/backtest`) | per-request, 1 h memo over fixture | 0–5 sessions | daily refresh inherits; add `dataWindow` + `holdDays` + `winRateBasis` (AL-8) |
| Fixture regeneration | GH Actions `0 22 * * 0` (weekly, Sunday) | — | `0 22 * * 1-5`; **add freshness assertion so a no-op fetch fails red** (AL-6) |
| MA-deviation | per-request, 5 min memo, live Yahoo | intraday | keep — already the model the others should follow |
| Sector rotation | per-request, `s-maxage=3600`, live Yahoo | ≤1 h | keep; add `asOf` = last bar date |
| Analytics | per-request, `s-maxage=300`, live Yahoo | ≤5 min | keep |
| Regime / conditional-vol | per-request over fixture; `s-maxage` 1 h / **24 h** | 0–5 sessions **+ 24 h** | fix `asOf`/`model` before wiring to UI (AL-9); drop the 24 h cache to 1 h |

**Determinism / failure modes for the proposed live overlay (AL-1 step 2).** Overlay only
*completed* sessions, so a given (instrument, session) always produces one answer — the signal
stays reproducible and comparable to the benchmark. If the live fetch fails, fall back to the
fixture spine and mark `overlayApplied: false` rather than erroring: the page degrades to
today's behaviour with honest disclosure instead of going blank. One batched quote call for 56
symbols keeps the request well inside the 300 s ceiling and needs no Redis (the existing
module-level memo is sufficient at 60 s), so this ships **before** the owner-gated Redis
provisioning.

---

## 4. TOP 10 BY YIELD

Ranked by (harm removed × confidence) ÷ effort. Severity in brackets.

| # | Finding | Sev | Effort | Why it ranks here |
|---|---|---|---|---|
| 1 | **AL-4** — `ma200Regime` asserts "DECLINING 200-day SMA" from a null slope; `/api/ma-deviation`'s 310-day window yields 214 bars vs the 221 required | P0 | S | The only true math P0, and its reach is **unconditional**: every row of a live board, every request, today. Fix is 3 small edits (null arm + gate 220→221 + window 310→400). Highest harm removed per byte. |
| 2 | **AL-2** — delete "Live data refreshes every 60s"; emit `dataAsOf` + `dataAgeSessions` | P0 | S | Removes an active false statement on the trading surface. One clause + two payload fields. |
| 3 | **AL-6** — freshness assertion in `refresh-data.yml` | P1 | S | Today a silently-failed refresh is a green check. Without this, every other freshness fix can rot undetected. |
| 4 | **AL-1 step 3** — refresh cron weekly → daily (`0 22 * * 1-5`) | P1 | S | One-line change cutting worst-case staleness 5 sessions → 1. Largest accuracy gain per byte in the wave. |
| 5 | **AL-5** — unify `dipSignal` between `regimeSignal` and `ma200Regime` | P1 | M | Two pages give contradictory trading labels for the same instrument on the same day. Subsumes AL-4 if done by delegation. |
| 6 | **AL-3** — `changePct` mislabelled as a daily move | P1 | S | Mislabelled, not merely stale. Cheap: rename column + date qualifier. |
| 7 | **AL-1 step 2** — completed-session live overlay via one batched quote | P1 | M | The structural fix. Needs no Redis, fits the 300 s ceiling. Ship *after* 3+4 so freshness is observable first. |
| 8 | **AL-7** — surface `signalReason`; stop implying MACD/ATR/BB drive the action | P2 | S | The string is already computed and deliberately stripped. Near-free honesty gain; also drops a dead `detectRegime` per instrument. |
| 9 | **AL-8** — `dataWindow` / `holdDays` / `winRateBasis` on backtest payload | P2 | S | Directly guards the register's own "never compare engine WR to label WR" rule at the API boundary. |
| 10 | **AL-9** — anchor GARCH dates to last bar; fix `model` label | P3 | S | Cheap, and closes the trap before these orphan routes get wired to UI. |

**Sequencing note.** 1–4 are all S-effort and independent; they are one small PR that removes
the false claim, fixes the live-path math bug, makes staleness detectable, and cuts it by 5×.
5 and 7 are the M-effort structural follow-ups for wave 2.

---

## 5. DISCLOSURE SCORECARD (§5 of brief)

Every algorithmic number a trader sees should carry as-of date, lookback window, and
net/gross semantics.

| Surface | As-of | Lookback | Net/gross | Verdict |
|---|---|---|---|---|
| Signals table | partial — `lastDate` present but contradicted by "refreshes every 60s" | ✗ | n/a | **fail** (AL-2) |
| Backtest portfolio | `computedAt` = now, not data window | ✗ | ✗ | **fail** (AL-8) |
| QuantLab `ma200Regime` | ✗ | implicit (200 SMA) | n/a | **fail** — plus AL-4/AL-5 |
| MA-deviation | `computedAt` (honest — data is live) | `tradingDays` present ✓ | n/a | **fail** — disclosure is fine, but the 214-bar window silently nulls the slope and triggers AL-4 on every row |
| Sector rotation | `fetchedAt` ✓ + `excludedSectors` ✓ + `note` ✓ | in `note` ✓ | n/a | **pass — the model to copy** |
| Analytics | `fetchedAt` ✓, `historyDays` ✓, `note` on beta ✓ | ✓ | n/a | **pass** |
| Regime / conditional-vol | ✗ (none at all) | ✗ | n/a | **fail** (AL-9, orphan) |

`/api/sector-rotation` and `/api/analytics` already do this correctly — `fetchedAt`,
`historyDays`/`excludedSectors`, and a plain-language `note` on methodology. **The fix for the
failing surfaces is to copy the shape that already exists in this repo**, not to invent one.

---

*End of report. Read-only review — no source files modified, no commits made.*
