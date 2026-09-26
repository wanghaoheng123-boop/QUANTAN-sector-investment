# Q-105 — the /backtest page described a strategy the engine had stopped running

**Date:** 2026-09-27 · **Ticket:** Q-105 · **Ledger:** Q085-1, Q105-C1 (resolved), Q105-1, Q105-2, Q105-R1…R8 (new)
**Kind:** contract change (wire field removed) plus user-visible copy correction. **No calculation changed**,
and the A/B below proves it.

## What was wrong

The ticket was filed as dead configuration: `BacktestConfig.stopLossPct` was echoed into every result and
read by nothing. That was true. It was also the smallest part of the problem.

`backtestInstrument` (`lib/backtest/core.ts`) is the engine behind `/api/backtest`. On its production default
path it does the following, and nothing else:

| | What the engine does |
|---|---|
| Signal | Regime-only classifier. The enhanced path is off in production (`lib/featureFlags.ts`); production trade reasons read `[regime-only path; enhanced disabled in production]`, observed on the live API 2026-09-27 |
| Entry | Close below the 200SMA, SMA up > 0.5% over 20 bars, price no more than 5% below it at some bar of the last 20 |
| Size | 15% of the instrument's **cash** at entry, rounded **down to whole shares**; a BUY that cannot buy one share is skipped. Not a Kelly computation |
| Exit | **Time exit after 60 bars**, or the 25% equity-drawdown breaker, both filled at the next open. End of data closes at the final close |
| Not present | ATR stop, trailing stop, profit target (retired D2, 2026-07-11); SELL-signal exits (retired D4); any confidence threshold (the regime path never reads it) |

Three user-visible surfaces said otherwise:

| Surface | Claimed |
|---|---|
| `/backtest` info bar | "Stop Loss: ATR-adaptive (1.5× ATR, 3–15%)", "Trailing Stop: 2× ATR → break-even, 4× ATR → 1× ATR lock", "Half-Kelly sizing (max 25%)", "Confidence threshold: 55%" |
| `/backtest` Strategy Rules grid | the same stops, "SELL → Exit full position", "≥2 of: RSI<35, MACD…", tiered 10/15/25% sizing, "55% confidence minimum" |
| Landing-page CTA | "ATR-adaptive stops, and half-Kelly sizing" |
| `/backtest` trade log | "Reason" column tooltip: "Why the trade exited: … STOP_LOSS, TRAILING_STOP …". The column renders the **entry** reason, and the engine records no exit reason at all |

**The only exit the engine actually has, the 60-bar time exit, appeared on none of them.** A reader
interpreting the win rate, drawdown and return beside those rules was reading numbers produced by a
different rulebook from the one printed next to them. The 55% figure was wrong twice: the default is 50,
and production ignores the field.

`/api/backtest` also shipped `stopLossPct: 0.1` on every instrument. Read literally, that says a 10% stop was
applied. No stop was applied.

## What changed

- `stopLossPct` removed from `BacktestConfig`, `DEFAULT_CONFIG`, `BacktestResult` and the two echo sites in
  `core.ts`, along with the comment calling it "the floor for the ATR formula". **Wire change:**
  `/api/backtest` results no longer carry the field. No consumer existed. Checked across `app/`,
  `components/`, `hooks/`, `lib/`, `scripts/`, `ml/` and `*.py`, and on the live payload.
- **Not touched, despite sharing the name:** `ExitStats.stopLossPct` (`exitRules.ts`, fraction of exits
  that were stops), the local in `gridSearch.ts`, `atrStopMultiplier` (a live PBO dimension), and
  `portfolioBacktest.ts`'s ATR-stop machinery, which that engine still carries behind its `exit` config.
- `confidenceThreshold` **kept**, per the Q-108 audit: it is live in `enhancedCombinedSignal`. Its JSDoc
  now says the regime path ignores it.
- `lib/backtest/strategyConstants.ts` (new, **zero runtime imports**): `ENGINE_MAX_HOLD_DAYS`,
  `MIN_SMA200_SLOPE`, `NEAR_SMA200_PCT`, `REGIME_PATH_POSITION_FRACTION`. The engine now imports these
  instead of inline literals. They sit in a leaf module because `exitRules.ts` and `regimeSignal.ts`
  import `lib/quant/indicators`, and the copy is rendered by client components. Verified in the built
  chunk: no `FALLING_KNIFE`, which `regimeSignal` emits.
- `lib/backtest/strategyDescription.ts` (new): the Rules grid, the info bar and the landing clause, all
  built from those constants plus `DEFAULT_CONFIG` and the cost model. `TX_COST_RULE` moved here;
  `OverviewTab` re-exports it.
- Trade-log "Reason" and "Action" tooltips now describe what the columns render.

## Behaviour-neutral: measured, not asserted

Every `backtestInstrument` result over all 56 committed fixtures, dumped before the edit and after, in both
signal modes. The before-run executed `origin/main` code (captured before any file was touched); the
after-run carried a marker grep confirming the new code:

| Mode | Instruments | Trades | Fields differing (excluding the removed one) |
|---|---|---|---|
| regime-only (production) | 56 | 224 | **0** |
| enhanced | 56 | 52 | **0** |

`npm run benchmark`: exit 0, edge +1.59pp, unchanged.

## The guard that should have caught this was green, twice over

`__tests__/architecture/backtest-config-consumed.test.ts` (Q-127) exists to fail on exactly this, a
declared config field with no reader. It was green for two independent reasons, and either alone would
have hidden the field:

1. **It visited only `PortfolioConfig`'s own body.** `stopLossPct` lived on `BacktestConfig`, which
   `PortfolioConfig` *extends*. This is guard reachability in a new shape: an `extends` clause.
2. **It counted `\bfield\s*:` as consumption**, so `stopLossPct: cfg.stopLossPct`, the echo that carried
   the inert value to the user, was scored as a read. The guard certified the defect it was built to find.

Both are closed. Every interface in `DECLS` is parsed, an `extends` naming an unparsed interface fails, and a
read is a member access with same-name echoes removed. **Watched failing** on the original tree: two tests
red, naming `stopLossPct`.

**The first run of that mutation passed, and the reason is worth keeping.** My own A/B harness sat under
`scripts/`, and its `delete r.stopLossPct` counted as a read. That is the name-collision limitation, live,
and it is now an executable CANNOT-DO.

## Mutations — 13 of 13 fail as designed (first pass; see round 1 for the full 25)

| # | Mutation | Caught by |
|---|---|---|
| M1–M4 | restore the original info bar / Rules grid / landing CTA / trade-log tooltips | copy guard |
| M5 | hardcode `60` in the copy instead of the constant | "no engine number hardcoded" |
| M6 | re-arm an ATR stop in `DEFAULT_TIME_EXIT_CONFIG` | "no stops" is true of the declared policy |
| M6b | copy re-adds an un-negated "trailing stop" | negation property |
| M7 | threshold `<` becomes `<=` | boundary: BUY at `c`, HOLD at `c+1` |
| M8 | SELL no longer exempt | SELL survives threshold 101 |
| M9 | regime path starts reading the threshold | CANNOT-DO: regime results identical at 0 and 101 |
| M10 | threshold line deleted | boundary and end-to-end |
| M11 | guard stops visiting `BacktestConfig` | extends-reachability |
| M12 | guard counts echoes as reads again | echo positive control |

## Named residuals — each a passing test or a backlog item, not a hedge

- **The copy describes the production DEFAULT path.** If `QUANTAN_USE_ENHANCED_SIGNAL` were switched on in
  production, the BUY, HOLD and sizing rows would become false, and nothing ties the copy to the path that
  actually ran. The API should report the signal path, and the copy should render from it. → backlog.
- **The trade log cannot say why a trade closed.** The engine does not record an exit reason, and the
  SELL action filter is always empty because every recorded trade is a BUY. → backlog.
- The config guard matches names, not types, and a regex cannot tell a member read from a decision. It errs in
  **both** directions: destructuring makes a live field look inert (loud), and a renamed echo, a log line or an
  unused binding makes an inert field look consumed (**silent**). Both are asserted as CANNOT-DOs. *The first
  version of this note said it erred only toward the loud direction. That was false; round 1 below.*
- `DEFAULT_TIME_EXIT_CONFIG`'s stop fields are asserted zero, but `core.ts` does not read them. It hardcodes
  its exits. The copy test pins `core.ts`'s exit calls by source scan (asserted CANNOT-DO).

## Red-team round 1 — two HIGH false sentences in copy this package wrote

The adversarial review was pointed at the claims above. It could not break the behaviour-neutral claim
(it re-derived it independently: SHA-256 of every result, identical before and after, in both modes), the
time-exit wording, the entry rule, or the absence of any `stopLossPct` consumer. It broke these, and every
one of them was a sentence, not an engine defect:

| Id | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | HIGH | "A fixed 15% of capital per BUY" is false for BTC. Shares are floored, so all 167 regime BUY bars round to zero and are silently skipped. BTC has 0 trades yet sits in the 56-instrument aggregate. The test titled "sizes every BUY" read one signal's `KellyFraction` field and never looked at a position | **Fixed.** Copy now says 15% of **cash**, whole shares, and that a BUY which cannot afford one share is skipped, with the $15,000 ceiling derived from the constants. The old test is replaced by two: the realised first position is bounded exactly, and BTC's zero trades are pinned to the skip (every BUY bar's next open is above the allocation). The engine behaviour and BTC's place in the aggregate move to **Q-136** |
| R2 | HIGH | Tooltips on the same trade log still claimed the retired rulebook. Conf% said "<55% triggers HOLD" and "70%+ = act with full size" (advice wording, Q-083). Signal said "EXIT = OVERBOUGHT". Regime described a seven-state classifier the platform does not have. The copy guard never scanned glossary text | **Fixed** at the source (`lib/metricGlossary.ts`, whose only live render site for these three is the trade log). The guard now scans every `components/backtest` source **and** the glossary text every `metricKey` on them resolves to |
| R3 | MEDIUM-HIGH | The Signals tab had a "Kelly" column showing SELL = 100% and every HOLD = 10%, on the page that says SELL closes nothing and sizing is not Kelly. "200EMA Dev" labelled a 200-**SMA** deviation (verified in `liveSignal.ts`) | **Fixed.** The column is now "Size", shown only for BUY, via an exported pure `positionSizeLabel`, and the header reads "200SMA Dev" |
| R4 | MEDIUM | The config guard accepted the copy module as a reader. With every engine read of `maxDrawdownCap` deleted, it stayed green because `strategyDescription.ts` prints it. Wrapped and assigned echoes also counted as reads. My "errs toward the loud direction" claim was false | **Fixed.** Consumption is searched in engine roots only, with display modules excluded, and the exclusion is asserted by name. Wrapped and assigned echoes are now echoes. The `REGIME_PATH_POSITION_FRACTION` keys are renamed `half`/`full` so they cannot collide with `halfKelly`. The false sentence is corrected here and in the test |
| R5 | MEDIUM | 18 of 22 paraphrases of retired claims passed the copy guard, including "a no-cost stop-loss", read as a negated stop | **Fixed as far as a blacklist can be.** A 30-entry corpus must all be caught, negation must be the word immediately before, and a bare "stop" counts only as a noun in a stop context. Paraphrase incompleteness is an asserted CANNOT-DO |
| R6 | MEDIUM | The landing line this PR edited still quoted "label WR ~55% gross / ~54% net". That figure is hand-written and stale, comes from the 20-day label benchmark (a different rulebook from the 60-bar engine it sits beside), and its net value is at the always-buy base rate | **Fixed.** The clause is removed, and a test forbids a win rate in that CTA |
| R7 | LOW-MEDIUM | The drawdown breaker never fired (0 of 224 exits; worst drawdown 10.26%). At 15% sizing a single position rarely can. Its peak never resets, so once tripped it would close every later position after one bar | **Q-137.** The copy describes the mechanism accurately; the latent reset behaviour is an engine question |
| R8 | LOW | The HOLD and SELL rows overlapped with no boundary. The RSI wording was too broad. The Reason tooltip promised a "dip classification" it does not carry. `ENGINE_MAX_HOLD_DAYS`'s doc said "exits this many bars after fill" when the hold is 61 bars open to open | **Fixed.** `FIRST_DIP_FLOOR_PCT` is hoisted, and the rows quote it. RSI is scoped to the mildest dips. The tooltip and the constant's doc are corrected |

**Re-verified after the fixes.** The A/B again shows 0 fields differing, in both modes. The benchmark exits 0 at
+1.59pp. `next build` is green. `/backtest` was re-rendered with each trade-log tooltip opened and read, and
the Signals tab showed BUY 15%, HOLD —, SELL —.

**25 mutations; all fail as designed.** On its first run, **R4b survived**: emptying the display-module list
left the guard green, because the test proving "the exclusion is live" looped over that same set, and a loop
over an empty set asserts nothing. That is the vacuous-pass shape again, inside the test written to prevent
it. It now names the module explicitly.
