# Owner Actions Checklist — 2026-06-02

Human-only steps from the Handover Menu (Tier 0). Agents document; owner executes in Vercel/GitHub.

| ID | Action | Where | Status |
|----|--------|-------|--------|
| ENV-FRED | Set `QUANTAN_FRED_PREWARM=1` in **Production** | Vercel → quantan project → Environment Variables | **DONE** (2026-06-02, prod redeploy `dpl_6huKCcxVyL11rkAJ8TzoQX7aCz5t`) |
| ENV-API-KEY | Set `QUANTAN_API_KEY` (e.g. `openssl rand -hex 32`) | Vercel Production + optional Preview | **DONE** (Production only; key issued once — store in password manager) |
| ENV-CSP | After 7d clean Report-Only → `QUANTAN_CSP_ENFORCE=1` | Vercel Production | PENDING |
| DECIDE-NEXT | **Recommended: Next.js 15.x** (React 19, closes most CVEs, lower blast radius than 16) | See `workspace/Q-057-NEXTJS_DECISION.md` | DECIDED (doc) |
| DECIDE-VERCEL | Delete 2 of 3 duplicate QUANTAN Vercel projects | `workspace/VERCEL_OPERATIONS.md` §12 | **DONE** — removed `quantan-sector-investment`, `quantan-release-work`; kept **`quantan`** |
| DECIDE-POLYGON | Legal opinion + optional `$199/mo` Polygon plan | PM / counsel | PENDING |

**Generate API key locally (do not commit value):**

```bash
openssl rand -hex 32
```

**After env vars set:** redeploy Production, then verify Sharpe/Greeks and trading-agents X-API-Key path.
