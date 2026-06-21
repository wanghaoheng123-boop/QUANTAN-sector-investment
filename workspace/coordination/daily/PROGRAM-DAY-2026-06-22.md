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

**No escalations.** No published-number/contract/auth/secret change → SAFE category.

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

## Next cell
**Q06** — `lib/backtest/executionModel.ts` (F-9 entry-slippage double-count vs 22bps SSOT;
cost model). Still owner-gated and unchanged: **F-4 gross→net WR re-baseline** (Q01/Q02
escalation), and the **scheduled-task model re-point to Opus** (root cause of the stall).
Monday weekly deep sweep also still due.
