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

## Killed / not entering queue
(none yet from AL; UX/DQ pending)
