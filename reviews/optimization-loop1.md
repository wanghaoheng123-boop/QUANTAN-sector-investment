# Optimization Loop 1 — Grid Search Results

**Source:** `scripts/optimization-results-loop1.json` (run `2026-04-29`, ~93s elapsed)  
**Script:** `npm run optimize:grid` → `scripts/optimize-grid.ts`

## Executive summary

| Metric | Value | vs production floor |
|--------|-------|---------------------|
| Aggregate OOS win rate | **25.73%** | Floor **56.35%** — do not ship |
| Avg overfit gap (IS−OOS) | −9.72 pp | Many combos overfit in-sample |
| Instruments with no valid combo | 31 / 56 | See JSON `noValidCombos` |
| Enhanced benchmark (separate) | 52.63% | Q-009 still pending user approval |

**Policy:** Loop 1 winners are **research-only** until `npm run benchmark:enhanced` ≥ 56.35% and `vsBaseline.improvement ≥ 0` (Q-009).

## Dominant parameter cluster

Most sectors converged on the same `bestGlobalParams`:

- `slopeThreshold`: 0.003  
- `buyWScoreThreshold`: 0.2  
- `confidenceThreshold`: 55  
- `atrStopMultiplier`: 1.5  

This suggests the grid’s objective (OOS Sharpe under tight overfit cap) did not differentiate sectors strongly — structural signal weakness, not missing hyperparameters.

## Sector rollups (OOS win rate)

| Sector | Avg OOS WR | Note |
|--------|------------|------|
| Utilities | 52.2% | Highest sector; still below 58% internal target |
| Consumer Staples | 48.7% | CRITICAL in JSON recommendations |
| Healthcare | 39.1% | CRITICAL |
| Technology | 14.5% | CRITICAL |
| Industrials | 10.9% | CRITICAL |

## Notable single-ticker outliers

- **META** (Communication): 62.5% OOS WR, 24 OOS trades — best individual outcome in the file.  
- Many tickers show **0% OOS WR** with 0 OOS trades (grid found no tradeable combo under constraints).

## Next steps

1. **Loop 2** (`LOOP2_GRID` in `lib/optimize/parameterSets.ts`) — sector-narrowed search; results appended to same JSON.  
2. **Do not** change `enhancedCombinedSignal()` production defaults from Loop 1 until Q-009 policy is met.  
3. Pair with intermarket / regime gates (see JSON sector `recommendation` fields) before another grid run.
