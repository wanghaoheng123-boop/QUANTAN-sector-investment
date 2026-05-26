# Canonical development tree

**Do not build, test, or commit from the Google Drive repo root** when that checkout is stale or has uncommitted mass deletions.

| Item | Value |
|------|--------|
| **Path** | `.claude/worktrees/competent-wu-a84629` |
| **Branch** | `fix/backtest-live-signals-guards` |
| **HEAD** | Track `origin/main` after `fix/rectification-wave-3` merges |
| **Verify here** | `npm run typecheck` · `npm run test` · `npm run benchmark` |

## Why

The Drive-synced **repo root** often sits on `main` at an old commit with **uncommitted deletions** of `lib/data/providers/`, `lib/portfolio/`, `SectorRotationPanel`, and backtest scripts. Those files **exist intact** on this worktree and on `origin/main`.

## Agent boot

1. `cd` to the path above before any code change (or use Drive root after rectification PR merges).
2. Read `workspace/SESSION_STATE.json` and `workspace/HANDOFF.md`.
3. See `workspace/ROOT_WORKTREE_WARNING.md` before touching root git state.

**Last verified:** 2026-05-26 — 991 tests pass, typecheck clean, SSOT net benchmark WR **53.79%** (gross 54.77%).
