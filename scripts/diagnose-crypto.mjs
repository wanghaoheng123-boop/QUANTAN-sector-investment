/**
 * End-to-end checks for crypto data sources (no Next required).
 * Run: node scripts/diagnose-crypto.mjs
 * Optional: VERIFY_APP_BASE_URL=http://127.0.0.1:3000
 */
const BINANCE = 'https://api.binance.com'
const KRAKEN = 'https://api.kraken.com/0/public/OHLC'
const COINGECKO_OHLC = 'https://api.coingecko.com/api/v3/coins/bitcoin/ohlc'
const COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price'

async function head(name, fn) {
  process.stdout.write(`  ${name} … `)
  try {
    const r = await fn()
    console.log(r.ok ? `OK — ${r.detail}` : `FAIL — ${r.detail}`)
    return r.ok
  } catch (e) {
    console.log('FAIL —', e?.message ?? e)
    return false
  }
}

async function main() {
  console.log('Crypto connectivity simulation\n')

  const b = await head('Binance klines (BTCUSDT 1d x3)', async () => {
    const res = await fetch(`${BINANCE}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=3`, {
      headers: { Accept: 'application/json', 'User-Agent': 'QUANTAN-diagnose/1.0' },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    const ok = res.ok && text.startsWith('[')
    return { ok, detail: ok ? `HTTP ${res.status}, ${text.length} bytes` : `HTTP ${res.status} ${text.slice(0, 120)}` }
  })

  const k = await head('Kraken OHLC (XBTUSD 1440)', async () => {
    const res = await fetch(`${KRAKEN}?pair=XBTUSD&interval=1440`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const j = await res.json().catch(() => ({}))
    const err = j.error?.length ? j.error.join(', ') : null
    const keys = j.result ? Object.keys(j.result).filter((x) => x !== 'last') : []
    const rows = keys.length ? j.result[keys[0]] : null
    const ok = res.ok && !err && Array.isArray(rows) && rows.length > 0
    return {
      ok,
      detail: ok ? `HTTP ${res.status}, ${rows.length} bars` : `HTTP ${res.status} ${err ?? 'bad payload'}`,
    }
  })

  const cg = await head('CoinGecko OHLC (usd, 1d)', async () => {
    const res = await fetch(`${COINGECKO_OHLC}?vs_currency=usd&days=1`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    })
    const raw = await res.text()
    let arr
    try {
      arr = JSON.parse(raw)
    } catch {
      arr = null
    }
    const ok = res.ok && Array.isArray(arr) && arr.length >= 2
    return { ok, detail: ok ? `HTTP ${res.status}, ${arr.length} points` : `HTTP ${res.status} ${raw.slice(0, 80)}` }
  })

  await head('CoinGecko simple price', async () => {
    const res = await fetch(`${COINGECKO_SIMPLE}?ids=bitcoin&vs_currencies=usd&include_24hr_change=true`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const j = await res.json().catch(() => ({}))
    const p = j.bitcoin?.usd
    const ok = res.ok && typeof p === 'number'
    return { ok, detail: ok ? `HTTP ${res.status}, BTC $${p}` : `HTTP ${res.status}` }
  })

  const base = process.env.VERIFY_APP_BASE_URL?.replace(/\/$/, '')
  if (base) {
    await head(`Next /api/crypto/btc`, async () => {
      const res = await fetch(`${base}/api/crypto/btc?interval=1d&limit=5`, { signal: AbortSignal.timeout(30_000) })
      const j = await res.json().catch(() => ({}))
      const n = j.candles?.length
      const ok = res.ok && n >= 1
      return { ok, detail: ok ? `HTTP ${res.status}, ${n} candles, source=${j.source ?? '?'}` : `HTTP ${res.status}` }
    })
    await head(`Next /api/crypto/btc/quote`, async () => {
      const res = await fetch(`${base}/api/crypto/btc/quote`, { signal: AbortSignal.timeout(30_000) })
      const j = await res.json().catch(() => ({}))
      const ok = res.ok && typeof j.price === 'number'
      return { ok, detail: ok ? `HTTP ${res.status}, $${j.price}` : `HTTP ${res.status}` }
    })
  } else {
    console.log('\n  (Set VERIFY_APP_BASE_URL to test Next routes locally / deployed)\n')
  }

  console.log('\n── Summary ──')
  if (!b) console.log('  ⚠ Binance blocked or down — app will use Kraken → CoinGecko for candles.')
  if (!k) console.log('  ⚠ Kraken OHLC failed — app relies on CoinGecko for candles if Binance fails.')
  if (!cg) console.log('  ⚠ CoinGecko OHLC failed — if both Binance and Kraken fail, chart may be empty.')
  if (b && k && cg) console.log('  ✓ All three REST sources reachable from this machine.')
  console.log('\n  Live WebSocket (wss://stream.binance.com) is not tested here — use the browser Network tab.')
  console.log('  Production PWA: /api/* must be NetworkOnly (see next.config.js) so APIs are not cached.\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
