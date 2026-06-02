# Inspection Wave 7 — Live browser QA checklist (2026-06-02)

**Mode:** Static/code audit + route inventory (no automated browser run in CI yet).

## Priority routes

| Route | Loading | Error states | A11y notes |
|-------|---------|--------------|------------|
| `/` | Sector grid | API fallback | #32 sweep merged |
| `/backtest` | Spinner + retry | Chart error boundary | 268 LOC shell |
| `/stock/[ticker]` | Chart + quote SSE | ChartErrorBoundary | Tabs keyboard (#32) |
| `/crypto/btc` | REST + WS | fetchError banner | Decomposed to 125 LOC shell (WS4) |
| `/portfolio` | localStorage | Empty state | Factor attribution disclaimer updated |

## Follow-ups

- Wire `@axe-core/cli` in CI (Phase 16 S4 — workflow stub in `.github/workflows/a11y-axe.yml`)
- Q-063: add "20d label WR, net/gross" helper text on LiveSignalsPanel

## Status

**PASS (code-level)** — full Playwright pass optional for owner.
