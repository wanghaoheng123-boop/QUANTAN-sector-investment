# Review Agent A — QUANT / ALGORITHMS — Verification Pass 2026-06-30

Baseline: main @ 2f2507a. READ-ONLY. Findings PROPOSED for supervisor ratification.
Scope: lib/backtest/, lib/quant/, lib/optimize/, quant_framework/garch.py.
LIVE path = resolveBacktestSignal (SSOT) -> app/api/backtest, app/api/analytics, app/api/sector-rotation.
Enhanced/macro-gate/sectorGates stack = OFF in prod (featureFlags.ts) = DORMANT.

Legend per item: id -> VERDICT (still-real-LIVE | still-real-DORMANT | stale-superseded | misclassified-severity) + confirmed file:line.

---

## KNOWN ITEMS — VERDICTS (source-verified vs current bytes)

NOTE ON LINE DRIFT: engine.ts was split — the single-instrument loop moved to **core.ts**
(engine.ts header lines 1-4). The ledger's engine.ts:186/343/633 line refs are OLD; the
live code is now in core.ts. Verdicts below cite the CURRENT file:line.

### F1.5 — HIGH — "B&H ignores dividends" (PRIORITY: supervisor suspected stale)
VERDICT: **STALE / SUPERSEDED — FIXED in code.** The ledger row even reads "B&H ignores
dividends" but the CURRENT `computeBuyAndHoldReturn` (core.ts:25-37) is dividend-aware:
line 25 doc "Total-return buy-and-hold including optional per-bar dividends (F1.5)"; lines
32-34 accrue `shares += div / close` per dividend bar; `OhlcvRow.dividend?` field added
(core.ts:21-22). This is the AT-F1.5-bnh-totalreturn acceptance behaviour. The "open" HIGH
is no longer real — recommend reclassify FIXED (the dividend-total-return path is present and
LIVE via core.ts -> engine re-export). NB: Yahoo split/div-adjusted close already embeds most
dividend effect (core.ts:21 comment), so on the adjusted-close dataset the extra term is ~0 —
which is why it was low-impact, but the code DOES implement total return now. Confirmed LIVE
(computeBuyAndHoldReturn called at core.ts:422 inside backtestInstrument).

### F-2 — MEDIUM — alpha over mismatched windows (engine.ts:188-189) — owner-gated
VERDICT: **STILL-REAL-LIVE.** Confirmed at engine.ts:188-189: `bnhAvg` = mean of each
instrument's FULL-history `r.bnhReturn` (core.ts:422 over all rows), while `truePortfolioReturn`
(engine.ts:147) is the END-ALIGNED COMMON (minLen) window. alpha = truePortfolioReturn - bnhAvg
(engine.ts:189) mixes windows for unequal-length sets. LIVE via aggregatePortfolio. LATENT on
uniform 1255-bar data (common==full). Severity MEDIUM stands. Owner-gated (changes UI alpha;
no benchmark gate). No change.

### F-9 — LOW — entry double-counts 2bps slippage (core.ts) — owner-gated
VERDICT: **STILL-REAL-LIVE.** core.ts:344 `entryPrice = nextOpen*(1+ENTRY_SLIPPAGE_BPS/10000)`
(2bps) AND core.ts:365 `txCost = costBasis*TX_COST_PCT_PER_SIDE` (11bps/side incl. a slippage
leg) → ~13bps at entry vs 11bps SSOT. Exit clean (closePosition core.ts:169 = 11bps only).
Now documented inline core.ts:359-364. LIVE, LOW, owner-gated (changes published WR). No change.

### F1.15 — LOW — oosRatio clamp hides tail overfit (walkForward.ts) — owner-gated
VERDICT: **MOSTLY-SUPERSEDED.** computeOosRatio (walkForward.ts:51-53) STILL clamps the
DISPLAY value to [-1,2], but now ALSO returns `raw` and WFWWindow carries `oosRatioRaw`
(walkForward.ts:35, populated :191/:202). The unclamped metric truth is exposed. Residual is
only that the averaged `avgOosRatio` (walkForward.ts:219) averages the CLAMPED field, not raw.
LOW, data-viz. Recommend downgrade to near-resolved. LIVE (walk-forward UI).

### F1.22 — MEDIUM — atrAdaptiveStop includes still-forming entry bar (exitRules.ts) — owner-gated
VERDICT: **STALE / SUPERSEDED — FIXED.** exitRules.ts:85-87 now `bars.slice(0, -1)` excludes
the still-forming entry bar ("F1.22: exclude the still-forming entry bar — ATR uses only
completed bars"). The look-ahead micro-bias is gone. NB exitRules.atrAdaptiveStop is DORMANT
anyway (used by portfolioBacktest.ts, a dev script — confirming callers next). Recommend FIXED.

### F1.23 — LOW — DEFAULT_EXIT_CONFIG magic numbers uncited (exitRules.ts:33-40)
VERDICT: **STILL-REAL-DORMANT.** exitRules.ts:33-40 DEFAULT_EXIT_CONFIG still has no citations
(maxHoldDays 20, profitTakePct 0.08, etc.). Documentation nit. DORMANT (exitRules path = dev
portfolioBacktest, not the live core.ts loop). LOW. No change.

### LIVE LOOK-AHEAD AUDIT (core.ts backtestInstrument) — CLEAN
Signal computed on rows[i].close (core.ts:241,338); ALL fills at rows[i+1].open:
BUY entry (core.ts:344), SELL exit (core.ts:399), DD-breaker exit (core.ts:332). Stops use
evaluateStopHit(rows[i],...) intraday-aware (core.ts:289/299/314). ATR-at-entry uses
atrVals[i-1] prior bar (core.ts:379). No bar's own close decides a same-bar fill. NO new
look-ahead introduced by #72-#78.

### Q05-1 — LOW — regimeSignal slope-null FALLING_KNIFE SELL (regimeSignal.ts) — owner-gated
VERDICT: **STILL-REAL-LIVE.** Confirmed: sma200Slope needs closes.length>=221 (indicators.ts:72);
priceWasNearSmaRecently needs >=220 (signalHelpers.ts:155); regimeSignal only guards <200
(regimeSignal.ts:96). For closes.length in [200,220], slope=null -> slopePos=null -> canBuyDip
false (regimeSignal.ts:141), so a dev<=-10 DEEP_DIP/BEAR_ALERT/CRASH emits FALLING_KNIFE SELL
82-95% conf (regimeSignal.ts:159/167/174) from missing-slope data — contradicts the dev==null
fail-closed intent (regimeSignal.ts:115). IMPORTANT: this is the **LIVE PRODUCTION path** —
resolveBacktestSignal takes the regime-only branch in prod (signals.ts:331-335, enhanced OFF)
so regimeSignal directly drives the live action, NOT dormant. Long-only SELL-when-flat is a
no-op (core.ts:387 SELL gated on state.openTrade); effect = spurious early exit only if already
holding in the first ~20 evaluated bars. LOW stands. Owner-gated (fix changes backtest numbers).

### Q25-1 — MEDIUM — BTC EWMA vol annualized sqrt(252) not 365 (garchClient.ts) — owner-gated
VERDICT: **STILL-REAL-LIVE.** garchClient.ts:45 `annualVol = Math.sqrt(varEwma)*Math.sqrt(252)`
— hardcoded 252, no per-asset param. EWMA fallback is what's served (garchClient.ts:81 in
fetchGarchForecast; sidecar QUANT_FRAMEWORK_URL unset -> always fallback). For BTC (365d) this
understates conditional vol by sqrt(365/252)-1 ~= 20%. Confirming the conditional-vol route
wiring next. MEDIUM stands. Owner-gated (changes a displayed crypto vol; no benchmark gate).

### F1.5 — REVISED VERDICT after effect-trace (supervisor priority)
VERDICT: **MIS-CLASSIFIED, NOT FIXED-IN-EFFECT — downgrade HIGH -> LOW, still-real-LIVE.**
The mechanism (dividend-aware computeBuyAndHoldReturn, core.ts:25-37) is PRESENT but INERT:
  - backtestData JSON rows carry ONLY {time,open,high,low,close,volume} — NO `dividend` field
    (scripts/backtestData/AAPL.json; fetchBacktestData.mjs:148-155 saves OHLCV only).
  - dataLoader.ts:76/95/117 emits rows with no `dividend` either -> OhlcvRow.dividend always
    undefined -> the `shares += div/close` accrual (core.ts:32-34) NEVER fires in the live path.
  - `close` is yahoo-finance2 chart().quotes[].close = SPLIT-adjusted, NOT dividend-adjusted
    (the dividend-adjusted `adjclose` field is fetched-but-discarded at fetchBacktestData.mjs:153).
  So B&H genuinely OMITS dividends. Effect: displayed bnhReturn / alpha / excessReturn understate
  true buy-and-hold total return by the universe's dividend yield (~1-2%/yr). LIVE (bnhReturn ->
  core.ts:422 -> BacktestResult -> /api/backtest UI; bnhAvg/alpha engine.ts:188). It does NOT touch
  the strategy WR (benchmarkLabel uses close-to-close, not B&H). NET: the "open HIGH" is NOT real at
  HIGH — it's a LOW display-honesty item (B&H benchmark is slightly conservative). Recommend
  reclassify HIGH->LOW, keep open (or owner-gate: wiring adjclose changes a displayed comparison).
  NB: the original AT-F1.5 ("B&H total return") is only half-satisfied — code path exists, data feed
  doesn't supply dividends.

### F-11 — LOW — maxHoldDays in union-calendar steps (portfolioBacktest.ts) — owner-gated
VERDICT: **STILL-REAL-DORMANT.** Confirmed exitRules.ts:252 `holdDays = currentIdx - entryIdx`
fed the union date index (portfolioBacktest passes di). portfolioBacktest is imported ONLY by
scripts/portfolio-backtest.ts (dev) — no /api route. DORMANT. LOW. No change.

### F-3 — LOW — trailing-stop peak ratchets on CLOSE only (portfolioBacktest.ts:268) — owner-gated
VERDICT: **STILL-REAL-DORMANT.** updatePosition(pos,row.close) (exitRules.ts:264-268) ratchets
highestPrice from close, not intra-bar high. Arguably deliberate (avoids whipsaw); no same-bar
look-ahead (pre-update pos passed to checkExitConditions). DORMANT (dev portfolioBacktest). LOW.

### Q09-1 — LOW — live omits sectorGates vs benchmark (liveSignal.ts) — owner-gated
VERDICT: **STILL-REAL-DORMANT.** liveSignal.ts:85-92 calls resolveBacktestSignal with 6 args (no
sectorGates) vs benchmarkLabel.ts:77 passing sectorGatesForTicker. sectorGates only bite the
enhanced path (OFF in prod, featureFlags.ts) -> live==backtest TODAY. DORMANT. LOW. No change.

### Q13-1 — LOW — dead locals in gridSearch simpleBacktestSlice (gridSearch.ts:176-217)
VERDICT: **STILL-REAL-DORMANT.** `equity` and `dailyRets` computed but not returned (return is
{winRate,trades,sharpe,avgReturn}). Dev-only optimizer, no API route. LOW cleanup. No change.

### Q14-1 — LOW — incomplete macro-gate plumbing (sectorProfiles.ts:52) — owner-gated
VERDICT: **STILL-REAL-DORMANT.** maxVixForBuy has NO signal-logic consumer (grep: only defs);
yieldCurveGate only in a portfolioBacktest comment. Inert config, enhanced path OFF. DORMANT. LOW.

### Q15-1 — LOW — bollingerLatest period<2 guard (indicators.ts)
VERDICT: **STALE / SUPERSEDED — FIXED.** indicators.ts:282 now guards
`closes.length < period || period < 2` — exactly the recommended fix. bollingerArray and
bollingerLatest now treat period<2 identically. Recommend FIXED.

### Q23-1 — LOW — relativeStrength index-based lookback not date-aligned (relativeStrength.ts)
VERDICT: **STILL-REAL-LIVE (mitigated).** Confirmed index-based lookbacks spyCloses[len-22/64/127]
and closes[len-22/64/127] (relativeStrength.ts:124-127,142-144); doc says "same date alignment
expected" (:116) but does NOT enforce via alignCloses. LIVE (sector-rotation/analytics) but
same-calendar US-equity callers mitigate. LOW. No change.

### F-9 — F-9 decomposition CONFIRMED against bytes (not comment)
executionModel.ts:16-19 DEFAULT_EXECUTION_COSTS = {spread:5, slippage:2, commission:4} = 11/side
(costBpsPerSide :23). The 2bps slippage leg IS inside the 11. So core.ts:344's separate
ENTRY_SLIPPAGE_BPS=2 price bump genuinely double-counts slippage at entry. F-9 stands as written.

---

## GENUINELY-NEW FINDINGS (fresh surface)

### NEW-Q-1 — MEDIUM/ethics — SURVIVORSHIP: published WR over a 56-name current-survivor universe, undisclosed
file: scripts/backtestData/ (56 JSON: AAPL..XOM + BTC) ; SIGNAL_SSOT.md (no scope caveat).
The gated benchmark WR (net 55.89% / gross 56.91%) is computed over exactly these 56 instruments
— all CURRENT S&P mega/large-caps + BTC, ZERO delisted/dead names (no failed tickers in the set).
A fixed current-survivor universe biases the headline WR upward (the strategy is never tested on
names that went to zero / were removed). SIGNAL_SSOT.md documents net-vs-gross + the label method
but does NOT disclose the universe is a survivor set. LIVE (this set feeds the CI gate AND
/api/backtest default sectors). NOT a code bug — an ETHICS/disclosure item: either (a) add a
"universe = 56 current large-caps, survivorship-limited" caveat next to the published WR, or
(b) widen the universe to include delisted names. Source-verified (ls + fetchBacktestData.mjs).
DISPOSITION: owner — disclosure is the cheap honest fix; recompute-on-survivor-free-universe is the
rigorous one. Flagging because the owner's core ask names survivorship explicitly.

### NEW-Q-2 — INFO — Python garch.py shares the sqrt(252) hardcode (DORMANT, same class as Q25-1)
file: quant_framework/garch.py:44,59 `ann_vol = daily_vol * np.sqrt(252.0)`.
Same crypto-annualization issue as Q25-1 but on the Python GARCH sidecar, which is DORMANT
(QUANT_FRAMEWORK_URL unset -> fetchGarchForecast always falls back to the TS EWMA; garch.py not in
the Vercel path). So even if the sidecar were wired, BTC vol would still be mis-annualized. NOT a
new live finding — record as the Python twin of Q25-1 so a future "wire the sidecar" task fixes
both. INFO/dormant.

---

## 5-LINE SUMMARY (supervisor)
1. LIVE signal/backtest path stayed HONEST on look-ahead: signal at close[i], ALL fills at
   open[i+1] (BUY/SELL/DD-breaker), stops intraday via evaluateStopHit, ATR-at-entry uses bar[i-1].
   #72-#78 touched only frontend/API — ZERO new look-ahead or SSOT drift in the quant layer.
2. GROSS-vs-NET honesty CLEAN (my scope = computation): benchmarkLabel computes winRate (gross) and
   netWinRate (net) DISTINCTLY (lines 164-165); published 55.89 net/56.91 gross labeled correctly.
3. ANNUALIZATION: equity 252 / crypto 365 correct in core.ts + walkForward + portfolio aggregate.
   ONE live miss persists: Q25-1 BTC EWMA conditional-vol uses sqrt(252) — STILL-REAL-LIVE, MEDIUM.
4. SURVIVORSHIP is the one genuinely-new ethics gap (NEW-Q-1, MEDIUM): WR published over 56 current
   survivors with no disclosure. F1.5 RE-VERDICT: HIGH is MIS-CLASSIFIED — div-total-return code is
   inert (no dividend in the data feed; close is split-only) so B&H omits dividends -> LOW display item.
5. Verdicts: FIXED/superseded = F1.5(reclassify->LOW), F1.22, Q15-1, F1.15(mostly). Still-real-LIVE =
   F-2, F-9, Q05-1, Q25-1, Q23-1. Still-real-DORMANT = F1.23, F-11, F-3, Q09-1, Q13-1, Q14-1. No P0/P1
   regression in the live path; the integrity questions (look-ahead/gross-net/annualization) hold,
   with survivorship-disclosure the only owner action the ethics mandate newly demands.
