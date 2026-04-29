'use client'

import { useState, useEffect } from 'react'

interface MarketStatusData {
  label: string
  color: string
  bgColor: string
  borderColor: string
}

function getMarketStatus(): MarketStatusData {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const hours = et.getHours() * 60 + et.getMinutes()
  const day = et.getDay()
  const isWeekend = day === 0 || day === 6

  if (isWeekend) {
    return { label: 'CLOSED', color: 'text-slate-400', bgColor: 'bg-slate-800/50', borderColor: 'border-slate-700' }
  }
  if (hours < 570) {
    return { label: 'PRE', color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' }
  }
  if (hours >= 570 && hours < 960) {
    return { label: 'RTH', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' }
  }
  return { label: 'AH', color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30' }
}

export default function MarketStatus() {
  const [status, setStatus] = useState<MarketStatusData | null>(null)

  useEffect(() => {
    setStatus(getMarketStatus())
    const interval = setInterval(() => setStatus(getMarketStatus()), 60000)
    return () => clearInterval(interval)
  }, [])

  if (!status) return null

  return (
    <div
      role="status"
      aria-label={`Market status: ${status.label === 'RTH' ? 'Regular Trading Hours' : status.label === 'PRE' ? 'Pre-Market' : status.label === 'AH' ? 'After-Hours' : 'Closed'}`}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-mono font-medium ${status.bgColor} ${status.borderColor} ${status.color}`}
      title="Market hours (Eastern Time): Pre-market 4:00 AM - 9:30 AM, Regular 9:30 AM - 4:00 PM, After-hours 4:00 PM - 8:00 PM"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${
        status.label === 'CLOSED' ? 'bg-slate-500' :
        status.label === 'PRE' ? 'bg-amber-400 animate-pulse' :
        status.label === 'RTH' ? 'bg-emerald-400 animate-pulse' :
        'bg-blue-400'
      }`} />
      {status.label}
    </div>
  )
}
