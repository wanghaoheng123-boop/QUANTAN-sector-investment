/**
 * Q-090 — how a news item's source is presented: what we know, and nothing
 * more.
 *
 * The ticket asked for a source TIER derived from the link's hostname against
 * an allow-list. Measured 2026-10-17: 77 of 77 Yahoo news links (8 tickers)
 * point at finance.yahoo.com — Reuters, MT Newswires, Motley Fool and
 * GuruFocus alike. The hostname never names the original outlet, and the
 * `publisher` field is Yahoo's free text. Nothing here can VERIFY a wire, so
 * nothing is ever shown as one: every item is "via Yahoo Finance" with the
 * publisher "as reported".
 *
 * Classification only ever LOWERS trust. A publisher string naming an issuer
 * press-release service is labelled a press release (paid, issuer-written);
 * a string naming an opinion/analysis outlet is labelled commentary. A spoofed
 * string can therefore make an item look LESS authoritative, never more.
 */
export type SourceKind = 'press-release' | 'commentary' | 'reported'

export interface SourceLabel {
  /** The publisher as Yahoo reported it — unverified. */
  publisher: string
  kind: SourceKind
  /** Who actually served the item (the link's host), in words. */
  via: string
}

/** Issuer-paid distribution services: the issuer writes the text. */
const PRESS_RELEASE = /\b(?:globe ?newswire|pr ?newswire|business ?wire|access ?wire|access newswire|newsfile|ein ?presswire|accesswire)\b/i

/** Opinion and analysis outlets, as distinct from news reporting. */
const COMMENTARY = /\b(?:motley fool|zacks|gurufocus|24\/7 wall st|simply wall st|stocktwits|stockstory|trefis|investorplace|seeking alpha|insider monkey|tipranks)\b/i

const HOST_NAMES: Readonly<Record<string, string>> = {
  'finance.yahoo.com': 'Yahoo Finance',
  'yahoo.com': 'Yahoo Finance',
}

function viaOf(link: unknown): string {
  try {
    const host = new URL(String(link)).hostname.replace(/^www\./, '')
    return HOST_NAMES[host] ?? host
  } catch {
    return 'unknown source'
  }
}

export function sourceLabel(publisher: unknown, link: unknown): SourceLabel {
  const name = typeof publisher === 'string' && publisher.trim() ? publisher.trim() : 'Unknown publisher'
  const kind: SourceKind = PRESS_RELEASE.test(name) ? 'press-release' : COMMENTARY.test(name) ? 'commentary' : 'reported'
  return { publisher: name, kind, via: viaOf(link) }
}

export const SOURCE_KIND_TEXT: Readonly<Record<SourceKind, string | null>> = {
  'press-release': 'Press release',
  commentary: 'Commentary',
  reported: null,
}
