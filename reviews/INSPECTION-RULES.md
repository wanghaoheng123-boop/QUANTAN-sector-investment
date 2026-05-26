# QUANTAN Inspection Rules (strict patrol)

**Version:** 1.0 · **2026-05-26**  
**Enforcement:** Triple-gate (C1 expert → C2 verifier → C3 PM) before merge on math/security/signal paths.

---

## Stop-the-line

| Rule | Threshold | Action |
|------|-----------|--------|
| Benchmark WR | &lt; **55%** aggregate | Block merge; bisect signal change |
| Benchmark WR (CI) | &lt; **55.85%** when job runs | CI fail |
| Benchmark WR (soft) | 55.85%–56.35% | Merge allowed with C2 note in PR |
| Hardcoded secrets | Any match in `lib/` `app/` `components/` | Block; SECURITY ALERT in MEMORY_LOG |
| `npm audit fix --force` | Never on this repo | Breaks `next-auth@4` |
| Silent swallow | `.catch(() => {})` in product code | Block (target: 0) |
| Stacked PR without CI | Base ≠ `main` | Retarget or rebase before merge |

---

## Labeling (desk-grade vs experimental)

Modules listed in [`INSPECTION-WAVE-1-2026-05-26.md`](INSPECTION-WAVE-1-2026-05-26.md) as **experimental** must not use institutional labels ("Fama-French", "full stress P&L") without:

1. File-level disclaimer in source (already required for stubs), **and**
2. API/UI badge: `methodology: 'experimental'` or equivalent, **and**
3. C3 sign-off if copy changes user-facing promises.

---

## LOC gates (maintainability)

| File | Max LOC | Backlog |
|------|---------|---------|
| `components/stock/QuantLabPanel.tsx` | 500 shell | Q-053-NEW |
| `lib/backtest/engine.ts` | 600 | walkForward extracted |
| `app/backtest/page.tsx` | 300 | Q-054 done |

---

## Per-PR mini-patrol

- [ ] `npm run typecheck`
- [ ] `npm run test` (count ≥ SESSION_STATE / invariants)
- [ ] `npm run benchmark` if `lib/backtest/*`, `lib/optimize/*`, `signals.ts` touched
- [ ] No secrets in diff
- [ ] `IMPROVEMENT_BACKLOG.json` updated if closing Q-*

---

## Weekly patrol (Sunday UTC)

1. INSPECT 1–6 per [`workspace/CONTINUOUS_IMPROVEMENT_LOOP.md`](../workspace/CONTINUOUS_IMPROVEMENT_LOOP.md)
2. `npm run benchmark` → log WR in MEMORY_LOG
3. `npm audit --omit=dev` → triage doc if new critical on `next`
4. Root vs worktree drift check
5. Append wave findings to `reviews/INSPECTION-WAVE-*.md` or findings-ledger

---

## Triple-gate definitions

| Gate | Owner | Output |
|------|-------|--------|
| **C0** | Automated | INSPECT 1–6 + CI |
| **C1** | Domain expert (R1–R8) | Proposal + file:line + acceptance test |
| **C2** | Verifier subagent | VERIFY A–F + adversarial diff review |
| **C3** | PM / user | Sign-off on WR, security, public API |

No implementation on C1-class items until C1+C2 agree; C3 required for signal/security releases.
