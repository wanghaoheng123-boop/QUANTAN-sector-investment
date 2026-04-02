import { writeFileSync, mkdirSync } from 'fs';
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

mkdirSync(OUTPUT_DIR, { recursive: true });

function saveResult(ticker, sector, candles) {
  const output = {
    ticker,
    sector,
    fetchedAt: new Date().toISOString(),
    candles,
  };
  const filePath = path.join(OUTPUT_DIR, `${ticker}.json`);
  writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf8');
}

async function fetchYahoo(ticker, sector) {
  const result = await yf.chart(ticker, {
    period1: new Date(Date.now() - PERIOD_DAYS * 86400000),
    interval: '1d',
  });

  const candles = (result.quotes || []).map((q) => ({
    time: Math.floor(new Date(q.date).getTime() / 1000),
    open:   q.open,
    high:   q.high,
    low:    q.low,
    close:  q.close,
    volume: q.volume,
  }));

  saveResult(ticker, sector, candles);
  console.log(`[${ticker}] Saved ${candles.length} candles`);
}

async function fetchBTC(sector = 'Crypto') {
  // Use Yahoo Finance BTC-USD (supports full 5-year history)
  const result = await yf.chart('BTC-USD', {
    period1: new Date(Date.now() - PERIOD_DAYS * 86400000),
    interval: '1d',
  });

  const candles = (result.quotes || []).map((q) => ({
    time:  Math.floor(new Date(q.date).getTime() / 1000),
    open:   q.open,
    high:   q.high,
    low:    q.low,
    close:  q.close,
    volume: q.volume ?? 0,
  }));

  saveResult('BTC', sector, candles);
  console.log(`[BTC] Saved ${candles.length} candles`);
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
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
