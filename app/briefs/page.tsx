import Link from 'next/link'
import { getAllSectorBriefs, aggregateDataQuality } from '@/lib/briefs/sectorBrief'
import BriefCard from './BriefCard'

/**
 * UX-26a. This page used to fan out ELEVEN HTTP self-fetches to
 * `${appBaseUrl()}/api/briefs/${slug}` — a server component asking its own
 * deployment for data it could compute in-process. Any failure on that internal
 * hop (deployment protection, an auth redirect, `VERCEL_URL` resolving to the
 * deployment host rather than the production alias) turned every brief into
 * `null`, and the page collapsed all eleven into one sentence blaming Yahoo
 * Finance — under a hardcoded green "live" pill. In production on 2026-08-15
 * the endpoint it was fetching answered 200 to a browser at the same moment.
 *
 * Now it calls `getAllSectorBriefs()` directly: no network hop, no rate-limit
 * budget consumed, and provider health is reported from the briefs themselves.
 *
 * Cache semantics unchanged: still `force-dynamic`, still rebuilt per request.
 * The old `cache:'no-store'` fetches meant the route's `s-maxage` header never
 * applied to this page anyway, so nothing was lost by dropping the hop.
 */
export const dynamic = 'force-dynamic'

/** Presentation for the header pill — one row per aggregate data-quality state. */
const QUALITY_PILL = {
  live: {
    className: 'text-green-400',
    dotClassName: 'bg-green-400 animate-pulse',
    label: 'Live data from Yahoo Finance',
  },
  partial: {
    className: 'text-amber-400',
    dotClassName: 'bg-amber-400',
    label: 'Partial data — some Yahoo Finance fields are unavailable right now',
  },
  unavailable: {
    className: 'text-red-400',
    dotClassName: 'bg-red-400',
    label: 'Degraded — Yahoo Finance data is unavailable for at least one sector',
  },
} as const

export default async function BriefsPage() {
  const { briefs, failedSlugs } = await getAllSectorBriefs()
  const quality = aggregateDataQuality(briefs)
  const pill = QUALITY_PILL[quality]

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="mb-10">
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
          ← Markets
        </Link>
        <h1 className="text-3xl font-bold text-white mt-4 mb-2">Intelligence Briefs</h1>
        <p className="text-slate-400">
          Live sector intelligence sourced from Yahoo Finance — analyst ratings, top holdings,
          key statistics, and latest headlines. Refreshes every 5 minutes.
        </p>
        {/* The pill reports what actually loaded. It used to be a literal. */}
        <div className={`mt-3 flex items-center gap-2 text-xs ${pill.className}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${pill.dotClassName}`} />
          {pill.label}
        </div>
      </div>

      {/* A builder throw is OUR failure, not the provider's — say so, so whoever
          reads this debugs the right system (the old copy sent them to Yahoo). */}
      {failedSlugs.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-xs text-amber-300/80">
          {failedSlugs.length} of {failedSlugs.length + briefs.length} sector briefs could not be
          built ({failedSlugs.join(', ')}). This is a QUANTAN-side failure, not a Yahoo Finance
          outage.
        </div>
      )}

      {briefs.length === 0 && (
        <div className="rounded-xl border border-slate-800 p-8 text-center text-slate-400">
          No briefs available — the brief builder failed for every sector. Yahoo Finance
          availability is reported per brief, so this is an application error rather than an
          upstream one.
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
