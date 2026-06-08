# Coordinator Inline Verifications — 2026-06-04

These are checks the coordinator (Claude Opus 4.8) ran directly to resolve open
hypotheses from the agent reports — pursuing the items the quant agent explicitly
flagged as "needs cross-file verification" and "could promote to P0". Read-only.

## V1 — `lib/auth.ts:124` regex → ❌ FALSE POSITIVE (api-backend.md P0-2 WITHDRAWN)
- **Claim under test:** API agent flagged `/[ -]/` rejecting all names with space/hyphen.
- **Method:** `python3 -c "print(repr(open('lib/auth.ts','rb').read()[...]))"`.
- **Result:** Real bytes are `/[\x00-\x1f\x7f]/` (OWASP control-char class). Accepts
  `"John Smith"`/`"Mary-Jane"`; rejects only control chars. This is the documented
  trap in `workspace/CURSOR_PROMPT.md` STEP 3 (Read-tool renders 0x00–0x1F as a
  deceptive space-hyphen range). **Code is correct. Not a finding.**

## V2 — quant P1-2 `getRiskFreeRateSync(365)` double-divide → ❌ DISPROVED (downgrade to P2 note)
- **Claim under test:** `portfolioBacktest.ts:582` does `getRiskFreeRateSync(365) / annualizationDays`
  — quant agent hypothesized a double-divide making rfD ~100× too small (Sharpe inflated).
- **Method:** Read `lib/quant/riskFreeRate.ts:103-110`.
- **Result:** `getRiskFreeRateSync(tenorDays = 365)` — the arg is a **tenor selector**
  (routes to a FRED series by tenor), and returns an **annualized** rate (`entry.annual`
  / `route.fallback`). So `/ annualizationDays` correctly converts annual→per-period.
  **NOT a double-divide. RFR usage is correct across portfolioBacktest.ts, core.ts,
  engine.ts.** Residual P2: the tenor arg is passed inconsistently (`365` explicit in
  portfolioBacktest; default elsewhere) but is functionally identical.

## V3 — execution cost model → ✅ CONFIRMED correct (validates Q-063 disclosure)
- **Method:** Read `lib/backtest/executionModel.ts`.
- **Result:** SSOT is clean. **11 bps/side, 22 bps round-trip** (5 spread + 2 slippage
  + 4 commission). `roundTripCostPct = 2 × perSideCostPct`; `netReturnAfterCosts`
  subtracts round-trip. Matches `engine.ts TX_COST_BPS_PER_SIDE = 11`. The "~22 bps
  round-trip" copy added in PR #42 (Q-063) is accurate.

## V4 — enhanced signal production state → ⚠️ STRATEGIC FINDING (recontextualizes quant P0-5, P1-4)
- **Method:** Read `lib/featureFlags.ts`.
- **Result:** `useEnhancedCombinedSignal()` returns **FALSE in production** by default
  (`QUANTAN_USE_ENHANCED_SIGNAL` opt-in only; `NODE_ENV==='production' → false`). The
  header comment: *"enhancedCombinedSignal underperforms the canonical benchmark
  (52.63% vs 57.05% aggregate WR)… OFF in production by default until vsBaseline >= 0."*
- **Implication:** The entire Phase-11 enhanced 7-factor signal + macro-gate stack
  (`enhancedCombinedSignal`, `yieldCurveGate`, parkinson/DXY/yield-curve gates,
  divergence/volume-climax/MA-compression bonuses) is **dormant research code in prod.**
  - Quant **P0-5** (`yieldCurveGate` never applied) → still a real dead-config issue,
    but it lives on a code path that does not run live → **downgrade to P1/P2.**
  - Quant **P1-4** (bonuses only fire with sectorGates) → same: research-path only.
  - This is a **product/strategy finding for the owner**: a large, sophisticated,
    well-tested subsystem (the headline Phase-11 work) is switched off because the
    simple baseline beats it. Not a bug — a strategic reality worth a decision
    (invest to beat baseline, or formally retire to reduce surface area).

## Net effect on severity tallies
- api-backend.md: **3 P0 → 2 P0** (P0-2 withdrawn). Remaining P0-1 (liquidations raw
  upstream error leak) and P0-3 (CSRF/rate-limit ordering) still stand pending re-read.
- quant-algorithm.md: after source verification by the coordinator (see MASTER report),
  the quant P0 candidates resolve as: factorAttribution P0-1/2/3 → **P1** (P1-K; UI discloses
  it as demo/research, solver correct); engine.ts P0-4 `aggregatePortfolio` → **P1-E,
  confirmed LIVE** via `app/api/backtest/route.ts:82`; P0-5 `yieldCurveGate` → prod-dormant
  (enhanced path off). **Net live-prod P0s across the whole platform = 2** (frontend
  BtcQuantLab hooks violation + API liquidations error leak). P1-2 RFR double-divide disproved.
