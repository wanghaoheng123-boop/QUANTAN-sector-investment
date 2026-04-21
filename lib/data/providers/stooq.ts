import type { DataProvider, DailyFetchOptions, ProviderDailyBar, ProviderQuote } from './types'

function stooqSymbol(raw: string): string {
  return `${raw.trim().toLowerCase().replace(/\./g, '-')}.us`
}

function parseCsvRows(csv: string): ProviderDailyBar[] {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  if (lines.length <= 1) return []
  const out: ProviderDailyBar[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    const [date, open, high, low, close, volume] = line.split(',')
    if (!date || !open || !high || !low || !close) continue
    if ([open, high, low, close].some((v) => v.toUpperCase() === 'N/A')) continue
    const d = new Date(`${date}T00:00:00.000Z`)
    const time = Math.floor(d.getTime() / 1000)
    const o = Number(open)
    const h = Number(high)
    const l = Number(low)
    const c = Number(close)
    const v = Number(volume ?? 0)
    if (!Number.isFinite(time) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
      continue
    }
    out.push({
      time,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(v) ? v : 0,
    })
  }
  return out
}

export class StooqProvider implements DataProvider {
  readonly name = 'stooq'

  isAvailable(): boolean {
    return true
  }

  async fetchDaily(symbol: string, opts: DailyFetchOptions): Promise<ProviderDailyBar[] | null> {
    const sym = stooqSymbol(symbol)
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const text = await res.text()
      const rows = parseCsvRows(text).filter((r) => r.time >= Math.floor(opts.period1.getTime() / 1000))
      return rows.length > 0 ? rows : null
    } catch {
      return null
    }
  }

  async fetchQuote(_symbol: string): Promise<ProviderQuote | null> {
    return null
  }
}

