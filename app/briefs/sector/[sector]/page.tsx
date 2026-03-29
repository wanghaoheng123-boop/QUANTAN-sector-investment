import { SECTORS } from '@/lib/sectors'
import LiveBriefClient from './LiveBriefClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: { sector: string }
}

async function getBriefData(slug: string) {
  try {
    const res = await fetch(
      `https://antigravity-sectors.vercel.app/api/briefs/${encodeURIComponent(slug)}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function LiveBriefPage({ params }: Props) {
  const slug = params.sector || ''
  const sector = SECTORS.find(s => s.slug === slug)
  const brief = await getBriefData(slug)
  return <LiveBriefClient slug={slug} initialBrief={brief} />
}
