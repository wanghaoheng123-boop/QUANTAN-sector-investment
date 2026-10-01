import { z } from 'zod'

/**
 * Q-094 — the news payload, parsed at the client boundary (house style: zod,
 * parse don't validate). `NewsFeed` used to spread `data.news ?? []` straight
 * into state, so a malformed item became an empty card and a non-array body
 * crashed the render.
 *
 * Items are parsed ONE AT A TIME: a malformed item is dropped and counted, it
 * does not take the whole feed down with it.
 *
 * Q-140 — the routes also answer `degraded: true` with `error.message` when
 * the upstream feed failed; that is carried through so the feed can say so.
 */

const NewsItemSchema = z.object({
  title: z.string().trim().min(1),
  publisher: z.string().optional(),
  link: z.string().optional(),
  snippet: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  tickers: z.array(z.string()).optional(),
})

export type NewsItem = z.infer<typeof NewsItemSchema>

const NewsEnvelopeSchema = z.object({
  news: z.array(z.unknown()),
  fetchedAt: z.string().nullable().optional(),
  degraded: z.boolean().optional(),
  error: z.object({ code: z.string(), message: z.string() }).partial().optional(),
})

export interface ParsedNews {
  items: NewsItem[]
  fetchedAt: string | null
  /** Items the route sent that were not valid news items. */
  dropped: number
  /** The route said the feed failed or is incomplete; the message to show. */
  degradedMessage: string | null
}

/** Throws when the body is not a news envelope at all — the caller's error path. */
export function parseNewsPayload(body: unknown): ParsedNews {
  const env = NewsEnvelopeSchema.parse(body)
  const items: NewsItem[] = []
  let dropped = 0
  for (const raw of env.news) {
    const r = NewsItemSchema.safeParse(raw)
    if (r.success) items.push(r.data)
    else dropped += 1
  }
  return {
    items,
    fetchedAt: env.fetchedAt ?? null,
    dropped,
    degradedMessage: env.degraded ? (env.error?.message ?? 'The news feed is degraded; this list may be incomplete.') : null,
  }
}
