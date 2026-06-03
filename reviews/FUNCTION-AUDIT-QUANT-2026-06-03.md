# QUANTAN Quant Function Audit — Export Coverage

**Date:** 2026-06-03  
**Subagent:** `197b833e` (read-only)  
**Branch:** `fix/rectification-wave-12-2026-06-03`

---

## Executive summary

| Metric | Count |
|--------|------:|
| Exports audited | **183** |
| Test-referenced | **159** |
| Untested | **24** |
| Algorithm defects | **0** |

Benchmark net WR **54.34%** (floor 53.29%) — PASS.

---

## Untested exports (24) — Q-074

calcStochRSI, calcADX, vwapArray, vwapArrayWindow, hasPositiveClose, alignCloses, logReturns, trailingReturn, runInstrumentLabelBenchmark, tradingDaysPerYear, isGoldenCross, hasPositiveMomentum, detectBullishDivergence, detectVolumeClimax, isMACompression, priceWasNearSmaRecently, listPortfolioIds, appendClosedTrade, loadClosedTrades, marginalVaR, formatStressResults, PERP_FUNDING_MODERATE_ABS, CODEX_FRAMEWORKS, REGIME_COLORS.

---

## SSOT verified

Indicators OhlcBar SSOT, resolveBacktestSignal parity, engine T+1 entry, portfolio net costs, signalParity tests — all PASS.

*Generated from subagent `197b833e`; consolidated for PR #49.*
