'use client'

/**
 * useDialogA11y — WAI-ARIA APG Dialog accessibility primitive.
 *
 * Phase 14 wave 31 (structural SSOT extraction):
 *   The same 25-line block was inlined in `components/KeyboardShortcuts.tsx`
 *   AND `components/stock/LlmDeployAssistant.tsx`. jscpd flagged it as the
 *   single largest cross-file duplication in the components tree. Future
 *   modals would have copy-pasted the same logic.
 *
 *   Now: each modal calls `useDialogA11y({ open, dialogRef, initialFocusRef })`
 *   and gets the full WAI-ARIA APG contract for free:
 *     • Initial focus on the supplied element (close button by convention)
 *     • Focus trap via Tab/Shift+Tab cycling within the dialog
 *     • Return focus to the previously-focused element on close
 *     • Body scroll lock while open (CSS `overflow: hidden` on body)
 *
 *   Escape-to-dismiss and click-outside-to-dismiss are LEFT to the caller
 *   because they need access to the close handler (which we don't manage).
 *   Callers should add their own `onKey === 'Escape'` listener.
 *
 *   The portal (`createPortal`) and `role="dialog" aria-modal="true"
 *   aria-labelledby` markup also remain the caller's responsibility — those
 *   are JSX concerns, not effect concerns.
 *
 * Reference: WAI-ARIA Authoring Practices Guide — Dialog (modal).
 *   https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */

import { useEffect, type RefObject } from 'react'

interface UseDialogA11yOptions {
  /** Whether the dialog is currently open. Effects run when this is true. */
  open: boolean
  /** Ref to the dialog container (used to scope the focus trap). */
  dialogRef: RefObject<HTMLElement | null>
  /**
   * Ref to the element that should receive initial focus when the dialog
   * opens. Conventionally the close button. If null/unmounted the hook
   * silently no-ops (focus stays on the trigger).
   */
  initialFocusRef: RefObject<HTMLElement | null>
}

/** Selector for focusable elements within the dialog (WAI-ARIA APG canonical list). */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])'

export function useDialogA11y({ open, dialogRef, initialFocusRef }: UseDialogA11yOptions): void {
  useEffect(() => {
    if (!open) return

    // 1. Remember the previously-focused element so we can restore on close.
    const returnFocus = (typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null)

    // 2. Move focus into the dialog (typically to the close button).
    initialFocusRef.current?.focus()

    // 3. Lock body scroll. Cache + restore previous overflow value.
    const prevOverflow = typeof document !== 'undefined' ? document.body.style.overflow : ''
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden'
    }

    // 4. Focus-trap: cycle Tab / Shift+Tab within the dialog.
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = (typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null)
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', trapFocus)
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', trapFocus)
        document.body.style.overflow = prevOverflow
      }
      // 5. Restore focus to the element that opened the dialog.
      returnFocus?.focus?.()
    }
  }, [open, dialogRef, initialFocusRef])
}
