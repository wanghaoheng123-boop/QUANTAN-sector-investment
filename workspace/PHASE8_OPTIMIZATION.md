# Phase 8 — Optimization loop commands

**Canonical worktree:** `.claude/worktrees/competent-wu-a84629` @ `chore/expert-team-program`

Scripts exist and are wired in `package.json` on the expert-team branch:

```bash
cd .claude/worktrees/competent-wu-a84629
npm run optimize:grid      # scripts/optimize-grid.ts — Loop 1 walk-forward grid
npm run portfolio:backtest # scripts/portfolio-backtest.ts — Loop 3 multi-instrument
npm run benchmark:enhanced # scripts/benchmark-enhanced.ts — 52.84% WR; NOT production default (Q-009)
```

**2026-05-26:** Full grid run not executed in this session (runtime ~minutes per instrument × 768 combos). Prior loop-1 doc: aggregate OOS WR ~25.7% — do not promote winners to production signals (`reviews/optimization-loop1.md`).

**Owner:** Run overnight on a machine with `scripts/backtestData/*.json` present; commit `scripts/optimization-results-loop1.json` when complete.
