import Link from 'next/link'
import { SECTORS } from '@/lib/sectors'
import BriefCard from './BriefCard'

export const dynamic = 'force-dynamic'

interface SectorBrief {
  id: string
  sector: string
  sectorName: string
  fetchedAt: string
  lastUpdated: string | null
  quoteTime: string | null
  price: number
  change: number
  changePct: number
  high52w: number | null
  low52w: number | null
  analystRating: string | null
  analystCount: number | null
  holdingsAvgChange: number
  dataQuality: 'live' | 'partial' | 'unavailable'
  dataQualityNote: string | null
  news: { title: string }[]
  signals: { key: string; value: string; impact: string }[]
  summary: string
}

async function getAllBriefs(): Promise<SectorBrief[]> {
  const results = await Promise.allSettled(
    SECTORS.map(async s => {
      const res = await fetch(
        `https://antigravity-sectors.vercel.app/api/briefs/${encodeURIComponent(s.slug)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) return null
      return res.json() as Promise<SectorBrief>
    })
  )
  return results
    .filter((r): r is PromiseFulfilledResult<SectorBrief> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .sort((a, b) => b.holdingsAvgChange - a.holdingsAvgChange)
}

export default async function BriefsPage() {
  const briefs = await getAllBriefs()

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="mb-10">
        <Link href="/" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">
          ← Markets
        </Link>
        <h1 className="text-3xl font-bold text-white mt-4 mb-2">Intelligence Briefs</h1>
        <p className="text-slate-500">
          Live sector intelligence sourced from Yahoo Finance — analyst ratings, top holdings,
          key statistics, and latest headlines. Refreshes every 5 minutes.
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          Live data from Yahoo Finance
        </div>
      </div>

      {briefs.length === 0 && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-slate-500">
          No briefs available. All Yahoo Finance requests failed.
        </div>
      )}

      <div className="space-y-4">
        {briefs.map(brief => (
          <BriefCard key={brief.id} brief={brief} />
        ))}
      </div>
    </div>
  )
}
