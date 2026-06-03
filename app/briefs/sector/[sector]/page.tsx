import { appBaseUrl } from '@/lib/appUrl'
import { SECTORS } from '@/lib/sectors'
import LiveBriefClient from './LiveBriefClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ sector: string }>
}

async function getBriefData(slug: string) {
  try {
    const res = await fetch(
      `${appBaseUrl()}/api/briefs/${encodeURIComponent(slug)}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function LiveBriefPage({ params }: Props) {
  const { sector: slug } = await params
  const slugNorm = slug || ''
  const sector = SECTORS.find(s => s.slug === slugNorm)
  const brief = await getBriefData(slugNorm)
  return <LiveBriefClient slug={slugNorm} initialBrief={brief} />
}
