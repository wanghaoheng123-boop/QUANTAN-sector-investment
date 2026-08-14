/**
 * GET /api/briefs/[sector]
 *
 * HTTP wrapper over the brief builder. The brief itself is built by
 * `lib/briefs/sectorBrief.ts` — see that module's header for what a brief
 * contains and for why the builder no longer lives in this file (UX-26: the
 * briefs server components used to reach it by fetching this very route over
 * the network, and that internal hop was the production outage).
 *
 * This route stays the public API for external clients and for the detail
 * page's client-side refresh. It owns exactly three things the builder must not
 * know about: rate limiting, HTTP status selection, and cache headers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildSectorBrief } from '@/lib/briefs/sectorBrief'
import { applyRateLimit } from '@/lib/api/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Re-exported so existing importers of these types keep working after the move.
export type { BriefSignal, SectorBrief } from '@/lib/briefs/sectorBrief'
import type { SectorBrief } from '@/lib/briefs/sectorBrief'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sector: string }> }
): Promise<NextResponse<SectorBrief | { error: string }>> {
  // Phase 14: rate limit — 30 req/min per IP. Brief endpoint hits Yahoo
  // 3+ times per call (quote, summary, news, holdings); unprotected polling
  // would multiply upstream load.
  //
  // UX-26: this limit now protects the upstream from EXTERNAL callers only.
  // The pages used to come through here too — 11 self-fetches per view against
  // a 30/min per-IP bucket keyed on one serverless egress IP — so the app was
  // its own worst rate-limit client. Server-side rendering calls the builder
  // directly and no longer consumes this budget.
  const rl = await applyRateLimit(req, 'briefs-sector', { maxRequests: 30, windowSeconds: 60 })
  if (rl) return rl as NextResponse<{ error: string }>

  const { sector: sectorParam } = await params
  const slug = (sectorParam || '').trim()

  const brief = await buildSectorBrief(slug)
  if (!brief) {
    return NextResponse.json({ error: `Unknown sector: ${slug}` }, { status: 404 })
  }

  return NextResponse.json(brief, {
    headers: {
      'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
    },
  })
}
