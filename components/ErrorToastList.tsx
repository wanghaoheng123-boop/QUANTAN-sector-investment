'use client'

/**
 * ErrorToastList — renders active error/warn/info toasts.
 *
 * Position: fixed bottom-right. Each toast slides in and auto-dismisses.
 * Use with useErrorToast() hook.
 *
 * Phase 12 Sprint 1 (H5).
 */

import { X, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import type { Toast, ToastLevel } from '@/hooks/useErrorToast'

interface Props {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

const LEVEL_STYLES: Record<ToastLevel, { border: string; icon: React.ReactNode; text: string }> = {
  error: {
    border: 'border-red-500/40',
    icon: <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />,
    text: 'text-red-200',
  },
  warn: {
    border: 'border-amber-500/40',
    icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />,
    text: 'text-amber-200',
  },
  info: {
    border: 'border-cyan-500/30',
    icon: <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />,
    text: 'text-cyan-200',
  },
}

export function ErrorToastList({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map(toast => {
        const styles = LEVEL_STYLES[toast.level]
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${styles.border} bg-slate-900/95 backdrop-blur-sm px-4 py-3 shadow-lg animate-fadeIn`}
            role={toast.level === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
          >
            <span aria-hidden="true">{styles.icon}</span>
            <p className={`text-xs flex-1 ${styles.text} leading-relaxed`}>
              <span className="sr-only">
                {toast.level === 'error' ? 'Error: ' : toast.level === 'warn' ? 'Warning: ' : 'Info: '}
              </span>
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-slate-500 hover:text-slate-300 transition-colors shrink-0 mt-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded"
              aria-label={`Dismiss ${toast.level} notification`}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default ErrorToastList
