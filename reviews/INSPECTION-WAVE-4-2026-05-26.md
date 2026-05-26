# Inspection Wave 4 — 2026-05-26

**Scope:** Full-platform QA (browser + quant APIs) per `workspace/FULL_PLATFORM_QA_2026-05-26.md`.  
**Prior:** [INSPECTION-WAVE-3-2026-05-26.md](./INSPECTION-WAVE-3-2026-05-26.md)

## Summary

Production browser pass: core routes healthy; charts and options on `/stock/AAPL` OK. Quant suite **996** tests; SSOT benchmark net **53.79%**.

**P0 found and fixed:** sector rotation API returned empty rankings because history window was 1 year (~251 bars) vs scoring minimum 253 bars.

## Fixes (wave 4 / QA wave 6)

| ID | Issue | Fix |
|----|-------|-----|
| W6-001 | `/api/sector-rotation` always `scores: []` | 2-year Yahoo chart fetch; `MIN_CLOSES_FOR_SCORING = 253` |
| W6-002 | Rotation panel silent when empty | User-facing empty state + excluded count hint |
| W6-003 | Heatmap legend mobile overflow | `overflow-x-auto` on legend row |

## Verify

| Check | Result |
|-------|--------|
| `npm run test` | 996 PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run benchmark` | net 53.79% (floor OK) |
| Local `/api/sector-rotation` | 11 scores |

## Still open

- Wire `SectorRotationPanel` on desk/heatmap (Q-013)
- Owner: archive duplicate Vercel projects (wave 3)
- `QUANTAN_FRED_PREWARM=1` on production
