/**
 * Backfill sessions a fixture is missing, and NOTHING else.
 *
 * Q110-D1 (2026-09-06) — `scripts/lib/sessionCoverage.mjs` found that EQIX was
 * missing 2026-07-31 while all 55 peers had it, and a vendor probe confirmed the
 * bar exists upstream: the hole is ours, not theirs. Detection without a repair
 * path just accumulates warnings, so this is the repair path.
 *
 * It is deliberately NOT `fetchBacktestData.mjs`. That script rewrites every
 * instrument's entire history in place every run, which design invariant I4
 * names as the reason benchmark floors are non-reproducible. Repairing one
 * missing bar should not reopen 70,000 rows.
 *
 * THE SAFETY PROPERTY, and it is the whole point: a write happens ONLY when the
 * refetched series is a strict SUPERSET of the committed one — every existing
 * bar byte-identical, and only the detected holes added. Anything else is a
 * RESTATEMENT, which is a different event needing a human, and this script
 * refuses it rather than quietly adopting the vendor's new numbers.
 *
 *   node scripts/backfill-missing-sessions.mjs           # report only
 *   node scripts/backfill-missing-sessions.mjs --write   # apply, if safe
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { findSessionHoles, DEFAULT_QUORUM } from './lib/sessionCoverage.mjs';
import { WINDOW_START } from './lib/dataVintage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'backtestData');
const WRITE = process.argv.includes('--write');

/** Vendor float noise: compare to the precision the fixtures actually carry. */
const same = (a, b) => {
  if (typeof a !== 'number' || typeof b !== 'number') return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-9);
};
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));
const byTicker = new Map();
const meta = new Map();
for (const f of files) {
  const d = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
  const ticker = d.ticker ?? f.replace('.json', '');
  if ((d.sector ?? '').toLowerCase() === 'crypto' || ticker.startsWith('BTC')) continue;
  meta.set(ticker, { file: f, doc: d });
  byTicker.set(ticker, new Set((d.candles ?? []).map((c) => day(c.time))));
}

const { holes } = findSessionHoles(byTicker, DEFAULT_QUORUM);
if (holes.length === 0) {
  console.log('backfill: no missing sessions detected. Nothing to do.');
  process.exit(0);
}
console.log(`backfill: ${holes.length} instrument(s) with holes${WRITE ? '' : ' (report only — pass --write to apply)'}`);

const YahooFinance = (await import('yahoo-finance2')).default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

let repaired = 0;
let refused = 0;
for (const { ticker, missing } of holes) {
  const { file, doc } = meta.get(ticker);
  console.log(`\n[${ticker}] missing ${missing.length}: ${missing.join(', ')}`);

  const res = await yf.chart(ticker, { period1: new Date(WINDOW_START), interval: '1d' });
  const divByDay = new Map();
  for (const d of res.events?.dividends ?? []) {
    const k = new Date(d.date).toISOString().slice(0, 10);
    const amt = Number(d.amount);
    if (Number.isFinite(amt) && amt > 0) divByDay.set(k, (divByDay.get(k) ?? 0) + amt);
  }
  const fetched = (res.quotes ?? [])
    .filter((q) => ['open', 'high', 'low', 'close'].every((k) => Number.isFinite(q[k])))
    .map((q) => {
      const dividend = divByDay.get(new Date(q.date).toISOString().slice(0, 10));
      return {
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: q.open, high: q.high, low: q.low, close: q.close,
        volume: Number.isFinite(q.volume) ? q.volume : 0,
        ...(dividend ? { dividend } : {}),
      };
    });
  const fetchedByDay = new Map(fetched.map((c) => [day(c.time), c]));

  // ── The safety property: every EXISTING bar must be unchanged. ─────────────
  const restated = [];
  for (const c of doc.candles ?? []) {
    const f = fetchedByDay.get(day(c.time));
    if (!f) continue; // vendor no longer serves it; not this script's business
    for (const k of ['open', 'high', 'low', 'close', 'volume', 'dividend']) {
      if (!same(c[k] ?? 0, f[k] ?? 0)) { restated.push(`${day(c.time)}.${k}`); break; }
    }
  }
  if (restated.length > 0) {
    console.error(
      `  REFUSED: the refetch RESTATES ${restated.length} existing bar(s) ` +
        `(${restated.slice(0, 5).join(', ')}${restated.length > 5 ? ', …' : ''}). ` +
        'A restatement is a different event from a hole and needs a human. Nothing written.',
    );
    refused++;
    continue;
  }

  const additions = missing.map((d) => fetchedByDay.get(d)).filter(Boolean);
  if (additions.length !== missing.length) {
    const absent = missing.filter((d) => !fetchedByDay.has(d));
    console.error(`  REFUSED: the vendor does not serve ${absent.join(', ')} either. Nothing written.`);
    refused++;
    continue;
  }

  const merged = [...(doc.candles ?? []), ...additions].sort((a, b) => a.time - b.time);
  console.log(`  OK: pure insertion, ${doc.candles.length} -> ${merged.length} bars, no existing bar changed.`);
  if (WRITE) {
    // PROVENANCE. `fetchedAt` is left alone because it accurately dates the BULK
    // of the series, and overwriting it would claim the whole file was refetched
    // today when only these bars were. The repair records itself instead — I1's
    // spirit at the fixture level: a number should carry where it came from.
    const prior = Array.isArray(doc.backfills) ? doc.backfills : [];
    const out = {
      ...doc,
      backfills: [...prior, { at: new Date().toISOString(), sessions: missing, tool: 'scripts/backfill-missing-sessions.mjs' }],
      candles: merged,
    };
    writeFileSync(path.join(dataDir, file), JSON.stringify(out, null, 2) + '\n');
    console.log('  written, with a backfill provenance record.');
  }
  repaired++;
}

console.log(`\nbackfill: ${repaired} repairable, ${refused} refused${WRITE ? '' : ' (dry run)'}`);
if (refused > 0) process.exit(1);
