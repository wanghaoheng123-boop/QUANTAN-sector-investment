# Task Plan: QUANTAN Round 2 Comprehensive Review — 4-Hour Sprint

## Objective
Conduct a 4-hour multi-specialist review of the QUANTAN platform with emphasis on:
1. UI/UX — user complaints that "current UI sucks"
2. Algorithm accuracy — verify all calculations against industry-standard implementations
3. Data accuracy — verify data sources and correctness
4. Trader feedback — 4 professional traders use all features and report issues
5. Implement fixes, deploy to GitHub + Vercel

## Priority Order
1. UI/UX (TOP PRIORITY — user complaints)
2. Data Accuracy (real data = foundation)
3. Algorithm Accuracy (correct calculations = trust)
4. Code Quality (maintainability)
5. Trader Feedback Integration

---

## Tasks

### Phase 1: Specialist Reviews (Parallel — 60 min)
- [ ] 1.1 **Quant Finance** — backtest engine, Kelly criterion, Sharpe/Sortino, signal logic
- [ ] 1.2 **Mathematics** — RSI, MACD, EMA, Bollinger, ATR, VWAP, DCF formulas
- [ ] 1.3 **Data Science** — Yahoo Finance accuracy, split/dividend adjustment, data validation
- [ ] 1.4 **UI/UX Design (EXPANDED)** — visual design audit, professional trader UX standards, dark theme, color system, typography, component layout
- [ ] 1.5 **Software Engineering** — TypeScript, React/Next.js, security, performance
- [ ] 1.6 **Trader 1: Swing Sector ETF Trader** — uses home, sectors, desk, backtest pages
- [ ] 1.7 **Trader 2: Momentum Tech/Growth Trader** — uses heatmap, stock pages, signals
- [ ] 1.8 **Trader 3: Quantitative/Derivatives Trader** — backtest, walk-forward, Sharpe/Sortino analysis
- [ ] 1.9 **Trader 4: Macro/Commodities Trader** — BTC, commodities, desk, macro regime signals

### Phase 2: Cross-Team Feedback (30 min)
- [ ] 2.1 Each specialist reviews others' findings
- [ ] 2.2 Trader feedback prioritized alongside technical findings
- [ ] 2.3 Disputes resolved, consolidated fix list created

### Phase 3: Implementation (90 min)
- [ ] 3.1 UI/UX P0 fixes (user-facing, high impact)
- [ ] 3.2 Data correctness fixes (P0)
- [ ] 3.3 Algorithm fixes (P0/P1)
- [ ] 3.4 Trader-reported fixes (P1/P2)

### Phase 4: Final Review & Deploy (30 min)
- [ ] 4.1 Final verification
- [ ] 4.2 GitHub push
- [ ] 4.3 Vercel deployment

---

## Priority Definitions
| Priority | Definition |
|----------|------------|
| P0 | Breaks functionality, wrong data, security issue, misleading traders |
| P1 | Poor UX, significant inaccuracy, performance issue |
| P2 | Polish, minor bug, cosmetic |

## Trader Personas
| Trader | Style | Focus Areas | Key Metrics |
|--------|-------|-------------|-------------|
| Marcus Chen | Swing Sector ETF | Home, Sectors, Desk, Backtest | Sector rotation, sector ETF signals |
| Sarah Williams | Momentum Tech/Growth | Heatmap, Stock pages, Signals | Momentum, growth signals, MACD/RSI |
| David Park | Quant/Derivatives | Backtest, Walk-Forward | Sharpe, Sortino, win rate, Kelly |
| Alex Rivera | Macro/Commodities | BTC, Commodities, Desk | BTC regime, commodity cycles |

## Blockers
- None identified yet

## Dependencies
- All Phase 1 tasks run in parallel
- Phase 2 depends on Phase 1
- Phase 3 depends on Phase 2
- Phase 4 depends on Phase 3
