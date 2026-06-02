# Inspection Wave 8 — Data freshness audit (2026-06-02)

## Fixtures

- Backtest JSON under `scripts/backtestData/` — integrity guard merged via **#27**
- Weekly refresh: `.github/workflows/refresh-data.yml` (Sunday 22:00 UTC)

## Checks performed

| Item | Finding |
|------|---------|
| Split continuity | Prior audit: yahoo-finance2 split-adjusted closes — no action |
| Warehouse vs JSON | D5-1 open — warehouse path may diverge; not in handover scope |
| BTC 7-day calendar | D2-7 fixed in portfolio annualization when crypto in universe |

## Recommendation

Run manual `Weekly Data Refresh` after deploy; compare `npm run benchmark` hash before/after refresh.

**Status:** PASS for handover acceptance (guard in place; D5-1 tracked separately).
