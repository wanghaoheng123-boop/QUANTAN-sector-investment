export type RecessionRange = {
  startDate: string
  endDate: string
}

const USREC_SERIES_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=USREC'

export async function fetchRecessionRanges(): Promise<RecessionRange[] | null> {
  try {
    const res = await fetch(USREC_SERIES_CSV)
    if (!res.ok) return null
    const csv = await res.text()
    const lines = csv.split(/\r?\n/).filter(Boolean)
    if (lines.length <= 1) return null
    const points: { date: string; flag: 0 | 1 }[] = []
    for (let i = 1; i < lines.length; i += 1) {
      const [date, value] = lines[i].split(',')
      if (!date || !value) continue
      const n = Number(value)
      if (n === 0 || n === 1) points.push({ date, flag: n as 0 | 1 })
    }
    if (!points.length) return null
    const out: RecessionRange[] = []
    let start: string | null = null
    for (const p of points) {
      if (p.flag === 1 && !start) start = p.date
      if (p.flag === 0 && start) {
        out.push({ startDate: start, endDate: p.date })
        start = null
      }
    }
    if (start) out.push({ startDate: start, endDate: points[points.length - 1].date })
    return out
  } catch {
    return null
  }
}

export function isRecession(dateIso: string, ranges: RecessionRange[]): boolean {
  return ranges.some((r) => dateIso >= r.startDate && dateIso <= r.endDate)
}

