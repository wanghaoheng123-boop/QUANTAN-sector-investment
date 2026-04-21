export type Edgar13FFiling = {
  accessionNumber: string
  reportDate: string
  filingDate: string
  primaryDocument: string
}

type EdgarSubmissions = {
  filings?: {
    recent?: {
      form?: string[]
      accessionNumber?: string[]
      reportDate?: string[]
      filingDate?: string[]
      primaryDocument?: string[]
    }
  }
}

function normalizeCik(cik: string): string {
  return cik.trim().replace(/\D/g, '').padStart(10, '0')
}

function secHeaders(): HeadersInit | null {
  const ua = process.env.SEC_USER_AGENT?.trim()
  if (!ua) return null
  return { 'User-Agent': ua, Accept: 'application/json' }
}

export function isEdgarConfigured(): boolean {
  return Boolean(secHeaders())
}

export async function fetchRecent13FFilings(cik: string): Promise<Edgar13FFiling[] | null> {
  const headers = secHeaders()
  if (!headers) return null
  const cikPadded = normalizeCik(cik)
  const url = `https://data.sec.gov/submissions/CIK${cikPadded}.json`
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) return null
    const json = (await res.json()) as EdgarSubmissions
    const recent = json.filings?.recent
    const forms = recent?.form ?? []
    const accession = recent?.accessionNumber ?? []
    const reportDate = recent?.reportDate ?? []
    const filingDate = recent?.filingDate ?? []
    const primaryDocument = recent?.primaryDocument ?? []
    const out: Edgar13FFiling[] = []
    for (let i = 0; i < forms.length; i += 1) {
      if (!forms[i]?.startsWith('13F')) continue
      if (!accession[i] || !filingDate[i]) continue
      out.push({
        accessionNumber: accession[i],
        reportDate: reportDate[i] ?? filingDate[i],
        filingDate: filingDate[i],
        primaryDocument: primaryDocument[i] ?? '',
      })
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

