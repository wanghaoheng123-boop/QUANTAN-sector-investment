# WARNING — stale Google Drive repo root

As of **2026-05-26**, the synced repo root at:

`QUANTAN-sector-investment/` (branch `main`, HEAD ~`3870751`)

had **uncommitted deletions** including:

- `lib/data/providers/*`
- `lib/portfolio/*`
- `components/SectorRotationPanel.tsx`
- `components/AuthNav.tsx`
- `scripts/backtest/engine.ts`, `scripts/backtest/signals.ts`
- `scripts/migrate-json-to-sqlite.ts`, `scripts/runBacktest.mjs`

These are **not** intentional removals on `origin/main`. An agent likely ran destructive edits at root without committing.

## Safe recovery (owner approval only)

From repo root, after confirming you want to **discard all local changes**:

```bash
cd "/path/to/QUANTAN-sector-investment"
git status   # review deletions
git checkout -- .   # restores tracked files; does NOT delete untracked workspace docs
git clean -fd       # ONLY if you intend to remove untracked files — ask owner first
```

**Do not** run the above from an agent without explicit user approval.

## Correct workflow

Use the canonical worktree — see `workspace/CANONICAL_WORKTREE.md`.

Never commit fixes from root while `git status` shows mass `D` lines for core library paths.

## rsync hazard (2026-05-26)

**Never** run `rsync --delete` from `.claude/worktrees/competent-wu-a84629/` to the repo root: the worktree path lives **inside** the root tree, so `--delete` can wipe the worktree working copy. Use `rsync` with `--exclude='.claude'` and **without** `--delete`, or `git reset --hard` inside the worktree to recover.
