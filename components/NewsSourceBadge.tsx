/**
 * Q-090 — one presentation of a news item's source, shared by every news list.
 * See lib/news/sourceLabel.ts for why no item is shown as a verified wire.
 */
import { sourceLabel, SOURCE_KIND_BASIS, SOURCE_KIND_TEXT } from '@/lib/news/sourceLabel'

export function NewsSourceBadge({ publisher, link, color }: { publisher: unknown; link: unknown; color?: string }) {
  const s = sourceLabel(publisher, link)
  const kind = SOURCE_KIND_TEXT[s.kind]
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono shrink-0"
      title={`${s.publisher} — as reported by ${s.via}; the original publisher is not verified. Type: ${SOURCE_KIND_BASIS[s.kind]}.`}
      data-source-kind={s.kind}
    >
      {kind && (
        <span className={`px-1 py-0.5 rounded border ${s.kind === 'unclassified' ? 'border-slate-600 text-slate-400' : 'border-amber-500/40 text-amber-300'}`}>{kind}</span>
      )}
      <span className="px-1.5 py-0.5 rounded" style={color ? { backgroundColor: `${color}20`, color } : undefined}>
        {s.publisher}
      </span>
      <span className="text-slate-400">via {s.via}</span>
    </span>
  )
}
