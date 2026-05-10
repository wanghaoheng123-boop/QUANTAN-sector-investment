# Phase 13 — Invariants Baseline (frozen by C2 at S1 start)

**Captured:** 2026-05-04 (S1 day 0)
**Captured-by:** C2 (Algorithm Lead)
**Status:** FROZEN. Any S2/S3/S4 PR that regresses any line below 0.5pp / one tier requires C1+C2 written approval.

---

## 1. Algorithm performance (canonical benchmark)

```
$ node scripts/benchmark-signals.mjs
Loading data...
Loaded 56 instruments

=== BENCHMARK RESULTS ===
Instruments: 56
Instruments with trades: 55
Total BUY signals: 1393
Wins: 785 | Losses: 608
Aggregate Win Rate:        56.35%
Avg Win Rate per Instrument: 58.97%
Avg 20d Return per Signal:   1.2541%
```

**Floor:** 56.35% aggregate WR. **Hard regression-block** in CI: any PR that drops aggregate WR below 55.85% is auto-rejected. Drops between 55.85% and 56.35% require C2 sign-off.

## 2. Portfolio backtest (deferred — re-run in S1 day 1, captured by I4)

`npx tsx scripts/portfolio-backtest.ts` — to be captured by I4 in `inspections/I4-S1.md`.
Targets per plan: WR ≥ 60%, max DD ≤ 12%.

## 3. Test inventory

```
Total test cases: 279
Test files:        21
```

Vitest run blocked locally by space-in-path issue from worktree shell context (Vitest internal `_setServer` chokes on the URL-encoded path). I4 must run from main worktree path during S1 inspection.

**Floor:** test count never drops below 279. Coverage by module to be captured by R8 in `reviews/R8-testing.md`.

## 4. Code-quality baseline

| Metric | Current | Floor |
|--------|---------|-------|
| TODO/FIXME/HACK in `lib/`+`app/`+`components/` | 0 | 0 |
| Silent `.catch(() => {})` | 4 | 4 (S2 backlog target = 0) |
| `Math.random` in `lib/` | 0 | 0 |
| Largest component LOC | 1649 (`QuantLabPanel.tsx`) | S3 target ≤ 500 |
| Largest lib LOC | 691 (`signals.ts`) | S3 target ≤ 600 |

## 5. External invariants (cannot regress in any sprint)

- yahoo-finance2 stays primary feed (S1–S3); compliance migration documented in S4
- All macro/sector gates fail closed on missing/insufficient/non-finite data
- No secrets in code or error responses; all keys via env vars
- Single canonical `ema`/`rsi`/`macd` from `lib/quant/indicators.ts` (duplicate `ema` in `technicals.ts` was deleted in Phase 10 commit `7fc76ff`)

## 6. Reproducibility check (to add in S1 day 2)

```bash
node scripts/benchmark-signals.mjs > /tmp/run1
node scripts/benchmark-signals.mjs > /tmp/run2
diff /tmp/run1 /tmp/run2     # must be identical, modulo timestamps
```

I4 captures hash in `inspections/I4-S1.md`.

---

**Sign-off:** C2 (algorithm lead) — frozen. Any change requires written C1+C2 approval and a new baseline file with date.
