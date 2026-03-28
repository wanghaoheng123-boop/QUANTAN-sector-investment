/**
 * Validates Yahoo quote resolution for a fixed sample of symbols (data plumbing smoke test).
 * Run: node scripts/validate-data-samples.mjs
 */
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

const TICKERS = [
  'AAPL',
  'MSFT',
  'GOOGL',
  'AMZN',
  'META',
  'NVDA',
  'TSLA',
  'BRK-B',
  'JPM',
  'V',
  'JNJ',
  'WMT',
  'PG',
  'MA',
  'UNH',
  'HD',
  'DIS',
  'BAC',
  'XOM',
  'CVX',
  'PFE',
  'KO',
  'MRK',
  'CSCO',
  'ABT',
  'COST',
  'PEP',
  'TMO',
  'ACN',
  'NFLX',
  'AMD',
  'INTC',
  'IBM',
  'GE',
  'CAT',
  'BA',
  'MMM',
  'SPY',
  'QQQ',
  'IWM',
  'EEM',
  'VEA',
  'VTI',
  'XLK',
  'XLE',
  'F',
  'GM',
  'PLTR',
  'SNOW',
  'CRWD',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const ok = []
  const fail = []

  for (const sym of TICKERS) {
    try {
      const q = await yahooFinance.quote(sym)
      const price = q.regularMarketPrice
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        ok.push(sym)
      } else {
        fail.push({ symbol: sym, reason: 'missing_or_invalid_price', price })
      }
    } catch (e) {
      fail.push({ symbol: sym, reason: e?.message || String(e) })
    }
    await sleep(120)
  }

  const summary = {
    total: TICKERS.length,
    okCount: ok.length,
    failCount: fail.length,
    ok,
    fail,
  }
  console.log(JSON.stringify(summary, null, 2))
  if (fail.length > 0) {
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
