# Algorithm discovery audit — 2026-09-16

Scope: deterministic accounting probes of the existing engine while Q108 is the implementation package. No historical strategy experiment, production change, or measured strategy-performance claim. Numbers below describe invented unit fixtures only. Research Sharpe, DSR, PBO, trial count, worst year, historical drawdown and capacity are not measured here; research verdict remains **NOT PROVEN**.

## Findings for subsequent work

### 1. HIGH — drawdown exit bypasses invalid-fill protection

`lib/backtest/core.ts:350` calls `closePosition(state, nextOpen)` without the finite/positive check used by entries (`:368`) and time exits (`:333`). The shared closer (`:190-215`) also has no price guard. A drawdown breach after buying 500 shares at 100 books an exit at 0, -1, NaN or Infinity. Observed equity returns respectively -0.50055, -0.5055445, NaN, NaN. The time-exit guard also falls through to this unguarded branch when both triggers hold. Final liquidation at `:430` independently accepts a corrupt last close.

Minimal regression: mock one BUY at decision index 200, 100000 starting cash, Kelly 0.5; bar 202 close=40, bar 203 open=NaN; otherwise 300 bars at 100. Assert a corrupt price never becomes a completed trade and every reported curve point remains finite, or that the run explicitly fails as unpriceable. Repeat 0, negative, Infinity, time-exit+DD coincidence, and corrupt final close. Define a consistent rejection/deferral contract before fixing; centralize the fill check. Existing random corrupt-open tests scatter invalid values but do not force this risk-exit branch.

No matching open ledger row found; related Q02 covers entry only. This also falsifies the historical assertion in Q103-RT-7 that nothing in the engine reaches NaN.

### 2. MEDIUM — the repaired net-win threshold still misclassifies a narrow loss band

`core.ts:193-207` charges the exit fee on exit notional but classifies against a constant `2*c` price return. `engine.ts:82-84` repeats the approximation. With price return r and fee c, exact cash profit per entry notional is `r - c*(2+r)`; the break-even return is `2*c/(1-c)`. At c=0.0011, buying 500 shares at 100 and selling at 100.2201 loses **$0.071055** but reports winRate=1.

Regression: use the one-trade 252-bar fixture in the probe, and independently compute `shares * (exit*(1-c) - entry*(1+c))`. Test either side of exact break-even, plus zero. Use that same cash profit definition in both single and aggregate classification. This is a residual of **F-4**, which is marked fixed; it is not a claim that the original gross/net fix never landed. Impact is a narrow boundary; no historical frequency measured.

### 3. MEDIUM — profit factor changes when a single result is aggregated

`core.ts:206-207` places gross positive returns below the net-win threshold into grossLoss, while `engine.ts:85-87` excludes them from both grossProfit and grossLoss. Two trades with gross price returns +10% and +0.1% produce **core PF=100; aggregatePortfolio([same result]) PF=Infinity**. Neither is a consistent net-dollar profit factor. Both also sum percentages despite different share counts/notionals.

Regression: two forced entries at indices 200 and 270; time exits fill opens 262=110 and 332=100.1. Assert a single-result aggregation reproduces the same metric, then independently sum positive/negative cash P&L with unequal sizes and fees. Choose and document net-dollar PF or a clearly named alternative before updating API semantics. Existing `aggregatePortfolio.golden.test.ts:107` explicitly ratifies the mixed definition; change the independent accounting oracle, not only the expected constant. No dedicated ledger match found; related to F-4 but a distinct metric defect.

### 4. MEDIUM — dividends held by the strategy never reach its cash ledger

All dividend reads in `core.ts` affect the B&H calculation (`:43-44`, `:287-288`, `:299-300`, `:432-433`). Entry/exit cash accounting (`:193-208`, `:383`) never credits dividends. One 500-share position spanning a $2 per-share dividend has exactly the same strategy return with and without that dividend: -0.0011 in the fixture. The cash entitlement missing in that fixture is $1000. The B&H comparator does include dividends, creating asymmetric accounting.

Regression: force a BUY filled at open 201, dividend on 220, close final position on 251. Compare zero-dividend control and assert dividend cash entitlement only for shares held over the applicable ex-date boundary. Include purchases on ex-date (not entitled), exit at ex-date open (entitled), and no position. Define entitlement ordering against next-open fills; do not add cash to already total-return-adjusted prices. This repo documents split-adjusted close, which is not the same as dividend-adjusted total-return close. Data-vendor semantics should be rechecked by the implementation agent before historical claims.

F1.5 tracks B&H dividend omission, not strategy cash; `aggregatePortfolio.golden.test.ts:264` explicitly preserves the unchanged strategy. No open row documenting this strategy omission found.

### 5. MEDIUM — B&H dividend reinvestment pays only the initial share

`core.ts:44` uses `shares += dividend/close`, and the B&H curve repeats it at `:288`, `:300`, `:433`. Later dividends are per share and must also be earned on previously reinvested shares. Three bars at 100, with dividend=10 on each of the last two, return **20%**, where reinvesting both distributions yields **21%**: `1.1 * 1.1 - 1`.

Regression: independent cash/share ledger for two distributions, unequal prices, zero-dividend control. Apply consistent `shares *= 1 + dividend/close` if close-price reinvestment remains the documented convention. This is distinct from Q110-Q1r's warmup-dividend/endpoint disagreement; that row does not describe missing compounding in the scalar itself. No matching open compounding finding found.

## Q105 decision

Removing inert stop-loss configuration preserves the explicitly retired July stop algorithm (`core.ts:315-328`). Enabling the field would create a different strategy and needs a new research package. The confidence field requires caller-specific treatment: a companion caller audit found it active in the enhanced signal path, while default engine variation can be inert. Do not remove a shared field globally without splitting that live enhanced contract. The Q085-1 ledger wording that ATR-adaptive stops supersede the field is stale: the current loop explicitly retires those stops. A test demanding every option change every fixture output is invalid: options can legitimately be inactive when their branch is not reached. Force branch-relevant fixtures and test each supported decision surface.

## Reproduce the first four observations without editing the repository

Run the following from the repository root with installed TypeScript. It transpiles the actual source in memory. It replaces only the signal, auxiliary indicators, rate, constants and synthetic boundary with controlled unit stubs; production accounting stays unchanged. These are branch-forcing unit probes, not end-to-end market-data tests. The fifth finding is directly reproducible with `computeBuyAndHoldReturn` and the three-bar fixture above.

```js
// node <<'NODE' ... NODE
const fs = require('fs'), ts = require('typescript'), vm = require('vm');
let buys = new Set([201]); // lookback length; signal decision index is length-1
function load(file, extra = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  const deps = {
    './signals': {
      DEFAULT_CONFIG: { initialCapital: 100000, maxDrawdownCap: .25, halfKelly: true,
        stopLossPct: .1, confidenceThreshold: 50 },
      resolveBacktestSignal: (_t, _d, _p, closes) => ({
        action: buys.has(closes.length) ? 'BUY' : 'HOLD', KellyFraction: .5,
        regime: {}, confidence: 80,
      }),
    },
    '@/lib/quant/indicators': { atrArray: b => b.map(() => 1), sortinoRatio: () => null },
    '@/lib/quant/riskFreeRate': { getRiskFreeRateSync: () => 0 },
    './exitRules': { DEFAULT_TIME_EXIT_CONFIG: { maxHoldDays: 60 } },
    './executionModel': { costBpsPerSide: () => 11, DEFAULT_EXECUTION_COSTS: {} },
    '@/lib/synthetic': { assertNotSynthetic: () => {} },
    './walkForward': {}, ...extra,
  };
  vm.runInNewContext(code, { exports, require: k => {
    if (!(k in deps)) throw Error(k); return deps[k];
  }, console });
  return exports;
}
const core = load('lib/backtest/core.ts');
const engine = load('lib/backtest/engine.ts', { './core': core });
const rows = (n = 300) => Array.from({ length: n }, (_, i) => ({
  time: 1700000000 + i * 86400, open: 100, close: 100,
  high: 101, low: 99, volume: 1000,
}));
for (const bad of [0, NaN, Infinity, -1]) {
  const r = rows(); r[202].close = 40; r[203].open = bad;
  const x = core.backtestInstrument('TEST', 'Technology', r);
  console.log('dd_exit', String(bad), x.closedTrades[0].exitPrice,
    x.totalReturn, x.equityCurve.every(Number.isFinite));
}
{
  const r = rows(252); r[251].close = 100.2201;
  const x = core.backtestInstrument('TEST', 'Technology', r);
  console.log('net_win', x.winRate, x.totalReturn * 100000);
}
{
  buys = new Set([201, 271]); const r = rows(340);
  r[262].open = 110; r[332].open = 100.1;
  const x = core.backtestInstrument('TEST', 'Technology', r);
  console.log('profit_factor', x.profitFactor,
    engine.aggregatePortfolio([x], 100000).profitFactor);
}
{
  buys = new Set([201]); const r = rows(252); r[220].dividend = 2;
  const x = core.backtestInstrument('TEST', 'Technology', r);
  delete r[220].dividend;
  console.log('strategy_dividend', x.totalReturn,
    core.backtestInstrument('TEST', 'Technology', r).totalReturn);
}
console.log('bnh_compounding', core.computeBuyAndHoldReturn([
  { close: 100 }, { close: 100, dividend: 10 }, { close: 100, dividend: 10 },
]), 1.1 * 1.1 - 1);
```
