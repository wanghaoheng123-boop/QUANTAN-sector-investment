'use client'

/**
 * A time in the VIEWER's zone, rendered only after mount (red-team R2-243-2).
 *
 * `formatLocalTime` / `formatLocalDateTime` name the viewer's zone, so the
 * same instant reads "3:15 PM UTC" on the server and "11:15 PM GMT+8" in a
 * Singapore browser. On a server-rendered path that is React #418, the class
 * Q-142 fixed. Rendering "—" until mounted makes the server's markup and the
 * client's first render identical BY CONSTRUCTION, whatever data reaches it;
 * the real value appears one effect later. Every viewer-local time in the UI
 * goes through here (`__tests__/architecture/locale-fixed.test.ts`).
 */
import { useEffect, useState } from 'react'
import { formatLocalDateTime, formatLocalTime } from '@/lib/format'

export function LocalTime({ value, withDate = false }: { value: Date | string | number | null | undefined; withDate?: boolean }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <>—</>
  return <>{withDate ? formatLocalDateTime(value) : formatLocalTime(value)}</>
}
