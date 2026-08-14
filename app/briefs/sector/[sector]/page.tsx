import { SECTORS } from '@/lib/sectors'
import { getSectorBriefSafe } from '@/lib/briefs/sectorBrief'
import LiveBriefClient from './LiveBriefClient'

/**
 * UX-26b. In production this page returned a server-render crash (React error
 * digest 2384324333) while `/api/briefs/technology` — the route it was fetching
 * — answered 200 to a browser.
 *
 * The old fetcher looked exhaustive:
 *
 *   ```ts
 *   try {
 *     const res = await fetch(`${appBaseUrl()}/api/briefs/${slug}`, { cache: 'no-store' })
 *     if (!res.ok) return null
 *     return res.json()          // ← the hole
 *   } catch { return null }
 *   ```
 *
 * `return promise` inside a `try` does not send that promise's rejection to the
 * `catch` — the async function leaves the try block and only then adopts the
 * promise. Transport failures were caught (the `fetch` is awaited) and every
 * non-2xx was caught (`!res.ok`), so the ONE uncovered class was a 2xx response
 * whose body isn't JSON: an SSO/challenge page served 200, or a redirect that
 * `fetch` transparently followed to the HTML app shell. That rejection escaped
 * and crashed the render.
 *
 * It also explains why the two briefs pages failed differently from the same
 * broken hop: the list page's `Promise.allSettled` absorbed the identical
 * rejection and merely rendered empty.
 *
 * The self-fetch is gone — the builder is called in-process — so the JSON-parse
 * class cannot recur, and `getSectorBriefSafe` keeps a real `await` inside its
 * `try` for the Yahoo calls that remain.
 *
 * Cache semantics unchanged: still `force-dynamic`, still rebuilt per request.
 */
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ sector: string }>
}

export default async function LiveBriefPage({ params }: Props) {
  const { sector: slug } = await params
  const slugNorm = slug || ''

  // An unknown slug has no brief to build — skip the Yahoo round-trips and let
  // the client render its "Sector not found" panel. (This lookup existed before
  // and its result was never read.)
  const known = SECTORS.some(s => s.slug === slugNorm)
  const brief = known ? await getSectorBriefSafe(slugNorm) : null

  return <LiveBriefClient slug={slugNorm} initialBrief={brief} />
}
