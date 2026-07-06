import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const YahooFinance = (await import('yahoo-finance2')).default;
const yf = new YahooFinance();

const TICKERS = [
  { ticker: 'NVDA',  sector: 'Technology'      },
  { ticker: 'MSFT',  sector: 'Technology'      },
  { ticker: 'AAPL',  sector: 'Technology'      },
  { ticker: 'AVGO',  sector: 'Technology'      },
  { ticker: 'AMD',   sector: 'Technology'      },
  { ticker: 'XOM',   sector: 'Energy'          },
  { ticker: 'CVX',   sector: 'Energy'          },
  { ticker: 'COP',   sector: 'Energy'          },
  { ticker: 'EOG',   sector: 'Energy'          },
  { ticker: 'SLB',   sector: 'Energy'          },
  { ticker: 'BRK-B', sector: 'Financials'      },
  { ticker: 'JPM',   sector: 'Financials'      },
  { ticker: 'V',     sector: 'Financials'      },
  { ticker: 'MA',    sector: 'Financials'      },
  { ticker: 'BAC',   sector: 'Financials'      },
  { ticker: 'LLY',   sector: 'Healthcare'      },
  { ticker: 'UNH',   sector: 'Healthcare'      },
  { ticker: 'JNJ',   sector: 'Healthcare'      },
  { ticker: 'ABBV',  sector: 'Healthcare'      },
  { ticker: 'MRK',   sector: 'Healthcare'      },
  { ticker: 'AMZN',  sector: 'Consumer Disc.'  },
  { ticker: 'TSLA',  sector: 'Consumer Disc.'  },
  { ticker: 'HD',    sector: 'Consumer Disc.'  },
  { ticker: 'MCD',   sector: 'Consumer Disc.'  },
  { ticker: 'NKE',   sector: 'Consumer Disc.'  },
  { ticker: 'GE',    sector: 'Industrials'     },
  { ticker: 'RTX',   sector: 'Industrials'     },
  { ticker: 'CAT',   sector: 'Industrials'     },
  { ticker: 'UNP',   sector: 'Industrials'     },
  { ticker: 'HON',   sector: 'Industrials'     },
  { ticker: 'META',  sector: 'Communication'  },
  { ticker: 'GOOGL', sector: 'Communication'  },
  { ticker: 'NFLX',  sector: 'Communication'  },
  { ticker: 'DIS',   sector: 'Communication'  },
  { ticker: 'T',     sector: 'Communication'  },
  { ticker: 'LIN',   sector: 'Materials'       },
  { ticker: 'APD',   sector: 'Materials'       },
  { ticker: 'FCX',   sector: 'Materials'       },
  { ticker: 'NEM',   sector: 'Materials'       },
  { ticker: 'DOW',   sector: 'Materials'       },
  { ticker: 'NEE',   sector: 'Utilities'       },
  { ticker: 'SO',    sector: 'Utilities'       },
  { ticker: 'DUK',   sector: 'Utilities'       },
  { ticker: 'AEP',   sector: 'Utilities'       },
  { ticker: 'PCG',   sector: 'Utilities'       },
  { ticker: 'PLD',   sector: 'Real Estate'     },
  { ticker: 'AMT',   sector: 'Real Estate'     },
  { ticker: 'EQIX',  sector: 'Real Estate'     },
  { ticker: 'WELL',  sector: 'Real Estate'     },
  { ticker: 'SPG',   sector: 'Real Estate'     },
  { ticker: 'PG',    sector: 'Consumer Staples'},
  { ticker: 'COST',  sector: 'Consumer Staples'},
  { ticker: 'WMT',   sector: 'Consumer Staples'},
  { ticker: 'PEP',   sector: 'Consumer Staples'},
  { ticker: 'KO',    sector: 'Consumer Staples'},
];

const OUTPUT_DIR = path.resolve(__dirname, 'backtestData');
const PERIOD_DAYS = 1825; // 5 years

// ── Fixture integrity floors (R2 mitigation) ──────────────────────────────
// The benchmark needs >= 252 rows per instrument (200-bar warmup + signal
// window). A degraded Yahoo response (rate-limit, partial outage, holiday
// gaps) can return a short series; without a guard, saveResult() would
// silently overwrite a good 5Y fixture with the truncated one, the
// benchmark's `>= 252` filter would drop the instrument, and the WR floor
// would mask the loss as "signal drift" instead of "data corruption".
const MIN_ABSOLUTE_ROWS = 252; // hard floor: unusable below this
const MAX_SHRINK_PCT = 0.05; // refuse a >5% drop vs the existing fixture

mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Persist a fixture, refusing to overwrite a good file with a degraded fetch.
 * Throws on a floor violation; the caller counts the failure and main() exits
 * non-zero so the data-refresh workflow goes RED (not a silent green commit).
 */
function saveResult(ticker, sector, candles) {
  const filePath = path.join(OUTPUT_DIR, `${ticker}.json`);

  if (candles.length < MIN_ABSOLUTE_ROWS) {
    throw new Error(
      `REFUSED to save ${ticker}: ${candles.length} rows < absolute floor ${MIN_ABSOLUTE_ROWS} (degraded fetch — keeping existing fixture)`,
    );
  }

  if (existsSync(filePath)) {
    try {
      const prev = JSON.parse(readFileSync(filePath, 'utf8'));
      const prevCount = Array.isArray(prev.candles) ? prev.candles.length : 0;
      if (prevCount > 0 && candles.length < prevCount * (1 - MAX_SHRINK_PCT)) {
        throw new Error(
          `REFUSED to save ${ticker}: ${candles.length} rows is >${MAX_SHRINK_PCT * 100}% below existing ${prevCount} (likely a degraded fetch — keeping existing fixture)`,
        );
      }
    } catch (e) {
      // A genuine floor violation re-throws; a corrupt/unreadable existing
      // file should NOT block a healthy new fetch (>= MIN_ABSOLUTE_ROWS).
      if (e instanceof Error && e.message.startsWith('REFUSED')) throw e;
      console.warn(`[${ticker}] existing fixture unreadable (${e.message}); proceeding with fresh ${candles.length}-row save`);
    }
  }

  const output = {
    ticker,
    sector,
    fetchedAt: new Date().toISOString(),
    candles,
  };
  writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf8');
}

/**
 * Phase 14 wave 22: filter out illiquid / missing-data rows so the saved JSON
 * files contain only finite-OHLC entries. Yahoo returns nulls for holiday
 * rows and brief outage minutes; saving them propagates NaN downstream
 * through any consumer that doesn't apply the exact filter that
 * `optimize-grid.ts:79–82` does.
 */
function isFiniteRow(q) {
  return (
    Number.isFinite(q.open) &&
    Number.isFinite(q.high) &&
    Number.isFinite(q.low) &&
    Number.isFinite(q.close)
  );
}

async function fetchYahoo(ticker, sector) {
  const result = await yf.chart(ticker, {
    period1: new Date(Date.now() - PERIOD_DAYS * 86400000),
    interval: '1d',
  });

  const rawRows = result.quotes || [];
  // F1.5: chart() returns dividend events by default (events: 'div|split|earn').
  // Attach the cash dividend to its ex-date bar so the dividend-aware
  // total-return B&H in lib/backtest/core.ts (computeBuyAndHoldReturn) has
  // data to work with — without this field the fix is inert.
  const divByDay = new Map();
  for (const d of result.events?.dividends ?? []) {
    const day = new Date(d.date).toISOString().slice(0, 10);
    const amount = Number(d.amount);
    if (Number.isFinite(amount) && amount > 0) {
      divByDay.set(day, (divByDay.get(day) ?? 0) + amount);
    }
  }
  const candles = rawRows.filter(isFiniteRow).map((q) => {
    const dividend = divByDay.get(new Date(q.date).toISOString().slice(0, 10));
    return {
      time: Math.floor(new Date(q.date).getTime() / 1000),
      open:   q.open,
      high:   q.high,
      low:    q.low,
      close:  q.close,
      volume: Number.isFinite(q.volume) ? q.volume : 0,
      ...(dividend ? { dividend } : {}),
    };
  });

  saveResult(ticker, sector, candles);
  const dropped = rawRows.length - candles.length;
  console.log(`[${ticker}] Saved ${candles.length} candles${dropped > 0 ? ` (dropped ${dropped} non-finite rows)` : ''}${divByDay.size > 0 ? ` (+${divByDay.size} dividend bars)` : ''}`);
}

async function fetchBTC(sector = 'Crypto') {
  // Use Yahoo Finance BTC-USD (supports full 5-year history)
  const result = await yf.chart('BTC-USD', {
    period1: new Date(Date.now() - PERIOD_DAYS * 86400000),
    interval: '1d',
  });

  const rawRows = result.quotes || [];
  const candles = rawRows.filter(isFiniteRow).map((q) => ({
    time:  Math.floor(new Date(q.date).getTime() / 1000),
    open:   q.open,
    high:   q.high,
    low:    q.low,
    close:  q.close,
    volume: Number.isFinite(q.volume) ? q.volume : 0,
  }));

  saveResult('BTC', sector, candles);
  const dropped = rawRows.length - candles.length;
  console.log(`[BTC] Saved ${candles.length} candles${dropped > 0 ? ` (dropped ${dropped} non-finite rows)` : ''}`);
}

async function main() {
  console.log(`Fetching ${PERIOD_DAYS}-day daily OHLCV for ${TICKERS.length} stocks + BTC...\n`);

  let success = 0;
  let failed  = 0;

  for (const { ticker, sector } of TICKERS) {
    try {
      await fetchYahoo(ticker, sector);
      success++;
    } catch (err) {
      console.error(`[${ticker}] ERROR: ${err.message}`);
      failed++;
    }
  }

  try {
    await fetchBTC();
    success++;
  } catch (err) {
    console.error(`[BTC] ERROR: ${err.message}`);
    failed++;
  }

  console.log(`\nDone. Success: ${success}  |  Failed: ${failed}`);

  // R2 mitigation: surface any failed/refused ticker as a non-zero exit so the
  // refresh-data workflow goes RED and does NOT auto-commit a partial refresh.
  // Good fixtures still updated above; the integrity guard kept degraded ones
  // intact. The operator investigates the named failures before re-running.
  if (failed > 0) {
    console.error(`\nFAIL: ${failed} instrument(s) did not refresh cleanly — see [TICKER] ERROR lines above. Refusing to exit 0.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
