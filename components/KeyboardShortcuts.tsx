'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, usePathname } from 'next/navigation'
import { useDialogA11y } from '@/hooks/useDialogA11y'

interface Shortcut {
  keys: string[]
  description: string
  category: string
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['?'], description: 'Show keyboard shortcuts', category: 'General' },
  { keys: ['⌘', 'K'], description: 'Focus search', category: 'Search' },
  { keys: ['⌘', '\\'], description: 'Go to Markets', category: 'Navigation' },
  { keys: ['g', 'd'], description: 'Go to Desk', category: 'Navigation' },
  { keys: ['g', 'b'], description: 'Go to Backtest', category: 'Navigation' },
  { keys: ['Esc'], description: 'Close modal', category: 'General' },
]

export default function KeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // F6.7 (WAI-ARIA APG Dialog): refs for focus management. The actual
  // focus-trap / scroll-lock / return-focus contract now lives in
  // `useDialogA11y` (Phase 14 wave 31 SSOT extraction).
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setIsOpen(false), [])

  // WAI-ARIA APG Dialog primitive — initial focus, focus trap, scroll lock,
  // return focus. Runs on every isOpen transition.
  useDialogA11y({ open: isOpen, dialogRef, initialFocusRef: closeBtnRef })

  useEffect(() => {
    let gPressed = false
    let gTimeout: ReturnType<typeof setTimeout> | null = null

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (e.key === 'Escape') {
        close()
        return
      }

      if (isInput) return

      // Phase 13 S2 UX: never trigger our overlay-toggle when a modifier
      // is held. Shift+/ produces `?` and is the legitimate path, but
      // Alt+? / Meta+? / Ctrl+? are user-defined OS / browser combos.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setIsOpen(prev => !prev)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search stocks and ETFs"]')
        searchInput?.focus()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        router.push('/')
        return
      }

      // F6.7 UX fix: exclude modifier keys from the `g`-prefix sequence so
      // browser/OS Cmd+G ("find next") doesn't silently arm our navigation
      // and trigger a route change on the next typed letter.
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (gTimeout) clearTimeout(gTimeout)
        gPressed = true
        gTimeout = setTimeout(() => { gPressed = false }, 500)
        return
      }

      if (gPressed && !e.metaKey && !e.ctrlKey && !e.altKey) {
        gPressed = false
        if (gTimeout) clearTimeout(gTimeout)
        if (e.key === 'd') {
          e.preventDefault()
          router.push('/desk')
          return
        }
        if (e.key === 'b') {
          e.preventDefault()
          router.push('/backtest')
          return
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (gTimeout) clearTimeout(gTimeout)
    }
  }, [close, router])

  useEffect(() => {
    close()
  }, [pathname, close])

  if (!isOpen) return null

  // Phase 14 (R5-M-4): render the modal through a portal to document.body so
  // it escapes any ancestor stacking context (e.g. headers with
  // position: sticky/relative + transforms) that would otherwise clip the
  // overlay or fight its z-index. Guard for SSR — Next.js renders this
  // component server-side as well.
  if (typeof document === 'undefined') return null

  const grouped = SHORTCUTS.reduce<Record<string, Shortcut[]>>((acc, shortcut) => {
    if (!acc[shortcut.category]) acc[shortcut.category] = []
    acc[shortcut.category].push(shortcut)
    return acc
  }, {})

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <div
        ref={dialogRef}
        className="bg-slate-900/95 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 id="keyboard-shortcuts-title" className="text-base font-semibold text-white">Keyboard Shortcuts</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={close}
            className="text-slate-500 hover:text-white transition-colors p-1 rounded-md hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label="Close shortcuts"
          >
            {/* Phase 14 wave 24 Pattern D: aria-hidden on decorative SVG so
                screen readers don't read raw path data alongside the
                aria-label. */}
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {Object.entries(grouped).map(([category, shortcuts]) => (
            <div key={category} className="mb-4 last:mb-0">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{category}</div>
              <div className="space-y-1">
                {shortcuts.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-slate-300">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, j) => (
                        <kbd
                          key={j}
                          className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-xs font-mono font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/50">
          <p className="text-[10px] text-slate-400 text-center">
            Press <kbd className="inline-flex items-center justify-center h-4 px-1 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700 rounded">?</kbd> to toggle this overlay
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
