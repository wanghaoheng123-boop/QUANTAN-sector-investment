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
 * a string naming an opinion/analysis outlet is labelled as one; a known
 * newsroom is shown unbadged; anything else is visibly "unclassified". A
 * spoofed string can make an item look LESS authoritative, never more.
 */
import { isSafeHttpUrl } from '@/lib/security/urlValidation'
export type SourceKind = 'press-release' | 'opinion-outlet' | 'newsroom' | 'unclassified'

export interface SourceLabel {
  /** The publisher as Yahoo reported it — unverified. */
  publisher: string
  kind: SourceKind
  /** Who actually served the item (the link's host), in words. */
  via: string
}

/**
 * Issuer-paid distribution services: the issuer writes the text. Red-team
 * R2-242-1: CNW Group (Cision's Canada Newswire) and the rest of this list were
 * unbadged on production, so 2 of 7 sampled press releases read as reporting.
 */
const PRESS_RELEASE = /\b(?:globe ?newswire|pr ?newswire|business ?wire|access ?(?:news)?wire|newsfile|ein ?presswire|cnw group|cision|prweb|eqs(?:[- ](?:group|news))?|thenewswire|newswire\.ca)\b/i

/**
 * Outlets that publish mainly opinion and analysis. Decided by PUBLISHER, not
 * by reading the item — an earnings report from one of these is still labelled
 * by its outlet, which is why the badge says "outlet" (red-team R2-242-5).
 */
const OPINION_OUTLET = /\b(?:motley fool|zacks|gurufocus|24\/7 wall st|simply wall st|stocktwits|stockstory|trefis|investorplace|seeking alpha|insider monkey|tipranks|tikr|schaeffer'?s|barchart)\b/i

/** Newsrooms: reporting organisations. Shown with no badge — the only unbadged kind. */
const NEWSROOM = /\b(?:reuters|associated press|ap news|bloomberg|the wall street journal|wsj|barron'?s(?:\.com)?|financial times|mt newswires|dow jones|cnbc|marketwatch|investor'?s business daily|the new york times|business insider|fortune|axios|afp|yahoo finance|investing\.com|manufacturing dive|cre daily)\b/i

/**
 * Normalised for matching: NFKC, zero-width characters removed, every run of
 * whitespace (NBSP included) made one space. `Globe Newswire` and
 * `PR​Newswire` dodged the lists before (R2-242-1).
 */
const normaliseName = (s: string) => s.normalize('NFKC').replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim()

const HOST_NAMES: Readonly<Record<string, string>> = {
  'finance.yahoo.com': 'Yahoo Finance',
  'yahoo.com': 'Yahoo Finance',
}

/**
 * Who served the item. Only a link the page would actually render counts
 * (red-team R2-242-3: a `javascript://finance.yahoo.com/…` link was credited to
 * Yahoo while `safeHref` refused it).
 */
function viaOf(link: unknown): string {
  if (!isSafeHttpUrl(link)) return 'unknown source'
  try {
    const host = new URL(String(link)).hostname.replace(/^www\./, '')
    return host ? (HOST_NAMES[host] ?? host) : 'unknown source'
  } catch {
    return 'unknown source'
  }
}

export function sourceLabel(publisher: unknown, link: unknown): SourceLabel {
  const name = typeof publisher === 'string' && normaliseName(publisher) ? normaliseName(publisher) : 'Unknown publisher'
  // Order matters: a string naming a press-release service is a press release
  // even if it also names a newsroom, so a spoof can only DOWNGRADE.
  const kind: SourceKind = PRESS_RELEASE.test(name)
    ? 'press-release'
    : OPINION_OUTLET.test(name)
      ? 'opinion-outlet'
      : NEWSROOM.test(name)
        ? 'newsroom'
        : 'unclassified'
  return { publisher: name, kind, via: viaOf(link) }
}

/**
 * The visible badge for each kind. Only a known newsroom shows none, so an
 * absent badge is a classification the code made, never a default
 * (red-team R2-242-1: 36% of today's items were unbadged by omission).
 */
export const SOURCE_KIND_TEXT: Readonly<Record<SourceKind, string | null>> = {
  'press-release': 'Press release',
  'opinion-outlet': 'Opinion/analysis outlet',
  newsroom: null,
  unclassified: 'Unclassified source',
}

/** What each badge is based on, for its tooltip. */
export const SOURCE_KIND_BASIS: Readonly<Record<SourceKind, string>> = {
  'press-release': 'the publisher is an issuer-paid distribution service, so the issuer wrote the text',
  'opinion-outlet': 'labelled by its publisher, an outlet that mainly publishes opinion and analysis; the item itself was not read',
  newsroom: 'the publisher is a news organisation',
  unclassified: 'this publisher is not on the platform’s lists, so the item’s type is unknown',
}
