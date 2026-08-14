# TRIAGE — Wave 1 (phase J) — coordinator verdicts

Status: PARTIAL — algorithms-live.md triaged; ux-interface.md + data-api.md pending (agents running).
Every elevated finding below was independently source-verified by the coordinator before entering
the fix queue (standing rule; agents have produced false-positive P0s in prior fleets).

## algorithms-live.md — verified verdicts

| ID | Sev | Coordinator verdict | Verification evidence |
|---|---|---|---|
| AL-4 | P0 | **CONFIRMED** | `app/api/ma-deviation/route.ts:39` fetches 310 calendar days (its own comment says "~220 trading days"); `lib/quant/indicators.ts:72` requires ≥221 → `sma200Slope` null on every row. `lib/quant/technicals.ts` DEEP_DIP/BEAR_ALERT/CRASH_ZONE branches use `if (slopePositive === true) … else FALLING_KNIFE` — null falls into FALLING_KNIFE with high-conviction 2008-analog copy. (FIRST_DIP branch ~L222-230 DOES have a null arm — the deeper zones don't.) Fail-closed precedent exists in `lib/backtest/regimeSignal.ts` (Q05-1). |
| AL-2 | P0 | **CONFIRMED** | `components/backtest/LiveSignalsPanel.tsx:211` renders "Live data refreshes every 60s" — but inputs are committed fixtures (`scripts/backtestData/*.json`). |
| AL-1 | P1 | **CONFIRMED** | Fixtures refresh via `.github/workflows/refresh-data.yml` cron `0 22 * * 0` (Sunday, not Saturday as older records said); `vercel.json` has NO crons key; AAPL fixture last bar = epoch 1786109400 = 2026-08-07 → 5 completed sessions stale on 2026-08-15. |
| AL-5 | P1 | ACCEPTED on agent probe (dipSignal divergence regimeSignal vs ma200Regime on identical input) — root cause is the same unported FIX D/null-arm; fixing AL-4 must include a parity assertion. |
| AL-3/6/7 | P1 | Accepted per report probes; re-verify in AUDIT phase diff review. |
| AL-8..AL-11 | P2/P3 | Queue behind P0/P1; orphan routes (/api/regime, /api/conditional-vol) correctly downgraded by agent — decide wire-up vs removal as a wave-2 design item. |
| AL-12 | — | Cleared list (BRK.B, benchmark forces prod signal path, NaN-safe warmup, lastDate tz, multiTimeframe dead on prod path) — recorded so no wave redoes these. |

## data-api.md — verified verdicts

| ID | Sev | Coordinator verdict | Verification evidence |
|---|---|---|---|
| DQ-1 | P0 | **CONFIRMED, fix design constrained** | `hooks/useLiveQuotes.ts:184` (`if (data.marketOpen) setMarketOpen(true)`) + `:194` (`if (data.open === true) setMarketOpen(true)`) — one-way latch; comment at :195-197 documents INTENDED semantics "aggregate = ANY ticker is live" (24/7 crypto/futures), but nothing ever sets false, so `app/page.tsx:278-281` MARKET CLOSED branch is unreachable after any open tick. **Fix must be a per-symbol open map + derived any() aggregate — do NOT copy `useLiveQuote.ts:178`'s blind overwrite (would break the multi-asset intent).** |
| DQ-8 | P0 | **CONFIRMED** | `app/api/search/route.ts:126` `yahooFinance.search(q, {newsCount:0, quotesCount:limit})` — no `validateResult:false`; `git show --stat 72f42fc` = only the 4 news callers; prod probe `/api/search?q=bank` → `{"quotes":[]}` while guarded briefs return live headlines. Same failure class as the 3-month B-2 outage. |
| DQ-7 | P0 | **CONFIRMED** (= AL-1/AL-2 corroborated independently by prod probe: `computedAt` now vs `lastDate` 2026-08-07). Single fix serves both reports. |
| DQ-2..6,9,10 | P1 | Accepted per report probes (changePct normalized on /api/prices vs raw on /api/stream is the one to fold into E2; holiday calendar = M effort, wave 2); re-verify each in AUDIT diff review. |
| DQ-17 | — | Clean record (7 areas verified healthy) — keep, prevents re-derivation. |

**Cadence deploy consequence (OWNER decision, not agent-executable):** `refresh-data.yml` pushes to
main and main auto-deploys → weekly→daily refresh = 5 prod deploys/week from a data cron. Options:
accept, or move fixture state out of git (warehouse). Park as OWNER-DECISION-CADENCE; wave 1 ships
the safe part only if owner signals (schedule change is one line but multiplies deploys).

## Edit-wave assignment draft (pending UX report for final disjoint cut)

**E1 — signal honesty (S, files: app/api/ma-deviation/route.ts, lib/quant/technicals.ts,
components/backtest/LiveSignalsPanel.tsx, .github/workflows/refresh-data.yml, tests):**
AL-4 + AL-5: widen ma-deviation fetch window (310→≥340 calendar days so ≥221 bars) AND port the
null-slope fail-closed arm to the deep zones of `technicals.ts` ma200Regime (+ parity test vs
regimeSignal semantics); AL-2/DQ-7: replace the false "refreshes every 60s" copy with truthful
as-of + cadence; make silent refresh failure loud (exits 0 green today). Cron cadence change
itself → OWNER-DECISION-CADENCE (deploy multiplication).

**E2 — live-data truth (S, files: hooks/useLiveQuotes.ts, app/api/search/route.ts,
lib normalization for changePct, tests):** DQ-1 per-symbol open map + derived any() aggregate
(preserve multi-asset semantics — do NOT blind-overwrite); DQ-8 `validateResult:false` on the
search route (mirror 72f42fc pattern); DQ-2 changePct unit parity between /api/prices and
/api/stream (normalize at the stream source, add cross-route parity test).

E1/E2 file sets are disjoint → can run as two parallel Opus coders in isolated worktrees,
cherry-picked onto the integration branch. E3 (UX) cut after ux-interface.md lands.

## E1/E2 AUDIT RESULT (2026-08-15): LANDED

8 commits cherry-picked onto `claude/investment-platform-overhaul-cc514b` (4f8908d..67ed3ca).
Coordinator re-reviewed every source diff; both agents implemented to spec. Integration gates:
tsc clean; vitest **1449 passed / 17 skipped** (baseline 1395). Notable audit confirmations:
server emits `market_state{open:false}` on transition (stream/route.ts:240) and stops quote
polling when closed (:242) — the DQ-1 fold is sound; E1's copy deviation (dropping "60s"
entirely — the panel fetches once on mount, no interval) verified correct and accepted;
E1 chose WATCH_DIP for null-slope deep zones = regimeSignal parity (AL-5) — accepted.

**Residuals queued for wave 2 (from agent follow-up notes, none user-harmful now):**
- `lib/quant/buildFundamentalsPayload.ts:350` gate `>= 220` should be `>= 221` (one-bar-early
  slope gate; harm neutralized by the fail-closed arm). Touches a mutation-hardened file —
  do inside a mutation-aware change.
- `app/api/stream/[ticker]/route.ts:68` same raw `changePct` pattern (no same-surface
  divergence today; unit bug latent).
- `lib/data/bloomberg/bridgeClient.ts:119-124` same class, dormant until bridge configured.
- `vitest.config.ts` coverage exclude for `hooks/useLiveQuotes.ts` now removable (harness
  exists) — moves global coverage numbers, do deliberately.
- `LiveSignalsPanel` copy hardcodes "Sun 22:00 UTC" — must change with OWNER-DECISION-CADENCE.
- DQ-2 (dropped `degraded` flag) — unassigned, wave 2.

## ux-interface.md — verified verdicts

| ID | Sev | Coordinator verdict | Verification evidence |
|---|---|---|---|
| UX-26 | P0 | **CONFIRMED LIVE** | Prod probe: `/briefs` renders "No briefs available. All Yahoo Finance requests failed." under the hardcoded "Live data from Yahoo Finance" pill while `/api/briefs/technology` returns 200/3366B to an external client; `/briefs/sector/technology` shows an error digest. Two bugs: SSR self-fetch (list) + unknown throw (detail, digest 2384324333 — Vercel logs unreadable from here; E3 reproduces locally). |
| UX-27 | P0 | **CONFIRMED** | `components/risk/TailRiskBanner.tsx:8,11` hardcodes `realizedSkew: -0.6`, `portfolioVegaUsd: -600_000` rendered as personalized trade advice with zero on-screen disclosure ("Demo" exists only in a comment); `/risk/scenarios` has the correct disclosure pattern to copy. |
| UX-6 | P0 | **CONFIRMED** | `components/DarkPoolPanel.tsx:236` gates the ILLUSTRATIVE badge on `!hasRealData`, but `prints` are ALWAYS synthetic (lib/mockData.ts mulberry32) — badge vanishes exactly when real metrics load; agent verified live: AAPL fake prints ≈$100 vs $305.40 real price under "Source: Yahoo Finance". Vestigial `(hasRealData \|\| true)` at :206. |
| UX-7 | P0 | **CONFIRMED** | `hooks/useKLineChart.ts:563-571` ResizeObserver only does `applyOptions({width})`; `fitContent()` runs only at init (:491/:521/:552) → series compressed into 5-15% of pane (agent pixel-measured 84.7-94.2% dead space; manual resize repairs live). Fix = re-fit/preserve range on resize. |
| UX-8 | P0 | **CONFIRMED** | `components/KLineChart.tsx:269-275`: legend `chgPct = (close-open)/open` of latest candle (body), `isUp = close>=open` — contradicts header session change (vs prevClose) on the same screen, 3 pages. |
| UX-14/22/37 | P1 | Spot-confirmed plausible (cost-copy contradiction; "DAILY+ BARS" label on 1m; crosshair OHLCV readout written but conditionally dead vs an on-page promise). E3 verifies in place. |
| UX-1..39 rest | P1-P3 | Queued; not re-verified individually — E3 agents re-verify before touching. |
| UX clean list | — | Quant Lab NaN-free + best lineage disclosure; indicator aria-pressed correct; no mobile horizontal overflow; sector→stock nav no dead ends. Recorded to prevent re-derivation. |

## E3a/E3b AUDIT RESULT (2026-08-15): LANDED on `claude/platform-excellence-e3` → PR #143

All 8 UX fixes audited + integrated; tsc clean; vitest **1539/17** (from 1449 post-#142).
Coordinator inline work: UX-22 page wiring (E3a's deliberate handoff — its file-set discipline
held) and the #142↔E3b merge hazard (search scan test extended to lib/, ≥5 floor kept).
Notable: E3a PROVED the review's prescribed UX-22 fix wrong (poll-eligibility ≠ bar
granularity; 1D/1W trap) and built `isIntradayBarRange`/`chartBarKindLabel` instead. E3b
ROOT-CAUSED UX-26b as a missing `await` (`return res.json()` escaping the try/catch on 2xx
non-JSON bodies), reproduced on a prod build with the exact error class — correcting the
review's "cannot be the self-fetch" attribution. E3a disclosed reconstructing
useKLineChart.ts after an accidental checkout-discard; coordinator line-audited the diff.

**Named-not-fixed (conscious-decision items → wave 2):**
- `/briefs` (force-dynamic) now fans out ~88 uncapped in-process Yahoo calls per view (the
  old self-fetch path was incidentally rate-limit-capped). Wave-2: server-side memo/cache
  with as-of stamp — folds into OWNER-DECISION-CADENCE data-architecture work.
- briefs `error.tsx` still renders `{error.message}` (digest boilerplate in prod); unknown
  sector slugs return 200 not 404.
- E3a residuals: dead `range?` prop on KLineChart (input for UX-38 timeVisible); `4H` maps
  to 1h bars with no aggregation (route); `lib/chartYahoo.ts` outside coverage+stryker globs.

## Killed / not entering queue
(none — all elevated findings survived verification in wave 1; a first for this repo's fleets.
Two review *mechanisms* were corrected by implementers with proof: UX-22's prescribed fix,
UX-26b's attribution — both recorded above.)
