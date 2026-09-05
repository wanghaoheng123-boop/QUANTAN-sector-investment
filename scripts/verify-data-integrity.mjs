/**
 * Data-integrity verifier (2026-07-11, Patterson lens — "most of our time goes
 * into data cleaning"). Scans scripts/backtestData/*.json for structural
 * violations that silently corrupt downstream math:
 *
 *   HARD FAIL (exit 1):
 *     - duplicate timestamps
 *     - non-monotonic time
 *     - OHLC invariant broken (low ≤ open,close ≤ high) on any NON-FINAL bar
 *       (the final bar may be a still-forming partial — the fetch script clamps
 *       it going forward; tolerated here for fixtures fetched before the clamp)
 *     - calendar gap > 5 days between consecutive EQUITY bars
 *     - zero-volume equity bars
 *
 *   WARN (reported, exit 0):
 *     - single-day |close/close - 1| > 35% moves not in KNOWN_EVENTS
 *       (split artifacts look like this; real crashes belong in KNOWN_EVENTS)
 *     - final-bar OHLC clamp candidates
 *     - a session missing from ONE equity while its peers all have it
 *       (Q110-D1: the per-ticker gap rule above cannot see a one-day hole —
 *       Thu -> Mon is four days and passes the >5 threshold. Only comparing
 *       tickers to each other finds it.)
 *
 * Wired into `npm run verify:data` so CI and the weekly sweep run it.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { detectTickerHandover, DEFAULT_SIGMAS } from './lib/handoverDetect.mjs';
import { findSessionHoles, DEFAULT_QUORUM } from './lib/sessionCoverage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'backtestData');

// Verified genuine market events (not data artifacts). Format: TICKER|YYYY-MM-DD.
const KNOWN_EVENTS = new Set([
  'NFLX|2022-04-20', // -35% post-earnings crash (subscriber loss) — verified real
]);

if (!existsSync(dataDir)) {
  console.error('No backtestData directory.');
  process.exit(1);
}

let files = 0;
let rows = 0;
let hardFailures = 0;
let warnings = 0;

/**
 * Q110-D1 (2026-09-05) — cross-ticker session coverage.
 *
 * The per-ticker rule above fails on a calendar gap > 5 days between CONSECUTIVE
 * bars. A single missing session cannot trip it: 2026-07-30 (Thu) -> 2026-08-03
 * (Mon) is four days, so EQIX sat one bar short of every peer — 1253 against
 * 1254 — and every check in this file passed. A hole that small is invisible
 * from inside one series and obvious the moment you compare series.
 *
 * This is a DETECTION change and deliberately nothing more. The fix for a
 * missing bar is to refetch it; fabricating or forward-filling one would cross
 * the boundary I3 exists to defend, and a backtest silently computed on a
 * different calendar from its peers is exactly the failure this repo's PRIME
 * DIRECTIVE calls worse than saying "I don't know".
 */
const equityDates = new Map(); // ticker -> Set<YYYY-MM-DD>

for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
  const c = d.candles ?? [];
  const ticker = d.ticker ?? f.replace('.json', '');
  const isCrypto = (d.sector ?? '').toLowerCase() === 'crypto' || ticker.startsWith('BTC');
  files++;
  rows += c.length;

  // Q110-D1 — record this equity's sessions for the cross-ticker check at the
  // end. Crypto trades a 365-day calendar and would poison the quorum, so it is
  // excluded rather than special-cased downstream.
  if (!isCrypto) {
    equityDates.set(
      ticker,
      new Set(c.map((r) => new Date(r.time * 1000).toISOString().slice(0, 10))),
    );
  }

  // I6 — the check this verifier was explicitly missing. A reassigned ticker
  // continues with no missing bars and no malformed rows, so every other check
  // here passes while two issuers are spliced into one history. WARN, not FAIL:
  // a genuine gap or an unadjusted split looks the same, so this asks a human to
  // explain the bar rather than asserting what it is.
  const handovers = detectTickerHandover(
    c.map((r) => r.close),
    c.map((r) => new Date(r.time * 1000).toISOString().slice(0, 10)),
  );
  for (const h of handovers) {
    console.warn(
      `WARN [${ticker}] unexplained ${h.gapRatio}x move on ${h.date} ` +
        `(> ${DEFAULT_SIGMAS} sigma) — split, halt, or TICKER HANDOVER? I6 requires an explanation.`,
    );
    warnings++;
  }

  const seen = new Set();
  for (let i = 0; i < c.length; i++) {
    const r = c[i];
    const day = new Date(r.time * 1000).toISOString().slice(0, 10);
    const isFinal = i === c.length - 1;

    if (seen.has(r.time)) {
      console.error(`FAIL [${ticker}] duplicate timestamp ${day}`);
      hardFailures++;
    }
    seen.add(r.time);

    if (i > 0) {
      if (r.time <= c[i - 1].time) {
        console.error(`FAIL [${ticker}] non-monotonic time at ${day}`);
        hardFailures++;
      }
      const gapDays = (r.time - c[i - 1].time) / 86400;
      if (!isCrypto && gapDays > 5) {
        console.error(`FAIL [${ticker}] ${gapDays.toFixed(1)}-day gap ending ${day}`);
        hardFailures++;
      }
      const move = Math.abs(r.close / c[i - 1].close - 1);
      if (move > 0.35 && !KNOWN_EVENTS.has(`${ticker}|${day}`)) {
        console.warn(`WARN [${ticker}] ${(move * 100).toFixed(1)}% single-day move on ${day} — split artifact? verify + add to KNOWN_EVENTS if genuine`);
        warnings++;
      }
    }

    const ohlcOk = r.low <= r.open && r.low <= r.close && r.high >= r.open && r.high >= r.close;
    if (!ohlcOk) {
      if (isFinal) {
        console.warn(`WARN [${ticker}] final-bar OHLC inconsistency on ${day} (partial fetch bar; clamped on next refresh)`);
        warnings++;
      } else {
        console.error(`FAIL [${ticker}] OHLC invariant broken on ${day}`);
        hardFailures++;
      }
    }

    if (!isCrypto && r.volume === 0) {
      console.error(`FAIL [${ticker}] zero-volume bar on ${day}`);
      hardFailures++;
    }
  }
}

// ── Q110-D1: sessions present across the universe but absent from one name ──
{
  const { sessions, holes } = findSessionHoles(equityDates, DEFAULT_QUORUM);
  const universe = equityDates.size;

  if (universe > 1 && sessions.length === 0) {
    // Reachability: an empty consensus calendar would make every hole check
    // below vacuous, which is how a guard goes green at zero instances.
    console.error('FAIL [coverage] no session reached quorum — the check cannot fire');
    hardFailures++;
  }

  for (const { ticker, missing } of holes) {
    const shown = missing.slice(0, 5).join(', ');
    console.warn(
      `WARN [${ticker}] missing ${missing.length} session(s) that >=${Math.ceil(universe * DEFAULT_QUORUM)} of ` +
        `${universe} equities have: ${shown}${missing.length > 5 ? ', …' : ''} — refetch; do NOT fill`,
    );
    warnings++;
  }
}

console.log(`\nverify-data-integrity: ${files} files, ${rows} rows — ${hardFailures} hard failure(s), ${warnings} warning(s)`);
if (hardFailures > 0) process.exit(1);
console.log('All data-integrity checks passed.');
