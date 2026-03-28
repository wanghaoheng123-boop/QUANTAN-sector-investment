/**
 * HTTP smoke tests against a deployed site (default: Vercel production).
 * Run: npm run check:smoke
 * Override: SMOKE_BASE_URL=https://localhost:3000 node scripts/smoke-production.mjs
 */
const base = (process.env.SMOKE_BASE_URL || 'https://antigravity-sectors.vercel.app').replace(/\/$/, '')

async function getJson(path) {
  const url = `${base}${path}`
  const res = await fetch(url, { redirect: 'follow' })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { url, ok: res.ok, status: res.status, json, textLen: text.length }
}

function ok(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else console.error(`  ✗ ${msg}`)
  return Boolean(cond)
}

async function main() {
  console.log(`Smoke tests → ${base}\n`)

  let passed = true

  const home = await fetch(`${base}/`)
  passed &= ok(home.ok && home.status === 200, `GET / → ${home.status}`)
  const html = await home.text()
  passed &= ok(html.includes('Sector Intelligence'), 'HTML contains hero title')

  const prices = await getJson('/api/prices?tickers=AAPL,SPY')
  passed &= ok(prices.ok && prices.status === 200, `GET /api/prices → ${prices.status}`)
  const pq = prices.json?.quotes
  passed &= ok(Array.isArray(pq) && pq.length >= 2, 'prices.quotes has AAPL+SPY rows')
  const aapl = pq?.find((q) => q.ticker === 'AAPL')
  passed &= ok(
    aapl && typeof aapl.price === 'number' && aapl.price > 0,
    `AAPL price is positive number (${aapl?.price})`
  )

  const search = await getJson('/api/search?q=apple&limit=3')
  passed &= ok(search.ok && search.status === 200, `GET /api/search → ${search.status}`)
  passed &= ok(
    Array.isArray(search.json?.quotes) && search.json.quotes.length >= 1,
    'search returns quotes'
  )

  const chart = await getJson('/api/chart/AAPL?range=1mo')
  passed &= ok(chart.ok && chart.status === 200, `GET /api/chart → ${chart.status}`)
  const candles = chart.json?.candles
  passed &= ok(Array.isArray(candles) && candles.length >= 5, `chart has candles (${candles?.length})`)
  const c0 = candles?.[0]
  passed &= ok(
    c0 && typeof c0.close === 'number' && c0.close > 0,
    'first candle has positive close'
  )

  const health = await getJson('/api/bloomberg-bridge/health')
  passed &= ok(health.ok && health.status === 200, `GET bloomberg-bridge/health → ${health.status}`)

  console.log('')
  if (!passed) {
    console.error('Some checks failed.')
    process.exit(1)
  }
  console.log('All smoke checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
