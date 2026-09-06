import { writeFileSync, mkdirSync, readFileSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { WINDOW_START, assessRefresh, seriesFingerprint } from './lib/dataVintage.mjs';

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
// PERIOD_DAYS is retained only for the log line and the BTC path's shape.
// The WINDOW START IS PINNED (Q-102): `new Date(Date.now() - PERIOD_DAYS * ...)`
// re-anchored the window every run, so the oldest bars silently dropped out each
// week and no past benchmark run could be reproduced. Observed 2026-08-21:
// regenerating five days after the committed run moved totalBuySignals
// 3410 -> 3394 with no code change. A pinned start makes the history
// append-only in practice — new bars arrive, old bars never vanish.
const PERIOD_DAYS = 1825; // 5 years — descriptive now, not the anchor

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

  // ── Q-102: a restatement is a DATA EVENT, not signal drift ───────────────
  //
  // The previous save overwrote the whole series unconditionally, so a vendor
  // revising a 2023 close was absorbed silently and surfaced later as a moved
  // win rate. Appends are normal and pass; a changed or vanished historical bar
  // fails closed (I2) so a human sees it before it reaches a benchmark.
  let vintage = { appended: candles.length, restated: 0, missing: 0, finalized: 0 };
  if (existsSync(filePath)) {
    try {
      const prev = JSON.parse(readFileSync(filePath, 'utf8'));
      // Valid JSON of the WRONG SHAPE is the residual fail-open: assessRefresh
      // called with `undefined` reports every incoming bar as an append and
      // returns ok, so a fixture whose `candles` key was lost would be silently
      // overwritten by a guard that believes it checked something. Found by
      // probing the function directly rather than by reading it.
      if (!Array.isArray(prev.candles) || prev.candles.length === 0) {
        throw new Error(
          `REFUSED to save ${ticker}: existing fixture has no usable candles array, so a refresh cannot be ` +
            'proven to be append-only. Repair or delete the fixture deliberately.',
        );
      }
      const verdict = assessRefresh(prev.candles, candles);
      vintage = { appended: verdict.appended, restated: verdict.restated, missing: verdict.missing, finalized: verdict.finalized };
      if (!verdict.ok) {
        throw new Error(`REFUSED to save ${ticker}: ${verdict.reasons.join(' | ')}`);
      }
      if (verdict.appended > 0 || verdict.finalized > 0) {
        const fin = verdict.finalized > 0 ? `, ${verdict.finalized} volume finalization(s)` : '';
        console.log(`[${ticker}] +${verdict.appended} new bar(s), 0 restated${fin}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('REFUSED')) throw e;
      // FAIL CLOSED. This used to warn and continue, which meant an unreadable
      // fixture SKIPPED the restatement check entirely and the fresh series
      // overwrote it unverified — a guard whose whole purpose is I2 fail-closed,
      // failing open on the one input it cannot evaluate. If the vintage cannot
      // be established, that is exactly when overwriting is least safe.
      throw new Error(
        `REFUSED to save ${ticker}: existing fixture could not be read for the vintage check (${e.message}). ` +
          'Cannot prove this refresh only appends. Repair or delete the fixture deliberately.',
      );
    }
  }

  const output = {
    ticker,
    sector,
    fetchedAt: new Date().toISOString(),
    // Vintage identity: the window this series claims to cover and a
    // fingerprint of its contents. Without these a "reproducible" run is a
    // claim nobody can check.
    windowStart: WINDOW_START,
    fingerprint: seriesFingerprint(candles),
    rows: candles.length,
    vintage,
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

// 2026-07-11 (data-integrity, Patterson lens): the LAST bar of a fetch can be
// a still-forming intraday bar whose running close drifts outside the recorded
// high/low (seen live: BTC 2026-07-05 close 63682 > high 63632). Downstream
// intrabar logic (evaluateStopHit) relies on low ≤ open,close ≤ high, so an
// inconsistent partial bar can imply impossible fills. Clamp ONLY the final
// bar — a historical bar violating the invariant should fail loudly instead
// (scripts/verify-data-integrity.mjs).
function clampPartialFinalBar(candles, ticker) {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const high = Math.max(last.high, last.open, last.close);
  const low = Math.min(last.low, last.open, last.close);
  if (high !== last.high || low !== last.low) {
    console.warn(`[${ticker}] clamped partial final bar: high ${last.high}→${high}, low ${last.low}→${low}`);
    candles[candles.length - 1] = { ...last, high, low };
  }
  return candles;
}

async function fetchYahoo(ticker, sector) {
  const result = await yf.chart(ticker, {
    period1: new Date(WINDOW_START),
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

  saveResult(ticker, sector, clampPartialFinalBar(candles, ticker));
  const dropped = rawRows.length - candles.length;
  console.log(`[${ticker}] Saved ${candles.length} candles${dropped > 0 ? ` (dropped ${dropped} non-finite rows)` : ''}${divByDay.size > 0 ? ` (+${divByDay.size} dividend bars)` : ''}`);
}

async function fetchBTC(sector = 'Crypto') {
  // Use Yahoo Finance BTC-USD (supports full 5-year history)
  const result = await yf.chart('BTC-USD', {
    period1: new Date(WINDOW_START),
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

  saveResult('BTC', sector, clampPartialFinalBar(candles, 'BTC'));
  const dropped = rawRows.length - candles.length;
  console.log(`[BTC] Saved ${candles.length} candles${dropped > 0 ? ` (dropped ${dropped} non-finite rows)` : ''}`);
}

async function main() {
  console.log(`Fetching ${PERIOD_DAYS}-day daily OHLCV for ${TICKERS.length} stocks + BTC...\n`);

  let success = 0;
  let failed  = 0;
  /**
   * QUARANTINED, not failed.
   *
   * A ticker the vintage guard REFUSED is in a different state from one whose
   * fetch broke: its existing fixture is intact and untouched, and every other
   * ticker's write is verified append-only. Folding both into `failed` meant one
   * disputed bar discarded FIFTY-FIVE clean refreshes, every week, because the
   * workflow gates its commit on `success()`. Measured on the real tree: 55 clean,
   * 1 quarantined (BTC, a 1.9e-5 relative move in a daily open), and the whole
   * batch was thrown away.
   */
  const quarantined = [];

  const run = async (label, fn) => {
    try {
      await fn();
      success++;
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (msg.startsWith('REFUSED')) {
        console.error(`::warning title=Quarantined ${label}::${msg}`);
        quarantined.push(label);
      } else {
        console.error(`[${label}] ERROR: ${msg}`);
        failed++;
      }
    }
  };

  for (const { ticker, sector } of TICKERS) await run(ticker, () => fetchYahoo(ticker, sector));
  await run('BTC', fetchBTC);

  console.log(`\nDone. Success: ${success}  |  Quarantined: ${quarantined.length}  |  Failed: ${failed}`);

  // THREE outcomes, because two were not enough.
  //
  //   1  a real failure — a fetch broke or returned degraded data. Nothing should
  //      be committed; the tree may be inconsistent.
  //   2  every instrument either refreshed cleanly or was QUARANTINED by the
  //      vintage guard. Each written fixture is verified append-only, so the run
  //      SHOULD commit — and must still end RED, because a quarantine is a data
  //      event a human has to look at.
  //   0  all clean.
  //
  // Collapsing 2 into 1 is what deadlocked the pipeline: the refused ticker keeps
  // the stale value that next week's fetch will disagree with again, so the batch
  // never recovers on its own.
  if (failed > 0) {
    console.error(`\nFAIL: ${failed} instrument(s) did not refresh cleanly — see [TICKER] ERROR lines above. Refusing to exit 0.`);
    process.exit(1);
  }
  // Export the quarantined set so LATER GATES can tell "deliberately held back"
  // from "the fetch failed". Without this the freshness check downstream sees a
  // quarantined ticker as a stale fixture, exits 1, and the commit step is
  // skipped — which discards all 55 clean refreshes and reproduces, one gate
  // over, exactly the amplifier the exit-code split was written to remove.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `quarantined=${quarantined.join(',')}\n`);
  }

  if (quarantined.length > 0) {
    console.error(
      `\nQUARANTINED: ${quarantined.join(', ')} — existing fixture(s) kept, ${success} other instrument(s) refreshed cleanly ` +
        'and ARE safe to commit. Investigate the named bars; this run is red on purpose.',
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
