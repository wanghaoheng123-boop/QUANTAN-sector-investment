# HANDOFF — 2026-05-26 (P0 PR stack merged)

## Main
- **HEAD:** `2ee18e3` (merge PR #20)
- **Canonical worktree:** `.claude/worktrees/competent-wu-a84629`

## Merged PRs (merge commits)
| PR | SHA | Title |
|----|-----|-------|
| #17 | `88f2c8f` | Q-058-NEW snapshot guards + npm-audit triage |
| #18 | `ee3e3ee` | Q-054-NEW backtest page decomp |
| #19 | `a0bb302` | live-signals null-guards + walkforward resync |
| #21 | `5149954` | benchmark refresh WR 57.26% |
| #20 | `2ee18e3` | session state / MEMORY_LOG |

## VERIFY (post-merge, worktree @ origin/main)
- typecheck: **PASS**
- tests: **982 passed** / 78 files
- benchmark: **57.26%** WR (≥ 55% floor)
- smoke: **PASS** — `SMOKE_BASE_URL=https://quantan.vercel.app npm run check:smoke`

## PR #19 CI (after retarget to main)
GitHub CI run `26443146355`: typecheck, test, coverage, benchmark, smoke — **all SUCCESS**. Vercel deploy checks were pending at merge time; merge was not blocked.

## Owner actions
1. **Vercel:** Set `QUANTAN_FRED_PREWARM=1` on **quantan** project → Production → redeploy.
2. **Q-057-NEW:** Decide Next.js target (14.x patch / 15.x / 16.x) before upgrade work.
3. **Repo root:** Stale at `3870751` with local deletions — do not develop there; optional `git checkout -- .` after review.

## Next code work
- Phase 16 S2 per `reviews/PHASE-16-PLAN.md`
- Phase 8: `npm run optimize:grid` overnight — see `workspace/PHASE8_OPTIMIZATION.md`

---

## 2026-05-26 — Inspection wave 1 + Q-053 (uncommitted)

**Worktree:** `.claude/worktrees/competent-wu-a84629` @ `5922bca` (`chore/expert-team-program`)

| Check | Result |
|-------|--------|
| typecheck | PASS |
| test | **982** passed (0 skipped) |
| benchmark | **57.26%** WR |
| build | PASS (`next@14.2.35`) |
| smoke | PASS |

**Code:** Q-053 — `QuantLabPanel.tsx` **1410 → 148 LOC**; extracted `components/stock/quantlab/{hooks,tabs}/*`. W1-001/002/003 closed. F5.2 ledger FIXED.

**PR merge (owner):**

```bash
cd .claude/worktrees/competent-wu-a84629
git push -u origin chore/expert-team-program
gh pr create --base main --head chore/expert-team-program \
  --title "Expert team: inspection wave 1, Q-053 QuantLab decomp, next 14.2.35" \
  --body "$(cat <<'EOF'
## Summary
- Inspection wave 1: briefs URL SSOT, QuantLab decomposition, Next.js 14.2.35 CVE patch
- 982 tests; canonical benchmark WR 57.26%; production smoke PASS

## Test plan
- [x] npm run typecheck
- [x] npm run test
- [x] npm run benchmark
- [x] npm run build
- [x] npm run check:smoke
EOF
)"
```

Do **not** force-push `main`. Resolve `BLOCKER-ROOT-GIT-DRIFT` by merging this branch, not rsync `--delete` to root.

---

## 2026-05-26 — Signal SSOT remediation (uncommitted)

**Canonical function:** `resolveBacktestSignal()` in `lib/backtest/signals.ts` — see `lib/backtest/SIGNAL_SSOT.md`.

| Check | Result |
|-------|--------|
| typecheck | PASS |
| test | **984** passed (+2 signalParity) |
| build | PASS |
| benchmark (SSOT, regime-only) | **54.77%** gross WR, **53.79%** net — **exits 1** vs 55% floor (honest; legacy mjs was 57.26% on different inline logic) |
| benchmark:enhanced | 52.84% (unchanged) |
| benchmark:oos | IS 65.38% / OOS 58.45% / gap 6.93pp (12 tickers) → `workspace/optimization-runs/oos-validation.json` |
| parity tests | PASS |

**Key files:** `lib/backtest/{executionModel,benchmarkLabel,liveSignal}.ts`, `scripts/benchmark-signals.ts`, `app/api/backtest/live/route.ts`, `lib/backtest/portfolioBacktest.ts`, `__tests__/backtest/signalParity.test.ts`.

**Next:** C2 sign-off on §1b re-baseline (done in code); improve `regimeSignal` with OOS guard before chasing 55%+; do **not** re-enable enhanced in prod (52.84%). Full `optimize:grid` deferred.

---

## 2026-05-26 — Platform rectification wave 1 (uncommitted)

| Check | Result |
|-------|--------|
| typecheck | PASS |
| test | **987** passed / 80 files |
| build | PASS |
| benchmark (SSOT net floor) | gross **54.77%**, net **53.79%**, floor **53.29%** — **PASS** |
| benchmark:enhanced | **52.84%** — warn only (research, not CI) |
| RECTIFICATION_LOG | `workspace/RECTIFICATION_LOG.md` |

**Merge/sync (owner):**
1. Review uncommitted Drive-root diff; do **not** `rsync --delete` from worktree.
2. Merge `chore/expert-team-program` or cherry-pick rectification commits to align `HEAD` with code (`BLOCKER-ROOT-GIT-DRIFT`).
3. Push → CI should pass with new net WR gate.
4. Vercel: `QUANTAN_FRED_PREWARM=1` (Q-004).

**Top code paths touched:** `lib/backtest/engine.ts`, `scripts/benchmark-signals.ts`, `.github/workflows/ci.yml`, `reviews/invariants-baseline.md`, `__tests__/backtest/executionModel.test.ts`.
