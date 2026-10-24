import { writeFileSync, mkdirSync, readFileSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { WINDOW_START } from './lib/dataVintage.mjs';
import { planSave } from './lib/planSave.mjs';
import { TICKERS } from './lib/universe.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const YahooFinance = (await import('yahoo-finance2')).default;
const yf = new YahooFinance();


const OUTPUT_DIR = path.resolve(__dirname, 'backtestData');
// PERIOD_DAYS is retained only for the log line and the BTC path's shape.
// The WINDOW START IS PINNED (Q-102): `new Date(Date.now() - PERIOD_DAYS * ...)`
// re-anchored the window every run, so the oldest bars silently dropped out each
// week and no past benchmark run could be reproduced. Observed 2026-08-21:
// regenerating five days after the committed run moved totalBuySignals
// 3410 -> 3394 with no code change. A pinned start makes the history
// append-only in practice — new bars arrive, old bars never vanish.
const PERIOD_DAYS = 1825; // 5 years — descriptive now, not the anchor

mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Persist a fixture, refusing to overwrite a good file with a degraded fetch, a
 * restated history, or a fixture the vintage check cannot read. Every decision
 * is in `planSave` (scripts/lib/planSave.mjs), which is pure and tested; this
 * function only does the I/O. Throws `REFUSED …`; main() quarantines the ticker
 * and the data-refresh workflow goes RED (not a silent green commit).
 */
function saveResult(ticker, sector, candles) {
  const filePath = path.join(OUTPUT_DIR, `${ticker}.json`);
  let prev;
  if (existsSync(filePath)) {
    try {
      prev = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      // FAIL CLOSED. An unreadable fixture used to SKIP the restatement check
      // and be overwritten unverified. If the vintage cannot be established,
      // that is exactly when overwriting is least safe.
      throw new Error(
        `REFUSED to save ${ticker}: existing fixture could not be read for the vintage check (${e.message}). ` +
          'Cannot prove this refresh only appends. Repair or delete the fixture deliberately.',
      );
    }
  }
  const plan = planSave({ ticker, sector, prev, candles, nowMs: Date.now() });
  if (!plan.ok) throw new Error(plan.reason);
  for (const line of plan.log) console.log(line);
  writeFileSync(filePath, JSON.stringify(plan.doc, null, 2), 'utf8');
  return plan.doc.rows;
}

/**
 * Phase 14 wave 22: filter out illiquid / missing-data rows so the saved JSON
 * files contain only finite-OHLCV entries. Yahoo returns nulls for holiday
 * rows and brief outage minutes; saving them propagates NaN downstream
 * through any consumer that doesn't apply the exact filter that
 * `optimize-grid.ts:79–82` does.
 *
 * Q144-R2-4: volume is required too. A null volume used to be stored as 0, and
 * a later fill of that bar is then an infinite relative change, refused every
 * week. 0 of 72,941 stored bars had volume 0 (2026-10-18), so no stored bar
 * came from that path; a row the vendor has not finished publishing is now not
 * stored at all, and is appended once it is.
 */
function isFiniteRow(q) {
  return (
    Number.isFinite(q.open) &&
    Number.isFinite(q.high) &&
    Number.isFinite(q.low) &&
    Number.isFinite(q.close) &&
    Number.isFinite(q.volume)
  );
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
      volume: q.volume,
      ...(dividend ? { dividend } : {}),
    };
  });

  const rows = saveResult(ticker, sector, candles);
  const dropped = rawRows.length - candles.length;
  console.log(`[${ticker}] Saved ${rows} candles${dropped > 0 ? ` (dropped ${dropped} non-finite rows)` : ''}${divByDay.size > 0 ? ` (+${divByDay.size} dividend bars)` : ''}`);
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
    volume: q.volume,
  }));

  const rows = saveResult('BTC', sector, candles);
  const dropped = rawRows.length - candles.length;
  console.log(`[BTC] Saved ${rows} candles${dropped > 0 ? ` (dropped ${dropped} non-finite rows)` : ''}`);
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
