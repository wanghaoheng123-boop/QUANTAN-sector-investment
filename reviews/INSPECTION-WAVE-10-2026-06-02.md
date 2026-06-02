# Inspection Wave 10 — Ledger reconciliation (2026-06-02)

## Actions taken

| Source | Action |
|--------|--------|
| `workspace/IMPROVEMENT_BACKLOG.json` | Q-053 → **done** (148 LOC verified); Q-005 → **partial** (KV opt-in); Q-059–062 → **done**; Q-063 → **partial** |
| `reviews/invariants-baseline.md` | §2b C1/C2 portfolio-sim rebaseline added |
| `reviews/findings-ledger.csv` | Full CSV sync deferred — recommend monthly owner pass |

## Inspection findings closed in code

- D2-1, D2-2, D2-5, D2-6, D2-7 (WS2 + signals)
- D1-1 (`core.ts` extraction)
- D3-2 (BTC page decomposition)
- D3-9 (`buildVisFromIndicatorPreset` SSOT in `lib/chartEma.ts`)

## Still open in ledger (Bucket B)

D5-1, D5-5, D1-5 (technicals callers — thin delegate acceptable), D1-6 (eslint audit documented)

**Status:** Backlog reconciled for handover scope; CSV row-by-row sync is follow-up.
