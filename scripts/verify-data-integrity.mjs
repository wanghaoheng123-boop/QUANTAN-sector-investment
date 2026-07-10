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
 *
 * Wired into `npm run verify:data` so CI and the weekly sweep run it.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
  const c = d.candles ?? [];
  const ticker = d.ticker ?? f.replace('.json', '');
  const isCrypto = (d.sector ?? '').toLowerCase() === 'crypto' || ticker.startsWith('BTC');
  files++;
  rows += c.length;

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

console.log(`\nverify-data-integrity: ${files} files, ${rows} rows — ${hardFailures} hard failure(s), ${warnings} warning(s)`);
if (hardFailures > 0) process.exit(1);
console.log('All data-integrity checks passed.');
