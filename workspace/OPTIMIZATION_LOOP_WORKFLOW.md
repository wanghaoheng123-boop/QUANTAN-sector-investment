# Optimization Loop Workflow — QUANTAN Canonical Benchmark

> **Owner mandate:** ≥100 iterations per batch; canonical WR floor **55%**; baseline **57.26%** (`npm run benchmark`).  
> **Hard rule:** Do not promote enhanced-only configs below floor (Q-009).  
> **Worktree:** `.claude/worktrees/competent-wu-a84629` @ `chore/expert-team-program`

---

## Specialist personas (simulated each iteration)

| Persona | Responsibility |
|---------|----------------|
| **Quant/Math** | Grid sweeps on slope, RSI, dip zone, hold period; justify with aggregate WR delta |
| **Code/Architecture** | `lib/optimize/canonicalBenchmark.ts` SSOT; thin `scripts/optimize-batch.ts` driver |
| **Physics/Risk** | Vol-sensitive thresholds, hold horizon, falling-knife exits |
| **Verifier** | Every 10 iterations: `npm run test`; on promotion: `npm run benchmark` |
| **Data integrity** | Split-adjusted Yahoo candles in `scripts/backtestData/`; next-bar entry, no lookahead |

---

## Iteration schema

```
hypothesis → param vector → evaluate (in-memory canonical) → log JSON → accept/reject
```

1. **Hypothesis** — one-line change (e.g. "relax dipUpper to -1% for more dip entries").
2. **Param change** — `CanonicalSignalParams` in `lib/optimize/canonicalBenchmark.ts`.
3. **Benchmark** — `evaluateCanonicalBenchmark()` (mirrors `benchmark-signals.mjs`).
4. **Enhanced** (optional) — `npm run benchmark:enhanced` only when promoting sector-gate code paths.
5. **Accept/reject** — see promotion criteria below.
6. **Log** — `workspace/optimization-runs/iter-NNN.json`.

---

## Commands

```bash
cd .claude/worktrees/competent-wu-a84629

# Baseline
npm run benchmark              # canonical — production gate
npm run benchmark:enhanced     # enhanced path — informational only

# Batch loop (default 120 iterations)
npx tsx --tsconfig tsconfig.json scripts/optimize-batch.ts

# Resume from iteration 101
npx tsx --tsconfig tsconfig.json scripts/optimize-batch.ts --from 101 --count 50

# Evaluate only (no file promotion)
npx tsx --tsconfig tsconfig.json scripts/optimize-batch.ts --no-promote

# Full grid (slow — per-instrument OOS)
npm run optimize:grid
```

---

## Logging format (`iter-NNN.json`)

```json
{
  "iteration": 42,
  "timestamp": "ISO-8601",
  "hypothesis": "...",
  "persona": "Quant/Math",
  "params": { "slopeThreshold": 0.005, "...": "..." },
  "metrics": {
    "canonicalWinRatePct": 57.26,
    "totalBuySignals": 1392,
    "deltaVsBaselinePct": 0.0
  },
  "decision": "ACCEPT|REJECT",
  "reason": "..."
}
```

**Best snapshot:** `workspace/optimization-runs/BEST_CONFIG.json`

---

## Promotion criteria

| Condition | Action |
|-----------|--------|
| Canonical WR **>** baseline AND WR **≥ 55%** | **ACCEPT** — update `benchmark-signals.mjs` if `--promote` (default) |
| Same WR, **fewer** BUY signals (same quality, less noise) | **ACCEPT** tie-break |
| WR < 55% OR WR < baseline | **REJECT** — no code change |
| Enhanced WR up but canonical down | **REJECT** (Q-009) |

**Rollback:** If post-promotion `npm run benchmark` < 55%, revert `benchmark-signals.mjs` from git and restore `DEFAULT_CANONICAL_PARAMS`.

---

## Checkpoint cadence

- Every **10** iterations: `npm run test` + update `workspace/SESSION_STATE.json` → `checkpoint.optimization_batch`
- Every **100** iterations: full `npm run test` + canonical + enhanced benchmarks

---

## Phase 8 scripts map

| Script | Purpose |
|--------|---------|
| `scripts/benchmark-signals.mjs` | Canonical production benchmark |
| `scripts/benchmark-enhanced.ts` | Enhanced signal + `getProfileForTicker` |
| `scripts/optimize-batch.ts` | Fast ≥100-iter canonical search |
| `scripts/optimize-grid.ts` | Walk-forward 70/30 per ticker (Loop 1/2) |
| `lib/optimize/gridSearch.ts` | OOS Sharpe objective (do not ship low-OOS winners) |

---

## Resume batch N+1

```bash
LAST=$(ls workspace/optimization-runs/iter-*.json | sort | tail -1 | grep -o '[0-9]\+')
NEXT=$((10#$LAST + 1))
npx tsx --tsconfig tsconfig.json scripts/optimize-batch.ts --from $NEXT --count 100
```

---

*Last updated: 2026-05-26 — batch engine `scripts/optimize-batch.ts`*
