# Rectification Wave 12 — Closeout (2026-06-03)

**Branch:** `fix/rectification-wave-12-2026-06-03`  
**Merged PR:** [#48](https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment/pull/48) (API hygiene, SSOT imports, D4-6)  
**Follow-up PR:** audit manifests, F-04 portfolio display fix, backlog Q-069–Q-074

---

## Delivered in PR #48 (main @ 522d6b6)

- D4-6 route rate limits (`analytics`, `sector-rotation`, `ma-deviation`, etc.)
- OhlcBar SSOT import hygiene (`lib/quant/indicators.ts`)
- WalkForwardPanel ticker resync dependency fix
- `__tests__/architecture/module-ssot.test.ts`
- `reviews/FUNCTION-AUDIT-API-2026-06-03.md`
- `reviews/invariants-baseline.md` §3 (percent storage convention)

---

## Closeout on branch (post-merge)

| Item | Artifact |
|------|----------|
| UI audit (48 routes, F-01…F-08) | `reviews/FUNCTION-AUDIT-UI-2026-06-03.md` |
| Quant audit (183 exports, 24 untested) | `reviews/FUNCTION-AUDIT-QUANT-2026-06-03.md` |
| **F-04 fix** | `app/portfolio/page.tsx` — remove `* 100` on JSON percent fields |
| Backlog | `workspace/IMPROVEMENT_BACKLOG.json` Q-069–Q-074 |
| Browser QA | `reviews/BROWSER-QA-2026-06-03.md` |

---

## F-04 root cause

`scripts/portfolio-backtest-results.json` stores `winRate` and `maxDrawdown` **already as percents** (e.g. `48.37`, `15.2`). The portfolio page multiplied by 100 again for display, yielding 4837% / 1520%. Other UI paths (KeyMetricsStrip, backtest API) use fractional values and correctly scale; only this page reads committed JSON directly.

---

## Verification

```bash
npm run test
npm run typecheck
npm run portfolio:backtest
# No NaN in scripts/portfolio-backtest-results.json metrics
```
