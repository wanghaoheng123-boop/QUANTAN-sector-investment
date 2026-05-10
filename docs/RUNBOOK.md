# QUANTAN Python Quant Framework — Runbook

## Environment Setup

```bash
# Python 3.11+ required
python3 --version

# Install dependencies
cd QUANTAN-sector-investment
pip install -r requirements.txt

# For ML ensemble (existing):
pip install -r ml/requirements.txt
```

## Project Structure (New Modules)

```
quant_framework/           # Python quant trading framework
  __init__.py             — Re-exports all public APIs
  data_engine.py          — Unified data acquisition (yfinance/akshare/tushare)
  strategy.py             — Abstract Strategy base class + Portfolio model
  backtest.py             — Walk-forward backtest engine
  analysis.py             — Factor analysis (IC, quantile returns, turnover)
  deploy.py               — Exchange connectivity stubs (CTP, GoldMiner)

alpha_miner.py            # CLI: Genetic programming alpha formula miner

multi_agent_factor_mining/ # Multi-agent factor discovery (LangGraph)
  __init__.py
  config.py               — DeepSeek config, API key guard
  agents.py               — 4 agents: DataProcessor, FactorEngineer, Evaluator, PortfolioComposer
  factor_library.py       — JSON-backed factor store with dedup
  server.py               — FastAPI server (port 3002)

options_asia.py           # A-shares options analyzer (AKShare + simulated)
options_us.py             # US options deep analyzer (vol surface, skew)
options_cross_market.py   # Cross-market volatility factor
server_options.py         # FastAPI server for options (port 3003)

tests/
  test_quant_framework.py            — 47 tests
  test_alpha_miner.py                — 14 tests
  test_multi_agent_factor_mining.py  — 13 tests
  test_options_analyzers.py          — 16 tests
```

## Running Services

### 1. Starting Python Backends

Each FastAPI server runs independently:

```bash
# TradingAgents LLM analysis (existing, port 3001)
python server_trading_agents.py --host 0.0.0.0 --port 3001

# Factor Mining API (port 3002)
python multi_agent_factor_mining/server.py --host 0.0.0.0 --port 3002

# Options Analysis API (port 3003)
python server_options.py --host 0.0.0.0 --port 3003
```

Verify health:
```bash
curl http://localhost:3002/health
curl http://localhost:3003/health
```

### 2. Using Procfile (Railway/Heroku-style)

```
web: python server_trading_agents.py --host 0.0.0.0 --port $PORT
alpha: python multi_agent_factor_mining/server.py --host 0.0.0.0 --port ${ALPHA_PORT:-3002}
options: python server_options.py --host 0.0.0.0 --port ${OPTIONS_PORT:-3003}
```

## Alpha Mining

### CLI: Genetic Programming Miner

```bash
# Run on simulated demo data (no network required)
python alpha_miner.py --demo

# Run on specific ticker
python alpha_miner.py --ticker AAPL

# Use gplearn genetic programming
python alpha_miner.py --ticker AAPL --use-gplearn --generations 20 --population 500

# Save results to JSON
python alpha_miner.py --demo --output discovered_factors.json
```

Example output:
```
TOP 10 ALPHA FACTORS
[1] alpha_zscore_20d
    Formula: (close - ts_mean(close, 20)) / ts_std(close, 20)
    Rank IC: 0.0421
    Sharpe (spread): 0.85
    TS Expression: (closes[i] - sma(closes, 20)[i]) / stdDev(closes, 20)
```

### API: Multi-Agent Factor Mining

```bash
# Discover factors via API
curl -X POST http://localhost:3002/mine-factors \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["AAPL", "MSFT"], "iterations": 3, "use_simulated_data": true}'

# View factor library
curl http://localhost:3002/library

# Get specific factor
curl http://localhost:3002/library/{factor_id}

# Delete a factor
curl -X DELETE http://localhost:3002/library/{factor_id}
```

## Options Analysis

### A-Shares Options (SSE 50 ETF)

```bash
# CLI
python options_asia.py

# API
curl "http://localhost:3003/options/asia/510050?spot=2.80&days=60&simulated=true"

# Chart (PNG)
curl "http://localhost:3003/options/chart/asia/510050?spot=2.80" -o chart.png
```

### US Options (SPY)

```bash
# CLI
python options_us.py

# API
curl "http://localhost:3003/options/us/SPY?days=60"
```

### Cross-Market Analysis

```bash
# CLI
python options_cross_market.py

# API
curl http://localhost:3003/options/cross-market

# Global volatility factor
curl http://localhost:3003/options/factor/global-vol
```

## Quant Framework Usage

### Run a Backtest

```python
from quant_framework import get_daily, Strategy, BacktestEngine, BacktestConfig

class SmaCross(Strategy):
    def init(self):
        self.fast = self.sma(10)
        self.slow = self.sma(30)

    def handle_data(self, i):
        if i < 60:
            return 0
        return 1 if self.fast[i] > self.slow[i] else -1

data = get_daily("AAPL", start="2020-01-01")
engine = BacktestEngine(BacktestConfig(initial_capital=100000))
result = engine.run(SmaCross(), data)

print(f"Return: {result.total_return:.2%}")
print(f"Sharpe: {result.sharpe_ratio:.2f}")
print(f"Max DD: {result.max_drawdown:.2%}")
print(f"Trades: {result.total_trades}")
```

### Factor Analysis

```python
from quant_framework import factor_ic, quantile_returns, performance_summary
import numpy as np

# IC analysis
factor_vals = np.random.randn(1000)
fwd_rets = factor_vals * 0.02 + np.random.randn(1000) * 0.01
result = factor_ic(factor_vals, fwd_rets)
print(f"Rank IC: {result['rank_ic_mean']:.4f}")

# Performance summary
equity = 100 * np.exp(np.cumsum(np.random.randn(252) * 0.02))
metrics = performance_summary(equity)
print(f"Sharpe: {metrics['sharpe_ratio']:.2f}")
```

## Running Tests

```bash
# All tests
python3 -m pytest tests/ -v

# Specific module
python3 -m pytest tests/test_quant_framework.py -v
python3 -m pytest tests/test_alpha_miner.py -v
python3 -m pytest tests/test_options_analyzers.py -v
python3 -m pytest tests/test_multi_agent_factor_mining.py -v

# Expected: 105 passed, 1 skipped (matplotlib chart test)
```

## Integration with TypeScript Frontend

### Pattern (follows existing ml/client.ts)

```typescript
// lib/options-python/client.ts — proxy to server_options.py:3003
const OPTIONS_SIDECAR = process.env.OPTIONS_SIDECAR_URL ?? 'http://localhost:3003'

export async function fetchAsiaOptions(ticker: string) {
  try {
    const res = await fetch(`${OPTIONS_SIDECAR}/options/asia/${ticker}`)
    if (!res.ok) return { available: false }
    return { available: true, data: await res.json() }
  } catch {
    return { available: false }
  }
}

// app/api/options-asia/[ticker]/route.ts — Next.js proxy
import { NextResponse } from 'next/server'
export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  const data = await fetchAsiaOptions(params.ticker)
  return NextResponse.json(data)
}
```

### Global Vol Factor → EnhancedCombinedSignal

The cross-market volatility factor can be injected into the TS signal engine:

```typescript
// In lib/backtest/signals.ts enhancedCombinedSignal(), add as a WeightedConfirm:
{
  name: 'GlobalVolRegime',
  value: globalVolRegimeScore,
  bullish: globalVolRegimeScore > 0.3,
  weight: 0.05,
  score: globalVolRegimeScore,
  weightedScore: 0.05 * globalVolRegimeScore,
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError: No module named 'fastapi'` | `pip install fastapi uvicorn` |
| `AKShare data unavailable` | Falls back to simulated data. Check internet, retry in 5 min. |
| `yfinance rate limited` | Wait 15 min. Add `source="akshare"` for A-shares. |
| `gplearn not installed` | `pip install gplearn`. alpha_miner.py falls back to template search. |
| `matplotlib chart fails` | Chart generation skips gracefully. Install with `pip install matplotlib`. |
| `DeepSeek API key not found` | Set `DEEPSEEK_API_KEY` env var. Factor mining falls back to templates. |
| `No data for ticker` | Check ticker format. Use `--demo` flag for testing. |
