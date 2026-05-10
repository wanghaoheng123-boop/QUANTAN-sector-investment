'use client'

import { useEffect, useRef } from 'react'
import type { BacktestResult } from '@/lib/backtest/engine'

interface Props {
  instruments: BacktestResult[]
  initialCapital: number
}

export default function EquityCurveChart({ instruments, initialCapital }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || instruments.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)

      const W = rect.width
      const H = rect.height
      const PAD = { top: 20, right: 60, bottom: 40, left: 60 }
      const innerW = W - PAD.left - PAD.right
      const innerH = H - PAD.top - PAD.bottom

      ctx.clearRect(0, 0, W, H)

      // Background
      ctx.fillStyle = '#0a0a12'
      ctx.fillRect(0, 0, W, H)

      // Find global min/max for normalization
      let globalMax = -Infinity
      let globalMin = Infinity
      for (const inst of instruments) {
        const curve = inst.equityCurve
        if (!curve || curve.length === 0) continue
        for (const v of curve) {
          if (v > globalMax) globalMax = v
          if (v < globalMin) globalMin = v
        }
      }
      // Add 5% padding
      const range = globalMax - globalMin || 1
      globalMin = globalMin - range * 0.05
      globalMax = globalMax + range * 0.05

      const toX = (i: number, len: number) => PAD.left + (i / (len - 1)) * innerW
      const toY = (v: number) => PAD.top + ((globalMax - v) / (globalMax - globalMin)) * innerH

      // Grid lines
      ctx.strokeStyle = '#1e1e2e'
      ctx.lineWidth = 1
      const gridCount = 5
      for (let g = 0; g <= gridCount; g++) {
        const v = globalMin + (g / gridCount) * (globalMax - globalMin)
        const y = toY(v)
        ctx.beginPath()
        ctx.moveTo(PAD.left, y)
        ctx.lineTo(PAD.left + innerW, y)
        ctx.stroke()
        ctx.fillStyle = '#475569'
        ctx.font = '10px monospace'
        ctx.textAlign = 'right'
        ctx.fillText(`$${(v / 1000).toFixed(0)}K`, PAD.left - 4, y + 3)
      }

      // Zero line (initial capital)
      const zeroY = toY(initialCapital)
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(PAD.left, zeroY)
      ctx.lineTo(PAD.left + innerW, zeroY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#64748b'
      ctx.font = '9px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`$${(initialCapital / 1000).toFixed(0)}K`, PAD.left - 4, zeroY + 3)

      // Draw each instrument curve
      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16']
      for (let idx = 0; idx < instruments.length; idx++) {
        const inst = instruments[idx]
        const curve = inst.equityCurve
        if (!curve || curve.length === 0) continue
        const color = colors[idx % colors.length]
        const isPositive = inst.totalReturn >= 0
        ctx.strokeStyle = color + (isPositive ? 'cc' : '66')
        ctx.lineWidth = idx === 0 ? 2 : 1
        ctx.beginPath()
        for (let i = 0; i < curve.length; i++) {
          const x = toX(i, curve.length)
          const y = toY(curve[i])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // Legend
      ctx.font = '10px monospace'
      ctx.textAlign = 'left'
      for (let idx = 0; idx < instruments.length; idx++) {
        const inst = instruments[idx]
        const color = colors[idx % colors.length]
        const label = `${inst.ticker} (${inst.totalReturn >= 0 ? '+' : ''}${(inst.totalReturn * 100).toFixed(1)}%)`
        const x = PAD.left + (idx < 4 ? idx * 130 : (idx - 4) * 130)
        const y = H - 8
        ctx.fillStyle = color
        ctx.fillRect(x, y - 8, 12, 2)
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(label, x + 16, y)
      }
    }

    draw()

    // Respond to container resize
    resizeRef.current = new ResizeObserver(() => { draw() })
    resizeRef.current.observe(container)

    return () => {
      resizeRef.current?.disconnect()
      resizeRef.current = null
    }
  }, [instruments, initialCapital])

  // F6.2 (Phase 13 S2): chart text alternative summarising aggregate equity
  // performance for screen-reader users (WCAG 1.1.1).
  const totalReturn = instruments.length > 0
    ? instruments.reduce((s, r) => s + r.totalReturn, 0) / instruments.length
    : 0
  const winningInstruments = instruments.filter((r) => r.totalReturn > 0).length
  const ariaLabel = instruments.length === 0
    ? 'Equity curve chart — no data'
    : `Equity curve chart — ${instruments.length} instruments, ` +
      `${winningInstruments} positive total return, ` +
      `mean total return ${(totalReturn * 100).toFixed(1)}%.`

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className="w-full rounded-lg"
      style={{ height: 280 }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-lg"
        aria-hidden="true"
      />
    </div>
  )
}
