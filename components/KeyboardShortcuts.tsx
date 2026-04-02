'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'

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

  const close = useCallback(() => setIsOpen(false), [])

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

      if (e.key === '?') {
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

      if (e.key === 'g') {
        if (gTimeout) clearTimeout(gTimeout)
        gPressed = true
        gTimeout = setTimeout(() => { gPressed = false }, 500)
        return
      }

      if (gPressed) {
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

  const grouped = SHORTCUTS.reduce<Record<string, Shortcut[]>>((acc, shortcut) => {
    if (!acc[shortcut.category]) acc[shortcut.category] = []
    acc[shortcut.category].push(shortcut)
    return acc
  }, {})

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="bg-slate-900/95 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={close}
            className="text-slate-500 hover:text-white transition-colors p-1 rounded-md hover:bg-slate-800"
            aria-label="Close shortcuts"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <p className="text-[10px] text-slate-600 text-center">
            Press <kbd className="inline-flex items-center justify-center h-4 px-1 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700 rounded">?</kbd> to toggle this overlay
          </p>
        </div>
      </div>
    </div>
  )
}
