# Architecture Overview
#
# This file is a placeholder for architectural documentation.
# As the project evolves, document key design decisions here:
#   - Component tree and data flow
#   - API design and route structure
#   - Database schema and migrations
#   - State management patterns
#   - Testing strategy
#
# For now, see .ai/memory/context.md for the project architecture summary.

## Current Architecture (QUANTAN)

- **Frontend:** Next.js 14 App Router + React 18 + Tailwind CSS + lightweight-charts
- **State:** SWR for server state, localStorage for portfolio persistence
- **API Routes:** Next.js API routes with Yahoo Finance as primary data source
- **ML:** Python FastAPI sidecar (RandomForest + XGBoost + Logistic Regression ensemble)
- **Trading Agents:** Python FastAPI server wrapping TradingAgentsGraph for LLM analysis
- **Data:** SQLite warehouse (better-sqlite3) with provider abstraction (Yahoo → Polygon → AlphaVantage → FRED)
- **Testing:** Vitest (279 test suite) + pytest (Python)
