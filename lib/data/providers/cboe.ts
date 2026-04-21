export type VixHistoryRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
}

const CBOE_VIX_DAILY_CSV = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'

export async function fetchVixHistory(): Promise<VixHistoryRow[] | null> {
  try {
    const res = await fetch(CBOE_VIX_DAILY_CSV)
    if (!res.ok) return null
    const csv = await res.text()
    const lines = csv.split(/\r?\n/).filter(Boolean)
    if (lines.length <= 1) return null
    const out: VixHistoryRow[] = []
    for (let i = 1; i < lines.length; i += 1) {
      const [dateRaw, openRaw, highRaw, lowRaw, closeRaw] = lines[i].split(',')
      if (!dateRaw || !openRaw || !highRaw || !lowRaw || !closeRaw) continue
      const mmddyyyy = dateRaw.trim()
      const [m, d, y] = mmddyyyy.split('/')
      if (!y || !m || !d) continue
      const date = `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      const open = Number(openRaw)
      const high = Number(highRaw)
      const low = Number(lowRaw)
      const close = Number(closeRaw)
      if (![open, high, low, close].every(Number.isFinite)) continue
      out.push({ date, open, high, low, close })
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

