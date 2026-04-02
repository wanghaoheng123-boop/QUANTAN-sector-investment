'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Crumb {
  label: string
  href?: string
}

function getBreadcrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }]

  if (pathname === '/') {
    return [{ label: 'Home' }]
  }

  if (pathname.startsWith('/desk')) {
    crumbs.push({ label: 'Desk', href: '/desk' })
    return crumbs
  }

  if (pathname.startsWith('/backtest')) {
    crumbs.push({ label: 'Backtest', href: '/backtest' })
    return crumbs
  }

  if (pathname.startsWith('/sector/')) {
    crumbs.push({ label: 'Sector', href: '/' })
    const slug = pathname.replace('/sector/', '')
    const sectorName = slug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    crumbs.push({ label: sectorName })
    return crumbs
  }

  if (pathname.startsWith('/stock/')) {
    crumbs.push({ label: 'Markets', href: '/' })
    const ticker = decodeURIComponent(pathname.replace('/stock/', ''))
    crumbs.push({ label: ticker })
    return crumbs
  }

  if (pathname.startsWith('/briefs')) {
    crumbs.push({ label: 'Briefs', href: '/briefs' })
    return crumbs
  }

  if (pathname.startsWith('/commodities')) {
    crumbs.push({ label: 'Commodities', href: '/commodities' })
    return crumbs
  }

  if (pathname.startsWith('/crypto/')) {
    crumbs.push({ label: 'Crypto', href: '/crypto/btc' })
    const coin = pathname.replace('/crypto/', '').toUpperCase()
    crumbs.push({ label: coin })
    return crumbs
  }

  if (pathname.startsWith('/heatmap')) {
    crumbs.push({ label: 'Heatmap', href: '/heatmap' })
    return crumbs
  }

  if (pathname.startsWith('/ma-deviation')) {
    crumbs.push({ label: '200MA', href: '/ma-deviation' })
    return crumbs
  }

  return crumbs
}

export default function Breadcrumbs() {
  const pathname = usePathname()
  const crumbs = getBreadcrumbs(pathname)

  if (crumbs.length <= 1) return null

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <span key={index} className="flex items-center gap-1.5">
            {index > 0 && (
              <span className="text-slate-600">/</span>
            )}
            {crumb.href && !isLast ? (
              <Link
                href={crumb.href}
                className="text-slate-400 hover:text-white transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-slate-200 font-medium' : 'text-slate-400'}>
                {crumb.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
