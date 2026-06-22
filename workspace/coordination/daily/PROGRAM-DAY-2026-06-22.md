# Program Day — 2026-06-22 (manual Opus-4.8 run; queue recovery)

Run context: **manual**, not the scheduled fire. The owner reported an
`API Error: 400 tools.16.model: Claude Fable 5 is not available` and asked to fix
the errors and continue. Diagnosis below. Cell run this day: **Q05**.

> NB: 2026-06-22 is a **Monday** → the program's §7 default is the weekly deep sweep.
> The owner explicitly chose to run the next pending cell (Q05) instead, so the deep
> sweep was **not** run today; it remains due.

---

## Root cause — why the program stalled since 2026-06-15

The daily scheduled task (`quantan-autonomous-program`, cron `0 9 * * *`) fired every
day 06-16 → 06-21 but produced **zero** output (no daily logs, no checkpoints, no
blockers, queue frozen at Q05). Discriminator: zero daily logs ⇒ the runs died at the
**first API request**, i.e. they fired on the **Fable 5** model, which Anthropic has
gated (fable-mythos-access) → every request 400s with `tools.16.model: Claude Fable 5
is not available`.

- **Nothing in the repo or local config pins Fable.** All `~/.claude.json` Fable
  references are the harness's own "Fable is disabled" bookkeeping; the scheduled task
  carries no model field (and `update_scheduled_task` exposes none — the harness picks
  the model at fire time).
- **This interactive run is on Opus 4.8, so it works.** Resolution everywhere = Opus 4.8.
- **The recurring fix is the owner's** (a UI action, not a file edit): keep the app's
  selected model on Opus 4.8 so the next 09:08 fire runs on Opus and resumes the queue.
  A one-off manual cell (this run) recovers a single day but does not change what model
  tomorrow's scheduled fire uses.

## Q05 — `lib/backtest/regimeSignal.ts` (WS-Q) — DONE, merged (PR #66, `ac4ce09`, prod ✓)

**Verdict: VERIFIED CLEAN (no live bug).** Line-by-line review:
- `sma200DeviationPct` / `sma200Slope` SSOT (`lib/quant/indicators.ts`) have finite/zero
  guards; `sma200Slope` requires ≥221 bars (`now`/`prev` 200-SMAs 20 bars apart).
- The `dev == null` **fail-closed** guard catches non-finite/non-positive price or broken
  SMA before any branch → HOLD/0-confidence (the documented prior fix that stopped bad
  data emitting CRASH_ZONE BUY/SELL at 78–95% confidence). Confirmed intact.
- No look-ahead — only historical `closes` slices are read; the deviation zone is driven
  by the separately-passed `price`.
- Deviation-zone thresholds (EXTREME/EXTENDED/HEALTHY_BULL ≥0; FIRST_DIP ≥−10; DEEP_DIP
  ≥−20; BEAR_ALERT ≥−30; CRASH_ZONE <−30) are internally consistent;
  `canBuyDip = slopePositive && nearSma` gates every BUY.

**Parity-safe cleanup (output byte-identical — proven by `signalParity`):**
- Removed **6 redundant `dev != null &&`** conditions: `dev` is narrowed to `number` past
  the fail-closed early return, so the checks were always-true dead code that wrongly
  implied `dev` could still be null there. Added a one-line note to prevent re-introduction.
- Fixed a wrong inline comment: `FIRST_DIP: -10% to -5%` → `-10% to 0%` (matches the code
  `dev >= -10` and the function docstring).

**Tests — closed a real coverage gap** (the prior FIRST_DIP test was a conditional that
could assert nothing): new `Regime Signal — zone boundaries & invariants` block. It uses
the fact that `regimeSignal(price, closes)` derives slope/near-SMA from `closes` but the
zone from `price`: a **flat** array (slope 0 → dips not buyable) and a **rising** array
(positive slope + near SMA → dips buyable) pin every zone deterministically, plus
cross-cutting invariants (`BUY ⇒ slopePositive`, `SELL ⟺ FALLING_KNIFE`, `confidence ∈
[0,100]`, purity). signals.test.ts 26 → **37**.

**The shipped change is SAFE** (no published-number/contract/auth/secret change → auto-merge).

**One latent finding ESCALATED (pre-existing, NOT introduced here; owner-gated → ledger `Q05-1`):**
At **201–220 bars**, `sma200Slope` returns null (it needs ≥221: a 200-SMA now and 20 bars
ago) so `slopePositive` is false, and a sub-−10% dip then emits a **confident
`FALLING_KNIFE` SELL (82–95%)** purely from *missing-slope data* — which contradicts this
file's own `dev==null` fail-closed intent. It is **reachable in the prod backtest path**:
`resolveBacktestSignal` (the non-enhanced default) is called from `core.ts:238`
`for (let i = 200; …)` with `closes.slice(0, i+1)`, i.e. 201–220 bars on each instrument's
first ~20 evaluated bars. Long-only, so a SELL-when-flat is a no-op; the real effect is
spurious early exits if a position is already held that early. **Owner-gated** because the
honest fix (treat slope-uncomputable dips as INSUFFICIENT/HOLD, extending the fail-closed
intent) changes backtest output → published numbers. Did **not** fix it in this cell.

## Verification (VERIFY A–F)
- **A typecheck:** `tsc --noEmit` clean.
- **B tests:** `signals.test.ts` 37/37; `signalParity.test.ts` 2/2 (behavior preserved).
- **C benchmark/WR:** unchanged by construction (output-parity change). Local benchmark
  froze on the Google-Drive FUSE mount → the **CI `benchmark` job (pass, 44s)** is the
  authoritative WR-floor confirmation; CI typecheck/test/coverage/smoke all pass.
- **D build/deploy:** Vercel production deploy `dpl_DRZByi3oq1T8QJsmy8RZJUFFDfop` (sha
  `ac4ce09`) → **READY**.
- **E prod smoke (quantan.vercel.app):** `/`=200 (60,713 B), `/api/sector-rotation`=200,
  `/api/analytics/AAPL`=200. **PASS** → no auto-revert.
- **F record:** this report + PROGRAM_QUEUE Q05→done + run-log + MEMORY_LOG row +
  SESSION_STATE bump.

## Q06 — `lib/backtest/executionModel.ts` (WS-Q) — DONE, merged (PR #67, `0c138fc`, prod ✓)

**Target verdict: VERIFIED CLEAN.** `executionModel.ts` is pure, correct cost math
(`spread 5 + slippage 2 + commission 4 = 11 bps/side` → 22 bps round-trip), and already
has an engine-parity test (`TX_COST_BPS_PER_SIDE === costBpsPerSide()`).

**Seeded F-9 finding CONFIRMED REAL — ESCALATED, not auto-fixed (ledger `F-9`, owner-gated):**
the double-count is in the engine, not the SSOT. In `core.ts backtestInstrument` a BUY pays
**both**:
1. a 2 bps `ENTRY_SLIPPAGE_BPS` bump baked into `entryPrice` (`core.ts:344`), and
2. `txCost = costBasis × 11 bps/side` (`core.ts:358-360`) — and 11 bps **already includes**
   a 2 bps `slippageBpsPerSide` component.

So the 2 bps open friction is **counted twice at entry** → entry ≈ **13 bps** vs the SSOT's
11 bps/side; round-trip ≈ **24 vs 22 bps**. Exit (`closePosition`, `core.ts:169`) is clean at
11 bps with no price bump (an existing comment already declines to mirror entry slippage onto
exit). The fix (reconcile to a single 2 bps source) shifts net returns / the published WR →
**owner re-baseline**, so it was left as-is.

**SAFE shipped (behavior-preserving — `signalParity` 2/2):**
- `executionModel.test.ts`: +2 tests for a custom `ExecutionCostConfig` and a zero-cost
  identity. The config-injection path was previously untested (only the default) → a
  parameterization regression would have passed silently.
- `core.ts`: a **doc-only** comment at the entry-cost site marking the F-9 double-count + the
  re-baseline caveat, so it is not silently "fixed" without a re-baseline.

### Verify (VERIFY A–F)
- **A** tsc clean. **B** executionModel 6/6 + signalParity 2/2. **C** benchmark unchanged
  (no behavior change; CI `benchmark` pass 43s). **D** Vercel prod deploy READY (`0c138fc`).
  **E** prod smoke `/`,`/api/sector-rotation`,`/api/analytics/AAPL` all 200. **F** recorded
  (queue/run-log/ledger F-9/this report/MEMORY_LOG/SESSION_STATE).

## Next cell
**Q07** — `lib/backtest/exitRules.ts` (F-3 trailing-stop intra-bar look-ahead + non-ratcheting
peak; F-11 maxHoldDays union-calendar vs trading days). Owner-gated and unchanged: **F-4**
gross→net WR re-baseline, **F-9** entry double-count (this run), **Q05-1** regime slope-null
FALLING_KNIFE, and the **scheduled-task model re-point to Opus** (root cause of the stall).
Monday weekly deep sweep also still due.
