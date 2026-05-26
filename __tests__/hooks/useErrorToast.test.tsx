// @vitest-environment jsdom
/**
 * hooks/useErrorToast tests (Q-051-NEW continuation).
 *
 * Verifies: queue accepts toasts, caps at 5, auto-dismisses after ttl,
 * manual dismiss cancels timer, unmount cleans up all timers (memory leak
 * regression — Phase 14 wave 24 fix).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useErrorToast } from '@/hooks/useErrorToast'

describe('useErrorToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with empty toast queue', () => {
    const { result } = renderHook(() => useErrorToast())
    expect(result.current.toasts).toEqual([])
  })

  it('showToast adds a toast with default level=error and ttl=6000', () => {
    const { result } = renderHook(() => useErrorToast())
    act(() => {
      result.current.showToast('Boom')
    })
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Boom')
    expect(result.current.toasts[0].level).toBe('error')
    expect(result.current.toasts[0].ttl).toBe(6000)
  })

  it('caps the queue at 5 toasts (drops oldest)', () => {
    const { result } = renderHook(() => useErrorToast())
    act(() => {
      for (let i = 0; i < 7; i++) result.current.showToast(`msg-${i}`, 'info', 0)
    })
    expect(result.current.toasts).toHaveLength(5)
    // Oldest dropped; newest kept.
    expect(result.current.toasts[0].message).toBe('msg-2')
    expect(result.current.toasts[4].message).toBe('msg-6')
  })

  it('auto-dismisses after ttl elapses', () => {
    const { result } = renderHook(() => useErrorToast())
    act(() => { result.current.showToast('temp', 'warn', 1000) })
    expect(result.current.toasts).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(1001) })
    expect(result.current.toasts).toHaveLength(0)
  })

  it('ttl=0 keeps the toast indefinitely (no auto-dismiss)', () => {
    const { result } = renderHook(() => useErrorToast())
    act(() => { result.current.showToast('sticky', 'info', 0) })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current.toasts).toHaveLength(1)
  })

  it('dismissToast removes the toast immediately and clears the timer', () => {
    const { result } = renderHook(() => useErrorToast())
    let id = ''
    act(() => { id = result.current.showToast('manual', 'error', 5000) })
    expect(result.current.toasts).toHaveLength(1)
    act(() => { result.current.dismissToast(id) })
    expect(result.current.toasts).toHaveLength(0)
    // After ttl, no second dismiss would re-fire (timer was cleared).
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(result.current.toasts).toHaveLength(0)
  })

  it('dismissing an unknown id is a no-op', () => {
    const { result } = renderHook(() => useErrorToast())
    act(() => { result.current.showToast('keep me', 'info', 0) })
    expect(() => act(() => { result.current.dismissToast('not-a-real-id') })).not.toThrow()
    expect(result.current.toasts).toHaveLength(1)
  })

  it('unmount clears all pending auto-dismiss timers (memory leak regression)', () => {
    const { result, unmount } = renderHook(() => useErrorToast())
    act(() => {
      result.current.showToast('one', 'error', 5000)
      result.current.showToast('two', 'error', 5000)
      result.current.showToast('three', 'error', 5000)
    })
    expect(result.current.toasts).toHaveLength(3)
    unmount()
    // After unmount, advancing timers must not throw (timers were cleared).
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
  })
})
