'use client'

import React from 'react'

// ─── Skeleton ─────────────────────────────────────────────────────────────────
// Reusable shimmer-pulse skeleton block for loading states.
// Usage: <Skeleton className="h-4 w-32" /> — width/height set via className

interface SkeletonProps {
  className?: string
  rounded?: 'sm' | 'md' | 'lg' | 'full'
  style?: React.CSSProperties
}

export function Skeleton({ className = '', rounded = 'md', style }: SkeletonProps) {
  const roundClass = {
    sm:   'rounded-sm',
    md:   'rounded',
    lg:   'rounded-lg',
    full: 'rounded-full',
  }[rounded]

  return (
    <div
      className={`animate-pulse bg-slate-800/70 ${roundClass} ${className}`}
      style={style}
      aria-hidden="true"
    />
  )
}

// ─── SkeletonText ─────────────────────────────────────────────────────────────
// Multiple stacked skeleton text lines.

interface SkeletonTextProps {
  lines?: number
  className?: string
  lastLineWidth?: string  // Tailwind width class for last line (e.g. "w-2/3")
}

export function SkeletonText({ lines = 3, className = '', lastLineWidth = 'w-3/4' }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? lastLineWidth : 'w-full'}`}
        />
      ))}
    </div>
  )
}

// ─── SkeletonCard ─────────────────────────────────────────────────────────────
// Card-shaped skeleton with optional header + body lines.

interface SkeletonCardProps {
  lines?: number
  className?: string
  showHeader?: boolean
}

export function SkeletonCard({ lines = 4, className = '', showHeader = true }: SkeletonCardProps) {
  return (
    <div className={`rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 ${className}`}>
      {showHeader && (
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="h-8 w-8" rounded="full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      )}
      <SkeletonText lines={lines} />
    </div>
  )
}

// ─── SkeletonTable ────────────────────────────────────────────────────────────
// Table skeleton with N rows × M columns.

interface SkeletonTableProps {
  rows?: number
  cols?: number
  className?: string
}

export function SkeletonTable({ rows = 8, cols = 6, className = '' }: SkeletonTableProps) {
  return (
    <div className={`w-full overflow-hidden rounded-xl border border-slate-800/60 ${className}`}>
      {/* Header row */}
      <div className="flex gap-3 px-4 py-2.5 bg-slate-900/80 border-b border-slate-800/60">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === 0 ? 'w-16' : 'flex-1'}`} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex gap-3 px-4 py-2.5 border-b border-slate-800/30 last:border-b-0"
        >
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton
              key={col}
              className={`h-3.5 ${col === 0 ? 'w-14' : 'flex-1'}`}
              style={{ opacity: 1 - row * 0.07 } as React.CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
