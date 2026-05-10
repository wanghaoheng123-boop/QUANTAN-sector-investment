# AI Memory: Task List
#
# Purpose: Track current and upcoming tasks in checklist format.
# Any AI (Claude, GPT, Gemini, local LLM) should:
#   - Read this file at session start to know what to work on.
#   - Mark tasks as [x] when complete, add new tasks as [ ].
#   - Keep the "Active" section pruned to what's actionable now.
#
# Format: `- [ ]` or `- [x]` checkboxes under status sections.
#
# ─────────────────────────────────────────────────────────────

## Active (Work On Next)
- [ ] Run `npm run benchmark` with the fixed enhancedCombinedSignal to establish new baseline
- [ ] Implement ML walk-forward validation (true rolling OOS) in `ml/ensemble.py`
- [ ] Add yield-curve gate (10Y-2Y proxy) for Financials sector
- [ ] UI polish: OptionsChainTable "Show more" for expiry dates > 8

## In Progress
- [x] Phase 12 audit & fix — quant algorithms, portfolio, API routes, frontend, backtest (COMPLETE)
- [x] Universal AI Memory Package initialization (COMPLETE)

## Backlog (Future)
- [ ] InfluxDB-style monitoring dashboard for signal performance
- [ ] Full benchmark suite run with corrected scripts
- [ ] Per-sector sub-profiles for bimodal sectors (Communication: META vs DIS)
- [ ] Mobile-responsive chart improvements

## Completed
- [x] Phase 11 bug fixes (ADX normalization, RSI divergence, Kelly, GEX gamma, API hardening)
- [x] Phase 12 comprehensive audit (141 issues found, 45+ fixes, 279 tests, TS clean)
- [x] Universal AI Memory Package initialized
