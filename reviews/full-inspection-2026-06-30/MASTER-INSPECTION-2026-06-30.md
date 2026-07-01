# MASTER INSPECTION — 2026-06-30 (supervised full code + algorithm review)

**Owner directive:** full run-through inspection of the whole code and algorithms, with a
supervisor overseeing the agents to ensure ethics, truth, accuracy.
**Mode:** READ-ONLY. No source modified. Baseline: `main @ 2f2507a`.
**Structure:** 3 parallel read-only review agents (Quant, API/Security, Frontend) + coordinator
inline (Python/Data, testing cluster, gates). Coordinator = **supervisor**: every elevated
finding source-verified against current bytes; agent verdicts ratified, not trusted. Charter:
`SUPERVISOR-CHARTER.md`. Per-domain detail: `quant-algorithms.md`, `api-security.md`,
`frontend-quality.md`, `coordinator-python-testing.md`.

---

## 0. BOTTOM LINE — GO / live path is SOUND

The production path is healthy: **no P0/P1 regression**, all gates green, security posture intact,
**no new look-ahead bias**, and the 5 most recent prod fixes (#72–#78) are confirmed present in
current bytes. The single genuinely-new substantive finding is an **ethics/disclosure gap**
(survivorship, NEW-Q-1). The largest deliverable is an **accuracy correction to the findings
ledger**: a phantom CRITICAL + three HIGH testing findings, and two stale HIGH rows, were retired
against hard evidence. Everything actionable is owner-gated (changes a published number, or is a
methodology/infra/disclosure decision) — consistent with the standing prep-then-authorize rule.

## 1. GATES — the fresh "truth in the numbers" (all PASS)

| Gate | Result | Verdict |
|------|--------|---------|
| Benchmark WR (production SSOT path) | net **55.89%** / gross 56.91% (56 instruments, 3444 signals) | **PASS** — floor 53.29; +1.55pp vs the 54.34 recorded 2026-06-03 (weekly data refresh, not a logic change) |
| OOS validation | IS/OOS gap **6.19pp**, OOS WR 61.92%, no >10pp collapse | **PASS** — no overfit collapse |
| tsc --noEmit | clean | PASS |
| pytest | 127 passed / 1 skipped | PASS |
| npm audit (--omit=dev) | 14 vulns (5 high, **0 critical**) | known build-chain/PWA advisory (V-8), owner-deferred; not runtime-exploitable |

## 2. ETHICS / TRUTH IN THE ALGORITHMS (the owner's core ask)

| Integrity question | Verdict | Evidence |
|---|---|---|
| **Look-ahead bias** | **CLEAN (coordinator source-verified, not relayed)** | Independently confirmed in `core.ts`: loop `for(i=200; i<rows.length-1; i++)` (`:238`); signal computed on `close[i]` via `lookbackCloses.slice(0,i+1)` (`:336-338`); BUY fills at `nextOpen = rows[i+1].open` (`:344`), exits also at `nextOpen` ("cannot transact at a close you have only just observed", `:330-332`); ATR-at-entry reads `atrVals[i-1]` explicitly ("signal bar's own TR not yet closed", `:377-379`); stops intraday via `evaluateStopHit`. #72–#78 touched only frontend/API — zero new look-ahead in the quant layer. |
| **Gross-vs-net WR honesty** | **HONEST (computation)** | `benchmarkLabel.ts:164-165` computes gross `winRate` and `netWinRate` distinctly; published 55.89 net / 56.91 gross are labeled correctly at the computation layer. (UI-copy labeling = owner item F-4.) |
| **Annualization** | **One live miss** | 252/365 correct in core/walkForward/aggregate **except Q25-1**: BTC EWMA conditional-vol uses `sqrt(252)` (`garchClient.ts:45`), LIVE via `/api/conditional-vol/[ticker]`. MEDIUM, owner-gated (changes a displayed crypto number; not benchmark-gated). |
| **Survivorship** | **NEW-Q-1 — ethics gap (MEDIUM)** | Gated WR is computed over exactly 56 *current* S&P large-caps + BTC — zero delisted/dead names — with **no disclosure** in `SIGNAL_SSOT.md`. Survivorship inflates the WR floor. The 2026-06-04 review noted this but it was never ledgered. Owner action: disclose the survivor-set scope next to the published WR (true point-in-time constituents = a separate data project). |

## 3. SECURITY POSTURE — CONFIRMED INTACT (no regressions, no new defects)

Agent B + coordinator ratification across all 27 routes:
- **CSRF**: exhaustive — the only two mutating handlers (backtest POST, trading-agents POST) both
  enforce `validateCsrf`; cookie issued in `middleware.ts` (SameSite=Strict).
- **OWASP headers**: HSTS / X-Frame DENY / nosniff / Referrer / Permissions / CSP-Report-Only all
  present (`next.config.js`); image-proxy SSRF allowlist (no `**`).
- **Ticker whitelist / SSRF**: `TICKER_REGEX` rejects URL/path/control chars (`sanitize.ts:35`).
- **Error sanitization (CWE-209)**: `sanitizeError` confirmed on all 27 routes; prior lone bypass
  (`crypto/btc/liquidations`) remains fixed. `sanitizeError` returns `undefined` in prod → details
  always omitted.
- **Rate-limit**: atomic `SET … EX … NX` window intact (`rateLimit.ts`).
- **New route** `app/api/backtest/live/route.ts`: coordinator-ratified clean — rate-limit 60/60s,
  GET-only (no CSRF needed), strict per-token ticker validation + 100-cap, cache-poisoning guard,
  local data (no SSRF), no error-to-wire path.
- **Documented false positive RE-CONFIRMED**: `auth.ts:124` real bytes `/[\x00-\x1f\x7f]/` (control
  chars) via Python `repr` — NOT the Read-tool-rendered "/[ -]/". No bug.

## 4. SUPERVISOR ACCURACY CORRECTIONS — ledger was misrepresenting reality

These are the run's highest-value output: stale/inflated ledger rows retired against hard evidence.

| id | ledger said | **ratified verdict** | evidence |
|----|-------------|----------------------|----------|
| **F8.1** | CRITICAL "11 modules zero tests" | **STALE → RESOLVED** | 90 test files / 1007 cases; coverage gate 80/80/70/80; Stryker on quant/backtest/options |
| **F8.2** | HIGH "zero component tests" | **STALE → RESOLVED** | `__tests__/components/` = KLineChart + backtest/ + stock/ + smoke |
| **F8.3** | HIGH "no mutation testing" | **STALE → RESOLVED** | `stryker.conf.mjs` + `stryker-weekly.yml` cron |
| **F8.4** | HIGH "zero API integration tests" | **STALE → RESOLVED** | `__tests__/api/` = 13 files |
| **F8.6** | MEDIUM "thresholds not verified" | **STALE → RESOLVED** | thresholds in vitest.config + CI `coverage` job |
| **F8.7** | MEDIUM "smoke not in PR CI" | **STALE → RESOLVED** | `ci.yml` `smoke` job on push+PR |
| **F8.5** | MEDIUM "no property-based math tests" | **PARTIAL → downgrade LOW** | fuzz + invariant tests exist; generative (fast-check) genuinely absent — a real enhancement, not a defect |
| **F8.8** | LOW "space-in-path blocks vitest" | **TRUE but ENV-quirk** | the `@`-path/FUSE worker freeze; CI is the gate. INFO note, not a code defect |
| **F1.5** | HIGH "B&H ignores dividends" | **HIGH → LOW, still-real-LIVE (inert fix)** | dividend-aware code present (`core.ts:25-32`, tagged F1.5) but **no data source populates `dividend`** (fetch saves OHLCV only) → B&H still omits dividends; understates displayed B&H/alpha ~1–2%/yr, not the WR |
| **F7.2** | HIGH "error responses leak internals" | **HIGH → FIXED** | `reliability.ts:50` is a `sleep` assignment in a retry util — never formats client responses; CWE-209 control is route-level `sanitizeError` (all 27 covered); details omitted in prod |
| **F6.7 / F5.10** | open MEDIUM/LOW a11y/arch | **ADDRESSED → close** | F6.7 focus-trap is a real SSOT hook `hooks/useDialogA11y.ts` |
| **F5.9** | LOW (cited `page.tsx:665` — stale) | **still-real, RELOCATED** | moved to `LiveSignalsPanel.tsx:21` post-decomposition; update file:line |
| **F5.5 / F5.6 / F5.7 / F6.5** | MEDIUM | **downgrade LOW/quality** | materially improved; F5.5 "inline styles" are overwhelmingly data-driven, not token violations |

**Pattern:** the `F1.x / F5.x / F6.x / F7.x / F8.x` block is an early review wave (Phase 14–16 era)
that was never reconciled when later program waves did the real work. Its line citations have rotted
(`engine.ts:343`, `reliability.ts:50`, `page.tsx:665` all point at moved/renamed code) and its
severities are inflated. **Recommend a one-time ledger reconciliation pass** applying the verdicts above.

## 5. NEW / NEWLY-LEDGERED FINDINGS (all verified; none P0/P1-live)

| id | sev | file:line | live? | one-line |
|----|-----|-----------|-------|----------|
| **NEW-Q-1** | MEDIUM (ethics) | `lib/backtest/SIGNAL_SSOT.md` + benchmark universe | LIVE (published WR) | survivorship scope (56 current names, no delisted) undisclosed — **known since 2026-06-04 but never assigned a ledger id**; disclose next to the WR |
| NEW-C-1 | LOW (a11y) | `app/backtest/page.tsx:260-269` | LIVE | tab bar lacks `role="tab"`/`aria-selected` (sibling `BtcTabBar` does it right) |
| NEW-C-2 | LOW (a11y) | `components/crypto/BtcChartPanel.tsx:118-131` | LIVE | indicator-preset buttons lack `aria-pressed` |
| NEW-C-4 | LOW (defense-in-depth) | `app/stock/[ticker]/page.tsx:138-152` | LIVE | unguarded boot `fetchQuote` — React-19-benign no-op; every sibling fetch is guarded |
| NEW-C-3 | INFO | `app/crypto/btc/page.tsx` | LIVE | redundant-but-safe double `CryptoChartBoundary` nesting — not a defect |
| NEW-Q-2 | INFO | `quant_framework/garch.py:44` | DORMANT | shares the `sqrt(252)` hardcode; no sidecar route → no live impact |

## 6. STILL-OPEN OWNER-GATED BACKLOG (unchanged — re-confirmed LIVE/DORMANT)

- **Q25-1** MEDIUM (LIVE) — BTC vol `sqrt(252)` → should be 365; changes a displayed crypto number, not benchmark-gated.
- **F-4** — gross→net WR UI copy re-baseline (changes a published number).
- **F-2** MEDIUM (LIVE, latent on uniform data) — alpha computed over mismatched windows (`engine.ts:188-189`).
- **F-9** LOW (LIVE) — entry double-counts 2bps slippage (~13 vs 11 SSOT; `core.ts:344` vs `executionModel.ts:16-19`).
- **Q05-1** LOW (LIVE — note: `regimeSignal` IS the prod path per `signals.ts:331-335`, not dormant) — slope-null FALLING_KNIFE.
- **A6-1** MEDIUM (DORMANT) — **CSP-flip LANDMINE: do NOT set `QUANTAN_CSP_ENFORCE=1`** until the
  nonce path is completed (zero `x-nonce` consumers; would block Next inline scripts).
- **F-PY-04/05** MEDIUM (DORMANT, offline) — factor-mining no-op / can't boot: complete-or-retire.
- **F-11 / F-3 / Q09-1 / Q13-1 / Q14-1** — confirmed DORMANT (dev/research, off the `/api` path).
- **V-8** — `npm audit` build-chain advisories (5 high, 0 critical).
- **scheduled-task → Opus 4.8** — root cause of the daily autonomous-program stall (owner UI action; no file to edit).

## 7. SUPERVISOR METHODOLOGY NOTE (for the record)

The supervisor+agent split earned its keep on **F1.5**: the coordinator found the fix *present and
tagged* and called it FIXED; Agent A found the fix *inert* (data never carries `dividend`). Neither
was complete alone — the ratified verdict is the union (implemented-but-inert → LOW-live). Lesson
reinforced: a tagged, present code path is not proof of a fixed *effect* — trace the data to the
boundary. Two agent claims were independently re-verified by the coordinator (new `backtest/live`
route clean; NEW-C-1 a11y); the `auth.ts:124` Read-render false positive was re-confirmed via
`repr`. Crucially, the **look-ahead ALL-CLEAR** (§2 — the owner's #1 ethics question and the report's
headline) was NOT left as a relayed agent summary: the coordinator independently read the `core.ts`
signal/fill loop and confirmed every guard (`close[i]` signal → `open[i+1]` fill → `atrVals[i-1]` at
entry). **An all-clear on a trading product is as elevated as a P0 — it is source-verified, not
trusted.** No agent P0/P1 — and no load-bearing all-clear — was published without source-verification.
