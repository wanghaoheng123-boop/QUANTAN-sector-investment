# AI Memory: Project Context
#
# Purpose: Long-term project description, goals, constraints, and architecture overview.
# Any AI should read this first to understand WHAT this project is and WHY it exists.
#
# ─────────────────────────────────────────────────────────────

## Project Identity
- **Name:** QUANTAN — Quantitative Trading & Investment Intelligence Platform
- **Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · yahoo-finance2 · Vitest · lightweight-charts · Python/FastAPI (ML sidecar)
- **Deployment:** Vercel (auto-deploy on push to main) at https://quantan.vercel.app
- **Owner:** Individual trader/investor building institutional-grade quant platform

## Mission
Achieve >80% selective signal accuracy across all market conditions. Bloomberg-like analytical depth, accessible to individual investors. Values backtesting rigor, institutional-grade analysis, and continuous improvement.

## Architecture
```
app/          — Next.js App Router (pages, layouts, API routes)
components/   — React components (charts, options, portfolio, backtest)
lib/
  quant/      — Technical indicators, regime detection, sector rotation
  backtest/   — Signal engine, exit rules, portfolio backtest
  options/    — Black-Scholes, Greeks, GEX, flow analysis
  portfolio/  — Position tracking, VaR, risk parity, stress tests
  optimize/   — Grid search, parameter sets, sector profiles
  data/       — Provider abstraction, SQLite warehouse
  ml/         — Python FastAPI client
scripts/      — Benchmarks, data validation, smoke tests
ml/           — Python ML ensemble (RandomForest + XGBoost + LogReg)
server_trading_agents.py — Python FastAPI for LLM-based analysis
```

## Key Constraints
1. No speculative abstractions — only build what's needed
2. No extra error handling for impossible cases — trust TypeScript
3. Benchmark guard — win rate must stay >= 55%
4. Yahoo Finance primary data source, paid APIs as fallback
5. 56 instruments (11 GICS sectors x 5 stocks + BTC)

## Testing
- Vitest with 279 tests across 21 test files
- Baseline win rate: 56.35% (benchmark-signals.mjs)
- TypeScript strict mode enabled
