---
name: Development Feedback & Code Style Rules
description: Rules the user has confirmed or corrected about how to write code for QUANTAN
type: feedback
---

## Code Quality Rules

**No speculative abstractions.**
Why: Adding flexibility for hypothetical future needs creates bloat and maintenance burden.
How to apply: Only build what the current phase explicitly requires. Three similar lines > premature abstraction.

**No extra error handling for impossible scenarios.**
Why: Defensive code for things that can't happen clutters the logic.
How to apply: Only validate at system boundaries (user input, external API responses). Trust internal TypeScript types.

**Benchmark guard on signal/backtest changes.**
Why: Silent win-rate regressions are the worst kind of bug in a quant system.
How to apply: Run `npm run benchmark` after any change to `lib/backtest/` or `lib/quant/`. Win rate must stay ≥ 55%.

**TypeScript clean before committing.**
Why: Type errors mask real bugs.
How to apply: `npm run typecheck` (or `node_modules/.bin/tsc.cmd --noEmit` on Windows) must pass.

**Yahoo Finance as the default data source.**
Why: Zero cost, no API keys needed, already installed.
How to apply: Use `yahoo-finance2` for all market data. Paid providers (Polygon, AlphaVantage) go in `lib/data/providers/` with Yahoo as primary fallback.

## Response Style

**Be concise and direct.**
Why: User prefers short responses. Doesn't want summaries of what was just done.
How to apply: Lead with action or answer. Skip preamble. Don't recap completed work in long prose.

**Permissions granted broadly.**
Why: User explicitly grants all permissions at start of session.
How to apply: Proceed without asking for each individual file write/edit permission once granted.

## Windows Environment Notes

- Vitest binary: `node_modules/.bin/vitest.cmd run` (not just `vitest run`)
- TypeScript: `node_modules/.bin/tsc.cmd --noEmit`
- Node version: Use whatever is installed; no version switching needed
- Git worktrees are used for feature branches; each worktree needs its own `npm install`
