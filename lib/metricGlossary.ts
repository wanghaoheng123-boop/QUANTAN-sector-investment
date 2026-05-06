/**
 * Metric Glossary — central source for tooltip explanations.
 *
 * Every entry covers: what the metric is, the typical range, and how to act on it.
 * Phase 12 Sprint 1 follow-up: addresses the "users have no idea what they're looking at" complaint.
 *
 * Format used by MetricTooltip:
 *   { label, definition, range, howToUse, source }
 */

export interface MetricMeta {
  /** Short canonical name, e.g. "RSI(14)" */
  label: string
  /** One-line plain-English definition */
  definition: string
  /** Typical numeric range or scale */
  range: string
  /** Trader's pragmatic guidance: what to do with it */
  howToUse: string
  /** Where the methodology is documented (Wilder 1978, etc.) */
  source?: string
}

export const METRIC_GLOSSARY: Record<string, MetricMeta> = {
  // -------- Momentum --------
  rsi: {
    label: 'RSI(14)',
    definition: 'Relative Strength Index — momentum oscillator measuring recent gains vs losses.',
    range: '0–100. <30 oversold, >70 overbought, 50 neutral.',
    howToUse: 'RSI > 70 → watch for pullback. RSI < 30 → watch for bounce. Persistent >70 in strong trend = momentum continuation, not reversal.',
    source: 'Wilder (1978)',
  },
  macd: {
    label: 'MACD',
    definition: 'Moving Average Convergence Divergence — difference between EMA12 and EMA26, with signal-line crossover.',
    range: 'Unbounded. Sign matters more than magnitude.',
    howToUse: 'MACD crossing signal upward = bullish trigger. Histogram expanding = trend strengthening. Use with RSI to filter false signals.',
    source: 'Appel (1979)',
  },
  stoch: {
    label: 'Stochastic %K',
    definition: 'Where today\'s close sits inside the recent high–low range.',
    range: '0–100. <20 oversold, >80 overbought.',
    howToUse: 'Cross of %K through %D in oversold = buy signal. Best in range-bound markets, weak in strong trends.',
    source: 'Lane (1950s)',
  },

  // -------- Trend --------
  ema50: {
    label: 'EMA(50)',
    definition: 'Exponential moving average over 50 bars — medium-term trend.',
    range: 'Same units as price.',
    howToUse: 'Price above EMA50 = uptrend, below = downtrend. EMA50 crossing EMA200 (golden/death cross) is a major regime signal.',
  },
  ema200: {
    label: 'EMA(200)',
    definition: 'Exponential moving average over 200 bars — long-term trend benchmark.',
    range: 'Same units as price.',
    howToUse: 'Price > EMA200 = institutional uptrend regime. Most quant systems only go long above EMA200.',
  },
  pctVsEma200: {
    label: '% vs EMA200',
    definition: 'How far current price is above/below the 200-bar EMA.',
    range: 'Typically -30% to +30%. Outside ±20% is extreme.',
    howToUse: '+10–20% = strong bull. <-10% = strong bear. >+20% with high RSI = euphoria (mean-revert risk). <-20% with low RSI = capitulation (bounce setup).',
  },

  // -------- Volatility --------
  atr: {
    label: 'ATR(14)',
    definition: 'Average True Range — average daily price movement over 14 bars (absolute, not %).',
    range: 'Same units as price. ETFs ~1–3%, single stocks 2–8% of price.',
    howToUse: 'Use to size stop-losses (1.5×ATR is a common stop). Rising ATR = volatility expansion (caution). Falling ATR = consolidation (potential breakout setup).',
    source: 'Wilder (1978)',
  },
  atrPct: {
    label: 'ATR %',
    definition: 'ATR expressed as percent of current price.',
    range: '0.5%–8% typical. >5% is high vol regime.',
    howToUse: 'Position-size inversely to ATR%. <1.5% = quiet (use tighter stops). >5% = volatile (smaller positions, wider stops).',
  },
  parkinsonVol: {
    label: 'Parkinson Vol',
    definition: 'Volatility estimator using daily high–low range (more efficient than close-to-close).',
    range: 'Annualised %. 10–25% normal, >40% stressed.',
    howToUse: 'Spike in Parkinson without similar spike in close-to-close vol = intraday-only stress. Used as macro risk gate.',
    source: 'Parkinson (1980)',
  },

  // -------- Volume --------
  volPoc: {
    label: 'Volume POC',
    definition: 'Point of Control — price level with highest traded volume in window. Acts as magnet/support.',
    range: 'Same units as price.',
    howToUse: 'Price approaching POC from above = potential support. Below POC and rejecting = bearish. POC shifting up bar-over-bar = accumulation.',
  },
  obv: {
    label: 'OBV',
    definition: 'On-Balance Volume — running cumulative volume, signed by daily price direction.',
    range: 'Unbounded; trend matters.',
    howToUse: 'OBV diverging from price = warning. Price up + OBV flat = weak rally. Price down + OBV flat = potential bottom.',
    source: 'Granville (1963)',
  },

  // -------- Multi-Timeframe / Regime --------
  multiTfScore: {
    label: 'Multi-TF Score',
    definition: 'Composite trend alignment across daily / weekly / monthly timeframes.',
    range: '-1 to +1. +1 = all timeframes bullish.',
    howToUse: '+0.6 or higher = high-conviction long. Below 0 with daily long signal = day-trade only, no swing position.',
  },
  regime: {
    label: 'Regime',
    definition: 'Discrete market state classification (Strong Bull / Bull / Neutral / Bear / Strong Bear / Euphoria / Capitulation).',
    range: '7 states.',
    howToUse: 'Match strategy to regime. Trend-following best in Strong Bull/Bear. Mean-reversion best in Neutral. Reduce size in Euphoria/Capitulation (regime change risk).',
  },
  goldenCross: {
    label: 'Golden Cross',
    definition: 'EMA50 crossing above EMA200 — classic long-term bullish regime trigger.',
    range: 'Boolean (active or not).',
    howToUse: 'Active = institutional buy regime. Death cross (EMA50 < EMA200) = institutional risk-off regime.',
  },

  // -------- Performance Metrics --------
  sharpe: {
    label: 'Sharpe Ratio',
    definition: 'Annualised excess return divided by total volatility.',
    range: 'Negative–4. >1 good, >2 excellent, >3 elite.',
    howToUse: 'Compare strategies on Sharpe, not raw return. Penalises both losses AND upside volatility.',
    source: 'Sharpe (1966)',
  },
  sortino: {
    label: 'Sortino Ratio',
    definition: 'Like Sharpe but only penalises DOWNSIDE volatility (correct denominator: n_d, count of negative-return periods).',
    range: 'Negative–6. Higher than Sharpe by ~30–50% typically.',
    howToUse: 'More relevant than Sharpe for asymmetric strategies (long-only, momentum). >1.5 indicates good downside management.',
    source: 'Sortino & van der Meer (1991)',
  },
  profitFactor: {
    label: 'Profit Factor',
    definition: 'Gross profit (sum of winning trades) divided by gross loss.',
    range: '>1 profitable. >1.5 robust. >2 excellent.',
    howToUse: '<1.3 fragile to slippage/regime change. Combine with win rate — high WR + low PF = small wins / big losses (dangerous).',
  },
  maxDrawdown: {
    label: 'Max Drawdown',
    definition: 'Largest peak-to-trough equity decline.',
    range: '-100% to 0%. <-20% requires strong stomach.',
    howToUse: 'Pre-approve max DD you can mentally tolerate. If realised DD > 1.5× backtest DD, model is broken — stop.',
  },
  winRate: {
    label: 'Win Rate',
    definition: 'Percentage of trades closed at profit.',
    range: '0–100%. 50% baseline.',
    howToUse: 'High WR alone is meaningless without payoff ratio. 60% WR + 1:1 R/R is great; 60% WR + 0.5:1 is bad.',
  },

  // -------- Risk / Stops --------
  atrStop: {
    label: 'ATR Stop',
    definition: 'Stop-loss anchored at entry price minus 1.5×ATR (instrument-aware floor: 1.5% ETF, 3% single stock).',
    range: '1.5–15% from entry.',
    howToUse: 'Size position so that hitting the stop loses ≤1% of account. Trail stop in profit using same ATR multiple.',
  },
  trailingStop: {
    label: 'Trailing Stop',
    definition: 'Stop that ratchets up as price rises but never falls — locks in profits.',
    range: 'Tracks 1.5×ATR below recent high.',
    howToUse: 'Activates after entry is +1×ATR in profit. Lets winners run while protecting gains.',
  },

  // -------- Returns & Sizing --------
  alpha: {
    label: 'Alpha',
    definition: 'Excess return of a strategy over a passive buy-and-hold benchmark on the same instruments.',
    range: 'Typically -10% to +20% annual.',
    howToUse: 'Positive alpha = strategy adds value beyond beta exposure. >5% annual is meaningful in equities. Persistently negative alpha = strategy not worth the friction.',
  },
  annualizedReturn: {
    label: 'Annualized Return (CAGR)',
    definition: 'Constant annual growth rate that produces the observed total return over the period.',
    range: 'Negative–30%+. SPY long-term avg ≈ 10%.',
    howToUse: 'Compare to risk-free rate (T-Bill ~4%) and benchmark. <Sharpe-adjusted is what really matters.',
  },
  kellyFraction: {
    label: 'Kelly Fraction',
    definition: 'Optimal bet size as % of bankroll: f* = (bp − q)/b, where p = win prob, q = loss prob, b = win/loss ratio.',
    range: '0–100%. We use Half-Kelly (0.5×) for institutional safety.',
    howToUse: 'Full Kelly maximises log-growth but produces large drawdowns. Half-Kelly = lower variance, ~75% of Kelly\'s growth rate.',
    source: 'Kelly (1956); Thorp (1962)',
  },
  riskReward: {
    label: 'Risk/Reward Ratio',
    definition: 'Distance to target divided by distance to stop. Both measured from current entry.',
    range: '0–5+. ≥1.5 is the institutional minimum for new entries.',
    howToUse: '<1.0 = bad bet. 2.0 = standard swing setup. >3.0 = high-conviction setup, can size up.',
  },
  confidence: {
    label: 'Signal Confidence',
    definition: 'Composite score (0–100%) measuring agreement across all sub-signals (trend + momentum + vol regime + multi-TF).',
    range: '0–100%. <55% triggers HOLD; >75% = high conviction.',
    howToUse: '70%+ = act with full size. 55–70% = trade smaller. <55% = wait for higher-confidence setup.',
  },

  // -------- Indicators --------
  bollingerBands: {
    label: 'Bollinger Bands',
    definition: 'Price envelope at ±2 standard deviations from a 20-bar SMA. %B expresses price position inside the bands.',
    range: '%B: 0 (lower band) to 1 (upper band). Outside [0,1] = breakout.',
    howToUse: 'Squeeze (narrow bands) = volatility coil before move. %B > 1 in uptrend = momentum continuation; in range = mean-revert short.',
    source: 'Bollinger (1980s)',
  },
  vwap: {
    label: 'VWAP',
    definition: 'Volume-Weighted Average Price — running average of price weighted by volume. Resets each session.',
    range: 'Same units as price.',
    howToUse: 'Price above VWAP = bullish intraday; below = bearish. Institutions use VWAP as execution benchmark — bouncing off VWAP common at session midday.',
  },
  fibonacci: {
    label: 'Fibonacci Retracement',
    definition: 'Horizontal levels at 23.6%, 38.2%, 50%, 61.8% retracement of a prior leg.',
    range: '0–100% of the move.',
    howToUse: '38.2–61.8% pullbacks in uptrends are common entry zones. Failure to hold 61.8% often = trend break.',
  },
  volSma: {
    label: 'Volume SMA(20)',
    definition: '20-bar simple moving average of trading volume — baseline for "normal" volume.',
    range: 'Same units as volume.',
    howToUse: 'Volume > 1.5× SMA20 confirms breakout. Volume < 0.7× SMA20 = lacklustre move (don\'t chase).',
  },

  // -------- Regimes / Dip Signals --------
  dipSignal: {
    label: 'Dip Signal State',
    definition: 'Discrete classification of how price relates to 200SMA: HEALTHY_BULL / EXTENDED_BULL / STRONG_DIP / FALLING_KNIFE / NEUTRAL / OVERBOUGHT.',
    range: '6 states.',
    howToUse: 'BUY zone = STRONG_DIP (in rising 200SMA). AVOID = FALLING_KNIFE (declining 200SMA + dip). EXIT = OVERBOUGHT/EXTENDED_BULL.',
  },
  ma200Zone: {
    label: '200SMA Zone',
    definition: 'Position of price relative to 200SMA expressed as % deviation.',
    range: '-30% to +30% typical.',
    howToUse: 'Dip-buy zones: -3% to -10% in rising trend. Overbought: +15% above SMA. Use slope (rising/falling SMA200) for context.',
  },

  // -------- Options --------
  gex: {
    label: 'GEX (Gamma Exposure)',
    definition: 'Net dealer gamma at each strike. Positive = dealers long gamma (price-stabilising); negative = short gamma (price-destabilising).',
    range: '$ billions. Sign matters more than magnitude.',
    howToUse: 'High +GEX at current strike = pinning behaviour (expect compressed range). Deep −GEX = expect volatility expansion / trend continuation.',
  },
  maxPain: {
    label: 'Max Pain',
    definition: 'Strike at which the most options expire worthless — i.e. the price level that minimises payouts to option buyers.',
    range: 'Same units as price.',
    howToUse: 'Acts as price magnet near monthly expiration (3rd Friday). Often more useful in single names with high open interest than in indices.',
  },
  gammaFlip: {
    label: 'Gamma Flip Level',
    definition: 'Price where dealer aggregate gamma transitions from positive to negative.',
    range: 'Same units as price.',
    howToUse: 'Above flip = dealers stabilise (buy dips, sell rips). Below flip = dealers de-stabilise (sell dips, chase rallies). Major regime line.',
  },
  iv: {
    label: 'Implied Volatility (IV)',
    definition: 'Market\'s implied future volatility extracted from option prices.',
    range: '5%–200%+. SPY ~12–20%, single tech 30–60%, biotech 60–150%.',
    howToUse: 'Compare IV rank/percentile (current IV vs 1Y range). High IV rank = sell premium; low = buy premium / long volatility.',
  },
  delta: {
    label: 'Delta (Δ)',
    definition: 'Sensitivity of option price to $1 move in underlying. Approximate probability of finishing ITM.',
    range: 'Calls 0–1, Puts -1–0.',
    howToUse: '0.30Δ ≈ 30% prob ITM. Sell 0.30Δ puts as income strategy with reasonable safety margin. ATM = 0.50.',
  },
  openInterest: {
    label: 'Open Interest (OI)',
    definition: 'Total number of outstanding options contracts at a strike.',
    range: '0 to millions.',
    howToUse: 'High OI = liquid strikes — easier to enter/exit. Sudden OI growth = positioning building (watch for catalyst).',
  },
  volumeToOI: {
    label: 'Volume / Open Interest',
    definition: 'Ratio of today\'s volume to existing open interest at a contract. Detects unusual flow activity.',
    range: '0–10×+. >2× flagged as unusual; >5× = high-conviction directional flow.',
    howToUse: 'Volume/OI > 2× signals new positioning being built today (vs simply rolling existing positions). Combine with side (call/put) and strike to infer institutional bias.',
  },
  flowSentiment: {
    label: 'Flow Sentiment',
    definition: 'Aggregated bullish/bearish/neutral classification across unusual options flow on a name today.',
    range: 'BULLISH / BEARISH / NEUTRAL',
    howToUse: 'BULLISH = aggressive call buying / put selling dominates. BEARISH = inverse. NEUTRAL = mixed flow. Confirms or contradicts your directional thesis from chart/quant signals.',
  },

  // -------- Volume / Flow --------
  offExchangePct: {
    label: 'Off-Exchange %',
    definition: 'Percent of daily volume traded on dark pools / off-exchange ATSs.',
    range: '20–60% typical for large-caps.',
    howToUse: 'Rising off-ex % near key levels = institutional positioning. Sustained >50% = quiet accumulation/distribution.',
  },
  shortFloatPct: {
    label: 'Short % of Float',
    definition: 'Shares sold short as % of free-trading shares (float).',
    range: '0–50%+. >20% = high; >40% = squeeze candidate.',
    howToUse: 'High short% + positive catalyst = squeeze risk for shorts. Use with days-to-cover for context.',
  },
  daysToCover: {
    label: 'Days to Cover',
    definition: 'Short interest divided by avg daily volume — number of trading days needed for shorts to exit.',
    range: '0.5–10+ days.',
    howToUse: '>5 = risk of squeeze on positive catalyst. <2 = shorts can easily exit.',
  },

  // -------- Crypto-specific --------
  fundingRate: {
    label: 'Perp Funding Rate',
    definition: 'Periodic payment between long and short perpetual futures holders to anchor perp price to spot.',
    range: 'Typically -0.05% to +0.10% per 8h.',
    howToUse: 'Positive = longs pay shorts (bullish positioning). Extreme positive (>0.05%/8h sustained) = crowded longs, fade with caution.',
  },
  liquidations: {
    label: 'Liquidations',
    definition: 'Forced closes of leveraged positions when margin breached.',
    range: '$ millions–$ billions per event.',
    howToUse: 'Long liquidation cascade = quick capitulation low (often a buy). Short cascade = blow-off top (often a sell).',
  },
  realizedVol: {
    label: 'Realized Volatility',
    definition: 'Historical annualised standard deviation of daily returns.',
    range: 'Same as IV scale (5%–150%).',
    howToUse: 'Compare IV vs realized — IV > RV by wide margin = expensive premium (sell). IV < RV = cheap premium (buy).',
  },

  // -------- Macro Gates --------
  dxyGate: {
    label: 'DXY Gate',
    definition: 'Dollar Index filter — blocks long signals on dollar-sensitive sectors when DXY trending up sharply.',
    range: 'Boolean (pass/fail).',
    howToUse: 'Active for emerging markets, commodities, gold. When DXY rising and gate fails, skip new longs in affected sectors.',
  },
  yieldCurveGate: {
    label: 'Yield Curve Gate',
    definition: 'Blocks new longs when 2Y/10Y inversion is deep and persistent (recession leading indicator).',
    range: 'Boolean (pass/fail).',
    howToUse: 'When deeply inverted (>50bps) for >3 months, reduce equity allocation. Curve un-inverting is a recession-onset signal historically.',
  },
}

export function getMetric(key: string): MetricMeta | null {
  return METRIC_GLOSSARY[key] ?? null
}
