'use client'

/**
 * SiteNav — the global navigation, extracted from `app/layout.tsx`.
 *
 * 2026-08-14 interface review. Two findings drove this component:
 *
 * F-IA-1 (HIGH) — three shipped pages had NO way in. A link-graph sweep over
 *   `app/` + `components/` found zero inbound links to `/portfolio`, and its
 *   two children (`/portfolio/factor-attribution`, `/risk/scenarios`) were
 *   linked only from it, so they inherited the orphaning. All three return 200
 *   and render — they were finished features reachable only by typing the URL.
 *   `/backtest` was reachable from exactly one mid-page card on the home page,
 *   despite `KeyboardShortcuts` already binding `g b` to it as a first-class
 *   destination. NAV_GROUPS below is now the single source of truth for the
 *   site's destinations, so a route that ships without an entry here is a
 *   visible omission rather than a silent one.
 *
 * F-UI-1 (HIGH) — the old nav was a flat `flex-wrap` row of 7 links plus
 *   search, auth and market status. At 375x812 it collapsed into five stacked
 *   bands and the sticky header measured 211 px — 26 % of the viewport, on
 *   every page, permanently. Adding the four missing destinations to that
 *   layout would have made it materially worse. So: one 56 px row at every
 *   breakpoint, with the overflow behind a disclosure menu on desktop and a
 *   drawer below `lg`.
 *
 * Patterns:
 *   • Desktop dropdowns use the WAI-ARIA *Disclosure Navigation* pattern
 *     (button with `aria-expanded`/`aria-controls` + a plain list of links),
 *     NOT `role="menu"`. Disclosure keeps the links in the natural tab order,
 *     so there is no roving-tabindex state machine to get wrong.
 *     https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
 *   • The mobile drawer is a modal dialog and reuses `useDialogA11y` — the
 *     existing SSOT for focus trap, scroll lock and return-focus.
 *   • Every destination carries `aria-current="page"` when active. The old nav
 *     gave no indication at all of where you were.
 */

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import {
  LayoutDashboard, PanelsTopLeft, FlaskConical, Newspaper, Grid2X2,
  ChartNoAxesCombined, Gem, Bitcoin, Wallet, ChartPie, Shield, ArrowUpRight,
} from 'lucide-react'

const NAV_ICONS = {
  '/': LayoutDashboard,
  '/desk': PanelsTopLeft,
  '/backtest': FlaskConical,
  '/briefs': Newspaper,
  '/heatmap': Grid2X2,
  '/ma-deviation': ChartNoAxesCombined,
  '/commodities': Gem,
  '/crypto/btc': Bitcoin,
  '/portfolio': Wallet,
  '/portfolio/factor-attribution': ChartPie,
  '/risk/scenarios': Shield,
}

interface NavItem {
  href: string
  label: string
  /** Shown under the label in the mobile drawer and the desktop dropdown. */
  hint: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * Every navigable top-level destination in the app. `primary` renders inline
 * on desktop; `groups` collapse into disclosure menus. The mobile drawer
 * renders all of them.
 */
const NAV_PRIMARY: NavItem[] = [
  { href: '/', label: 'Overview', hint: 'All 11 GICS sectors' },
  { href: '/desk', label: 'Desk', hint: 'Multi-instrument monitor' },
  { href: '/backtest', label: 'Backtest', hint: 'Single-pass historical test' },
  { href: '/briefs', label: 'Briefs', hint: 'Curated sector news' },
]

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Research',
    items: [
      { href: '/heatmap', label: 'Heatmap', hint: 'Sector performance grid' },
      { href: '/ma-deviation', label: '200MA Deviation', hint: 'Distance from the 200-day mean' },
      { href: '/commodities', label: 'Commodities', hint: 'Energy, metals, agriculture' },
      // Q-138: was 'BTC desk and on-chain metrics' — no on-chain metric renders anywhere.
      { href: '/crypto/btc', label: 'Crypto', hint: 'BTC desk and exchange derivatives' },
    ],
  },
  {
    label: 'Portfolio',
    items: [
      { href: '/portfolio', label: 'Portfolio', hint: 'Holdings and performance' },
      { href: '/portfolio/factor-attribution', label: 'Factor Attribution', hint: 'OLS factor decomposition' },
      { href: '/risk/scenarios', label: 'Risk Scenarios', hint: 'Stress tests and drawdown paths' },
    ],
  },
]

/** All destinations, flattened — used by the drawer and by tests. */
export const NAV_ALL: NavItem[] = [...NAV_PRIMARY, ...NAV_GROUPS.flatMap((g) => g.items)]

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  // `/portfolio` must not light up while on `/portfolio/factor-attribution`,
  // which has its own entry — so require an exact match or a `/`-delimited
  // descendant that is not itself a listed destination.
  if (pathname === href) return true
  if (!pathname.startsWith(`${href}/`)) return false
  return !NAV_ALL.some((i) => i.href !== href && i.href === pathname)
}

const linkBase =
  'text-xs font-medium transition-colors rounded-md px-2 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400'

function TopLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActivePath(pathname, item.href)
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`${linkBase} ${active ? 'bg-amber-400/10 text-amber-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
    >
      {item.label}
      <span
        aria-hidden="true"
        className="sr-only"
      />
    </Link>
  )
}

function NavDisclosure({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const groupActive = group.items.some((i) => isActivePath(pathname, i.href))

  // Close on route change.
  useEffect(() => { setOpen(false) }, [pathname])

  // Close on outside pointer-down and on Escape (Escape returns focus to the
  // trigger, per the disclosure pattern).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`${linkBase} flex items-center gap-1 ${
          groupActive || open ? 'text-white' : 'text-slate-300 hover:text-white'
        }`}
      >
        {group.label}
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
          focusable="false"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-[90] mt-2 w-64 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <ul className="py-1">
          {group.items.map((item) => {
            const active = isActivePath(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`block px-3 py-2 transition-colors focus:outline-none focus:bg-slate-800 hover:bg-slate-800 ${
                    active ? 'bg-slate-800/60' : ''
                  }`}
                >
                  <span className={`block text-xs font-medium ${active ? 'text-amber-400' : 'text-white'}`}>
                    {item.label}
                  </span>
                  <span className="block text-[10px] text-slate-400">{item.hint}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function MobileDrawer({
  open,
  onClose,
  pathname,
}: {
  open: boolean
  onClose: () => void
  pathname: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useDialogA11y({ open, dialogRef, initialFocusRef: closeRef })

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const section = (label: string, items: NavItem[]) => (
    <div key={label} className="mb-5 last:mb-0">
      <h3 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</h3>
      <ul>
        {items.map((item) => {
          const active = isActivePath(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                  active ? 'bg-slate-800' : 'hover:bg-slate-800/60'
                }`}
              >
                <span className={`block text-sm font-medium ${active ? 'text-amber-400' : 'text-white'}`}>
                  {item.label}
                </span>
                <span className="block text-[11px] text-slate-400">{item.hint}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[150] lg:hidden">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        className="absolute right-0 top-0 flex h-full w-[85%] max-w-sm flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-white">Navigate</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {section('Markets', NAV_PRIMARY)}
          {NAV_GROUPS.map((g) => section(g.label, g.items))}
        </nav>
        <p className="border-t border-slate-800 px-4 py-3 text-[11px] text-slate-400">
          Press <kbd className="rounded border border-slate-700 bg-slate-800 px-1 font-mono text-[10px]">?</kbd>{' '}
          anywhere for keyboard shortcuts.
        </p>
      </div>
    </div>,
    document.body,
  )
}

/** Desktop navigation — primary links inline, the rest one click away. */
export function SiteNavDesktop() {
  const pathname = usePathname() || '/'
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 lg:flex xl:hidden">
      {NAV_PRIMARY.map((item) => (
        <TopLink key={item.href} item={item} pathname={pathname} />
      ))}
      <span className="mx-1 h-4 w-px bg-slate-700" aria-hidden="true" />
      {NAV_GROUPS.map((group) => (
        <NavDisclosure key={group.label} group={group} pathname={pathname} />
      ))}
    </nav>
  )
}

/** The wide workspace uses the same destinations as the compact navigation. */
export function SiteNavSidebar() {
  const pathname = usePathname() || '/'
  const section = (label: string, items: NavItem[]) => (
    <div key={label} className="space-y-1">
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      {items.map((item) => {
        const active = isActivePath(pathname, item.href)
        const Icon = NAV_ICONS[item.href as keyof typeof NAV_ICONS]
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`group flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors ${
              active
                ? 'bg-amber-400/10 text-amber-300'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
            }`}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} aria-hidden="true" />
            <span>{item.label}</span>
            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />}
          </Link>
        )
      })}
    </div>
  )

  return (
    <aside className="workspace-sidebar">
      <Link href="/" className="flex h-20 items-center gap-3 border-b border-white/[0.06] px-6" aria-label="QUANTAN home">
        <span className="workspace-logomark" aria-hidden="true">Q<span /></span>
        <span className="text-sm font-semibold tracking-[0.16em] text-white">QUANTAN</span>
      </Link>
      <nav aria-label="Workspace" className="flex-1 space-y-7 overflow-y-auto px-3 py-7">
        {section('Workspace', NAV_PRIMARY)}
        {NAV_GROUPS.map((group) => section(group.label, group.items))}
      </nav>
      <div className="m-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-200"><FlaskConical className="h-4 w-4 text-amber-300" aria-hidden="true" />Research workspace</div>
        <p className="text-xs leading-relaxed text-slate-400">Explore the data. Inspect the assumptions.</p>
        <Link href="/backtest" className="mt-3 flex items-center justify-between text-xs font-medium text-amber-300 hover:text-amber-200">Open backtest<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </div>
      <div className="border-t border-white/[0.06] px-6 py-4 text-[11px] text-slate-400">Market intelligence, in perspective.</div>
    </aside>
  )
}

/** Below `lg`: one button, the full destination list in a modal drawer. */
export function SiteNavMobile() {
  const pathname = usePathname() || '/'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  useEffect(() => { setDrawerOpen(false) }, [pathname])

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-expanded={drawerOpen}
        aria-haspopup="dialog"
        aria-label="Open navigation menu"
        className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400 lg:hidden"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" focusable="false">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} pathname={pathname} />
    </>
  )
}

export default SiteNavDesktop
