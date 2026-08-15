# `.quantlab/` — research integrity artifacts

This directory is deliberately **almost empty**, and that is the design.

## Why there is no STATE.md, BACKLOG.yaml, or RISK_REGISTER.md here

The QuantLab orchestration package specifies a `.quantlab/` tree containing
`STATE.md`, `BACKLOG.yaml`, `DECISIONS.md`, `RISK_REGISTER.md`, and `sessions/`.
QUANTAN **already has all five**, live and maintained:

| Package artifact | This repo's canonical file |
|---|---|
| `STATE.md` | `workspace/SESSION_STATE.json` |
| `sessions/` | `workspace/MEMORY_LOG.md` |
| `BACKLOG.yaml` | `workspace/IMPROVEMENT_BACKLOG.json` (schema: `workspace/BACKLOG_SCHEMA.json`) |
| `RISK_REGISTER.md` | `reviews/findings-ledger.csv` |
| `DECISIONS.md` | dated docs in `reviews/` + decision keys in `workspace/SESSION_STATE.json` |

Creating a second copy of each would have produced two sources of truth that
drift apart. This repo has already been burned by exactly that failure mode —
`docs/archive/progress.md` accumulated "remaining bugs" that were stale or
already fixed, and the standing instruction that came out of it is *trust the
code, not the record*. An empty `STATE.md` sitting next to a live, 54KB
`SESSION_STATE.json` is not a map; it is a decoy.

**So the protocol was installed and pointed at the existing files.** See the
source-of-truth table in `CLAUDE.md`.

If you want the literal package layout instead, that is a reversible decision —
but migrate the live files, don't duplicate them.

## What IS here

### `TRIAL_REGISTRY.jsonl`
The one artifact the package specifies that this repo genuinely lacked.

It records every backtest, sweep, and experiment configuration ever tried, so
that Deflated Sharpe Ratio and Probability of Backtest Overfitting can be
computed against the *true* multiplicity rather than against the one
configuration that happened to be reported. Without it, every deflated statistic
is guesswork — and this repo runs a lot of sweeps
(`optimize:grid`, `experiment:rotation`, `experiment:calibrated-score`,
`experiment:score-select`, `experiment:hold-horizon`, `benchmark:oos*`, …).

**Read `TRIAL_REGISTRY_SCHEMA.json` before appending.** Two properties matter
more than the format:

1. **Failures are mandatory rows.** A registry of successes makes deflation
   meaningless. Abandoned runs count too.
2. **The current backfill is incomplete and the file says so.** Rows T-0001 to
   T-0009 were reconstructed on 2026-08-15 from `workspace/optimization-runs/`
   and `reviews/`. Informal and ad-hoc trials are missing, so the true trial
   count is strictly higher and any deflation computed today under-corrects.
   Report that caveat alongside the number.

Nothing appends to this file automatically yet — `Q-081` covers wiring the
experiment harness to write its own rows. Until then it decays whenever someone
forgets, which is why `.claude/commands/handoff.md` makes it a session-close step.

## Related installed pieces

- `CLAUDE.md` — the constitution, boot sequence, and SSOT routing table
- `.claude/agents/` — 17 specialists (`quant-validator` owns this registry)
- `.claude/commands/sprint.md` · `handoff.md` — the session loop
