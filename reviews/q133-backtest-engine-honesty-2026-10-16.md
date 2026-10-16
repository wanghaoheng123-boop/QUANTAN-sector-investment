# Q-133 · Q-134 · Q-136 · Q-137 · Q-139 — what the backtest engine records, and what the page says it did

**Date:** 2026-10-16. **Kind:** migration note, because published portfolio figures move.
**Branch:** `fix/q133-backtest-engine-honesty`.

The win rate, profit factor and trade count do not move, and neither do the label benchmark and the CI gate. What moves is every equity-curve figure on `/backtest` (return, annualized return, Sharpe, Sortino, drawdown, alpha), because one instrument leaves the aggregate.

## Published figures, before and after

Measured through the real `/api/backtest` handler over the committed fixtures (data vintage 2026-10-12), with `QUANTAN_USE_ENHANCED_SIGNAL=0`. That is the production path; see the dev/prod note below.

| Figure | Before | After | Why |
|---|---|---|---|
| Instruments in the aggregate | 56 | **55** | BTC excluded (Q-136) |
| Portfolio total return | 3.64% | 3.70% | a flat $100,000 curve no longer dilutes it |
| Portfolio annualized return | 1.20% | **0.84%** | 252-day calendar, not 365 (below) |
| Sharpe / Sortino | −5.68 / −6.63 | −7.44 / −7.71 | same, plus the daily risk-free rate is now spread over 252 days |
| Max drawdown | 0.68% | 0.69% | |
| Alpha / B&H average | −1.1359 / 1.1723 | −1.1309 / 1.1679 | |
| Win rate · profit factor · trades | 59.57% · 2.737 · 230 | **unchanged** | BTC never traded, so it held no trades |

## Q-136: BTC was averaged in, and it re-annualized the whole book

At $100,000 per instrument and 15% of cash per position, a BUY can spend at most $15,000. BTC's lowest next-open on a BUY bar was above that, so **all 167 BUY signals were skipped**. BTC never opened a position, yet `aggregatePortfolio` still did two things with it:

- **Diluted the combine.** BTC contributed a flat $100,000 curve to the equal-weight combine, as if the strategy had earned 0% on it. Its row showed **−59.5% excess return** against a buy-and-hold the strategy never had the chance to match.
- **Set the calendar.** It switched the portfolio's annualization to **365 days** (`annDays = combinable.some(crypto) ? 365 : 252`). A constituent that never traded therefore made 55 equity curves annualize as though they traded every calendar day. That shortened the year count from 4.3 to 3.0 (1,093 points ÷ 252 vs ÷ 365). The calendar alone lowers annualized return by about 0.37 points. Removing the flat BTC curve raises it slightly, so the net fall is 0.36 points. *(Round-1 correction: an earlier draft said 1,083 points and called the calendar "most of" the fall; it is more than all of it.)*

**The change:**
- The engine counts unfillable BUY signals (`unaffordableEntries`).
- An instrument with zero trades and at least one unfillable BUY is excluded from every aggregate, through a single definition in `lib/backtest/resultFlags.ts`, and is named in `portfolio.untradeableTickers`.
- **On the page:**
  - the Instruments tab marks the row "not tradeable at this size" and shows `—` for its return, annualized return and excess;
  - the metrics strip reads "55 · in the portfolio figures, of 56 backtested";
  - a banner names the instrument and gives the reason.

**What this is not:** a decision about whether BTC *should* be tradeable. Fractional sizing for crypto would give BTC a strategy result. That would publish a new per-instrument performance figure, which sits under I5, so it stays a separate decision.

## Q-133: the engine now records why and when a position closed

`closePosition` took no reason, so the trade log could only show the *entry* reason, under a header that had promised the exit's. Each closed trade now carries:
- `exitReason`: `time_exit`, `max_drawdown` or `end_of_data`, a subset of the existing `ExitReason` vocabulary that the type narrows to the three exits this engine has;
- `exitDate`: the date of the fill bar;
- `netPnl`: net cash after both sides' costs.

On the fixtures: **215 time exits, 15 end-of-data, 0 breaker.**

**Changes to the trade log:**
- **Exit column.** It shows the reason and the date.
- **Header.** "Reason" is now "Entry reason".
- **Action filter.** It appears only when more than one action exists. The engine records only BUY, so the SELL option always produced an empty table.
- **Win/loss counts.** These counted wins on the *raw price move*, so a +0.1% trade that lost money after 22 bps of costs was a "winner". They now use `netPnl`, which is the quantity the engine's win rate already used (Q-123). The averages are net as well.

## Q-137: the drawdown breaker re-arms

`peakEquity` never reset. After one trip, equity typically stayed below the old peak, so a later position was usually closed at its first check: a slow drain of round-trip costs behind a rule described as a breaker. (An exit fill that gapped back above the threshold could escape it, so "every position" was too strong.)

The peak now resets to the post-exit equity. After that, drawdowns are measured from there, or from any later mark-to-market high, which can be a later position's own intra-trade high. There is **no cooldown**: the next BUY can fill on the bar after the breaker's own fill. The breaker has **never fired** on the committed fixtures, so this changes no published figure.

**Decision: why re-arm rather than the alternatives.**

| Option | Why not chosen |
|---|---|
| One-way halt | One bad trade would silence an instrument for the rest of a multi-year window. The portfolio then becomes a mix of strategy results and frozen cash, and the page does not say which is which. |
| Cooldown | A new parameter with no measured value. Choosing one without data would be a free parameter added to an engine whose skill is already unproven (I5). |
| Re-arm (chosen) | It removes the defect, the stale peak, without adding a parameter. |

Revisit this decision if the breaker ever fires on real data.

The behaviour is now pinned by a branch-forcing fixture. It lowers the cap and scripts the signal; the engine itself is real. Without the re-arm, the second position closes after one bar with reason `max_drawdown`. With it, the position is held to its time exit.

## Q-139: "5Y walk-forward" described a single pass

`backtestInstrument` fits no parameters, so "walk-forward" (re-fitting on rolling windows) was wrong. "5Y" stopped being true once the window start was pinned (Q-102), because history now grows every week. The count "56" was hand-written in five places. In one of them it read "56 … large-caps plus BTC", which is 57.

| Surface | Before | After |
|---|---|---|
| Landing CTA | "5Y walk-forward backtest across 56 instruments" | `BACKTEST_SCOPE_LINE`: a single pass with no look-ahead, the stock and sector counts **counted from `SECTORS`**, and the warm-up taken from `BACKTEST_WARMUP_BARS` |
| `/backtest` subtitle | "5Y Walk-Forward · 56 Instruments" | "Single pass, no look-ahead · {results.length} instruments" |
| Loading text | "Fetching 5Y history for 56 instruments" | counted |
| Universe note | "56 … plus BTC" | counted, plus the traded window computed from the response's candle counts (median minus warm-up) |
| Analysis panel | "Walk-Forward / Overfitting Check" | "Performance by Period" |

**The Analysis panel had three further defects:**
- **The "quarters" were not quarters.** "Rolling Quarterly Performance Q1–Q4" was four equal slices of about a year each.
- **"In-Sample Ann. Return" had no in-sample period behind it.** It was the full-period figure.
- **"B&H Ann. Return" was not annualized.** It printed a **total** return.

It also computed Sharpe at 4% and 252 days while the engine used 4.5% and 365 for crypto, so the same curve had two Sharpes on one page.

`lib/backtest/periodSplit.ts` now does the split. The periods chain exactly to the whole, which is tested to 1e-12. It uses the engine's risk-free constant and calendar, and the panel says plainly that this is not an overfitting test.

`tradingDaysPerYear` moved to `lib/backtest/calendar.ts`, and `BACKTEST_WARMUP_BARS` moved to `strategyConstants.ts`. Both are re-exported from `core.ts`, so client components can read them without bundling the engine.

## Q-134: the rules are shown only for the path that ran

Every rule on `/backtest` describes the regime-only path, which production runs by default. With `QUANTAN_USE_ENHANCED_SIGNAL=1` the engine would run the enhanced path and the BUY, HOLD and sizing rows would become false, while every test stayed green. That makes the copy an assertion about a default, not a fact.

**The change:**
- `/api/backtest` now returns `signalPath`, read at run time from the same flag the engine reads.
- The page renders `ENGINE_SUMMARY` and the Overview tab's rules only when `signalPath === 'regime-only'`. For `'enhanced'` it says which path ran. For a response that does not say (a cached payload from before the field existed), it says that too and shows no rules: unknown is not the default.
- `STRATEGY_RULES`, a re-export of `ENGINE_RULES` that only tests read, is removed. The tests now assert what the tab renders for the path.

**Tests:** `signalPathCopy.test.tsx` covers the route under both flag values and the tab for all three cases. Three mutations, all killed: the route hardcodes `regime-only`; the rules always render; unknown is treated as regime-only.

## Tests and mutations

- **`engineExits.test.ts`** uses a scripted signal against the real engine. It covers time exit, end of data, exit date, net P&L sign, breaker fire and re-arm, unaffordable count, exclusion, calendar invariance, and the case of an instrument that traded and is never excluded.
- **`periodSplit.test.ts`** checks that the periods chain, the calendar, a flat period, and a short curve.
- **`backtestHonesty.test.tsx`** checks the exit column, net classification, the hidden filter, the untradeable row and the strip count.
- **The copy guard** fails when a surface calls the pass walk-forward, offers an in-sample figure, says 5Y, or hand-writes the count.
- **Mutations: 18, all killed.** Eight are on engine/aggregate, seven on UI/period split and three on Q-134. Round 1 added six more (below), all killed.
- **Suites:** full suite 2498 passed / 17 skipped at the first push (a draft said 2493); `tsc` clean; `npm run benchmark` passes (the label pipeline is unaffected).

**One test asserted the defect:** `BacktestPage.test.tsx` pinned "Fetching 5Y history for 56 instruments". It now pins the derived count.

## Found here, not fixed here

- **The Sharpe is an artefact of idle cash** (backlog **Q-143**, added in this PR; the first draft said "filed" before anything was). The engine credits idle cash with 0% while subtracting a 4.5% risk-free rate, so a strategy that is flat most of the time shows −7.4 Sharpe whatever its trades did. The panel now says so. The fix is to credit idle cash at the risk-free rate or to drop the figure, and either way every published Sharpe moves.
- **Dev and test run a different signal path from production.** `useEnhancedCombinedSignal()` defaults ON outside `NODE_ENV=production`, so a local `/backtest` shows 54 enhanced-path trades where production shows 230 (both measured 2026-10-16). The figures above were measured with the flag forced OFF. Recorded on Q-134 in this PR's backlog update (the first draft said "recorded" before it was).
- **`scripts/benchmark-results.json` is stale against the committed data.** It records 3394 BUY signals where today's run produces 3528. The weekly refresh updates the data but not this file. The file was not changed here.
- **Making BTC tradeable re-opens the calendar problem.** The 365-day annualization is now avoided by excluding the instrument that never traded, not fixed. Fractional crypto sizing would put BTC back in the combine and switch the equity book to a 365-day year again. Dated equity curves (the residual already named in `engine.ts`) are the real fix.
- **The period panel uses the 4.5% risk-free constant in the browser.** The engine uses `getRiskFreeRateSync()`, which a FRED prewarm or a server environment override can change, so the two can differ silently. Whether production sets either was not verified.

## Red-team round 1 (`reviews/q133-red-team-2026-10-16.md`)

18 findings: 2 HIGH, 5 MEDIUM, 11 LOW. Every number in the before/after table reproduced. The defects were in claims and in surfaces the first version did not visit.

| Finding | Fix |
|---|---|
| **F1 (HIGH).** "5Y walk-forward" still rendered in the global nav (`SiteNav.tsx`), in `public/launcher.html`, and in the glossary ("~5-year backtest"). The copy guard scanned four hand-picked files. | All three corrected. The guard now walks every `.tsx` under `app/` and `components/`, `public/*.html`, the glossary and the strategy description, and asserts it visits `SiteNav.tsx` and `launcher.html`. `WalkForwardPanel` is renamed `PeriodSplitPanel`. |
| **F2 (HIGH).** "Excluded from every aggregate" was false: the Analysis tab re-averaged all results in the browser, so BTC came back as a "Crypto 0.0%" sector row, as a risk/return row beside a −59.5% excess, and as a choice in the period picker. The Overview's top-8 equity chart could draw it in a filtered view. | Both tabs filter through the shared `isUntradeable`, and the Analysis tab names what it omits. Render-tested. |
| **F4.** With every selected instrument excluded, the strip showed "0.00%" returns and excess. | It now renders "No portfolio figures" with the reason. |
| **F5.** The static landing page stated the regime-only sizing whichever path ran. | `ENGINE_ONE_LINE` is removed. The landing CTA points to `/backtest`, where the rules are gated by `signalPath`. |
| **F6.** The re-arm copy was false ("measured from where they start"), and no decision was recorded. | The copy and the code comment are corrected; the decision is recorded above. |
| **F7.** The breaker's exit date was unpinned; dating it on the bar before the fill survived. | Pinned. |
| **F8.** The sizing rule said "an instrument that never opens one is excluded", which is false for WELL: no BUY signal at all, correctly kept. | Reworded to "every BUY unaffordable", and the copy says that holding cash is a strategy result. |
| **F9.** "Filed" and "recorded" were claimed before anything had been written. | Q-143 and the Q-134 note are added in this PR's records. |
| **F12.** The trade log's "Date" is the signal date. | Header and caption say so. |
| **F13.** A response cached before this change rendered every closed trade as "Open" with 0 wins and 0 losses. | Closed is now derived from `pnlPct`, and unknown net results render "—". |
| **F3, F14, F15, F18.** Counts. | Corrected: 1,093 points; 0 of 230; the calendar effect; 2498 tests. |
| **F16.** "1 instruments"; "55 … plus BTC" above a banner excluding BTC. | Pluralized, and the note now says "plus BTC when it can trade at this capital". |
| **F10, F17.** | Named residuals, above. |

**Round-1 mutations, all killed:**
- the nav says walk-forward;
- `launcher.html` says walk-forward;
- the Analysis tab keeps BTC;
- the strip renders zeros;
- an old trade shows as Open;
- the breaker exit is dated on the signal bar.

