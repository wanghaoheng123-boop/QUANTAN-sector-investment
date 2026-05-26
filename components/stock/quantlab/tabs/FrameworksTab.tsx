'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { CODEX_FRAMEWORKS } from '@/lib/quant/frameworks'
import { frameworkIcon } from '@/components/stock/quantlab/frameworkIcons'

export function FrameworksTab() {
  const [openFrameworkId, setOpenFrameworkId] = useState<string | null>(null)
  return (
    <div className="space-y-4">
            <p className="text-xs text-slate-500 leading-relaxed">
              Seven <strong className="text-slate-400">framework themes</strong> distilled from your QUANTAN Investment Codex (pillars / sprints). They are checklists for disciplined thinking — not impersonations of any investor and not trade instructions.
            </p>
            <div className="space-y-3">
              {CODEX_FRAMEWORKS.map((f) => {
                const open = openFrameworkId === f.id
                return (
                  <div
                    key={f.id}
                    className={`rounded-xl border border-slate-800 bg-slate-900/30 transition-colors ${open ? 'bg-slate-900/50' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFrameworkId(open ? null : f.id)}
                      className="cursor-pointer w-full flex items-center gap-3 p-4 text-left"
                    >
                      {frameworkIcon(f.id)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white">{f.title}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">{f.themes[0]}</div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="px-4 pb-4 pt-0 space-y-3 border-t border-slate-800/60">
                        <ul className="text-xs text-slate-400 space-y-1 list-disc pl-4">
                          {f.themes.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                        <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Checklist</div>
                        <ul className="text-xs text-slate-300 space-y-1.5">
                          {f.checklist.map((c) => (
                            <li key={c} className="flex gap-2">
                              <span className="text-blue-500 shrink-0">▸</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
    </div>
  )
}
