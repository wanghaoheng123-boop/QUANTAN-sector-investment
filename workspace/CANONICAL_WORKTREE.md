# Canonical development tree

**Do not build, test, or commit from the Google Drive repo root** when that checkout is stale or has uncommitted mass deletions.

| Item | Value |
|------|--------|
| **Path** | `.claude/worktrees/competent-wu-a84629` |
| **Branch** | `fix/backtest-live-signals-guards` |
| **HEAD** | `5c9d6fb` (PR #19 — live-signals null-guards + walkforward resync) |
| **Verify here** | `npm run typecheck` · `npm run test` · `npm run benchmark` |

## Why

The Drive-synced **repo root** often sits on `main` at an old commit with **uncommitted deletions** of `lib/data/providers/`, `lib/portfolio/`, `SectorRotationPanel`, and backtest scripts. Those files **exist intact** on this worktree and on `origin/main`.

## Agent boot

1. `cd` to the path above before any code change.
2. Read `workspace/SESSION_STATE.json` and `workspace/HANDOFF.md` (root copy may be newer; worktree tracks `SESSION_STATE` + `MEMORY_LOG`).
3. See `workspace/ROOT_WORKTREE_WARNING.md` before touching root git state.

**Last verified:** 2026-05-26 — 976 tests pass, typecheck clean, benchmark WR **57.26%**.
