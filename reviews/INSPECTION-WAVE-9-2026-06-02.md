# Inspection Wave 9 — Stub promotion review (2026-06-02)

## Promotions completed (handover)

| Module | Before | After |
|--------|--------|-------|
| `lib/portfolio/factorAttribution.ts` | Naive univariate proxy | **Multivariate OLS** + real R² |
| `lib/backtest/core.ts` | N/A | Extracted from engine (D1-1) |

## Remaining stubs (deferred)

| Module | State | Next |
|--------|-------|------|
| `quant_framework/garch.py` | EWMA fallback; optional `arch` import added | Install `arch` in ml sidecar for MLE |
| `quant_framework/regime_hmm.py` | Vol-ratio classifier | `hmmlearn` when deps approved |
| `lib/scenarios/engine.ts` | Linear delta | Taylor expansion — Phase 16 S4 |

## Tests

`__tests__/portfolio/factorAttribution.test.ts` updated for multivariate OLS.

**Status:** Partial promotion — factor attribution upgraded; Python quant stubs documented.
