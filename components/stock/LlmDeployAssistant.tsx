'use client'

import { useCallback, useEffect, useState } from 'react'
import { Rocket, ExternalLink, Copy, Check, X, CheckCircle2 } from 'lucide-react'

/** Subfolder that contains `server_trading_agents.py` when the Git repo is the monorepo root. */
const DEFAULT_ROOT_DIR = 'antigravity-sectors'

const RAILWAY_NEW = 'https://railway.app/new'
const RAILWAY_DOCS_PYTHON = 'https://docs.railway.app/guides/languages/python'

type Props = {
  /** Railway / monorepo root directory (service watches this folder). */
  repoServiceRoot?: string
  /**
   * When the health check reports a reachable backend, hide the loud “deploy now” prompts
   * and show a compact “Advanced setup” entry instead.
   */
  backendReady?: boolean
}

export function LlmDeployAssistant({ repoServiceRoot = DEFAULT_ROOT_DIR, backendReady = false }: Props) {
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setCopiedId('err')
      window.setTimeout(() => setCopiedId(null), 2000)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const openRailway = useCallback(() => {
    window.open(RAILWAY_NEW, '_blank', 'noopener,noreferrer')
  }, [])

  const localInstallCmd = `cd ${repoServiceRoot}
python -m pip install -r requirements.txt
python server_trading_agents.py`

  return (
    <>
      {/* Desktop: sticky rail — full deploy CTA until backend is healthy, then compact “Advanced” only */}
      <aside
        className={`hidden lg:flex flex-col gap-2 w-[8.5rem] shrink-0 sticky top-3 self-start rounded-xl p-2.5 ${
          backendReady
            ? 'border border-emerald-500/30 bg-emerald-950/20'
            : 'border border-amber-500/20 bg-slate-950/80'
        }`}
      >
        {backendReady ? (
          <>
            <div className="flex flex-col items-center gap-1 text-center px-1">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" aria-hidden />
              <span className="text-[10px] font-bold text-emerald-100 leading-tight uppercase tracking-wide">
                Setup
                <br />
                complete
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[10px] rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-2 py-2 text-emerald-200/90 hover:bg-emerald-900/40 transition-colors"
            >
              Advanced: self-host
            </button>
            <p className="text-[9px] text-emerald-200/50 text-center leading-snug">Optional Railway guide</p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex flex-col items-center gap-1.5 rounded-lg bg-gradient-to-b from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white px-2 py-3 text-center shadow-lg shadow-amber-900/30 transition-colors"
            >
              <Rocket className="w-5 h-5" aria-hidden />
              <span className="text-[10px] font-bold leading-tight uppercase tracking-wide">
                Deploy
                <br />
                LLM agent
              </span>
            </button>
            <p className="text-[9px] text-slate-500 text-center leading-snug">
              Opens guided setup (Railway + Vercel env)
            </p>
          </>
        )}
      </aside>

      {/* Mobile / narrow */}
      <div className="lg:hidden w-full">
        {backendReady ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-950/25 px-4 py-2.5 text-emerald-100 text-xs font-semibold hover:bg-emerald-950/40 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            Setup complete · Advanced self-host
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-950/30 px-4 py-3 text-amber-100 text-xs font-semibold hover:bg-amber-950/50 transition-colors"
          >
            <Rocket className="w-4 h-4 shrink-0 text-amber-400" />
            Deploy LLM agent backend (Railway)
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="llm-deploy-title"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6 pt-8 space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-amber-500/15 p-2 text-amber-400">
                  <Rocket className="w-6 h-6" />
                </div>
                <div>
                  <h2 id="llm-deploy-title" className="text-lg font-semibold text-white">
                    Deploy the TradingAgents backend
                  </h2>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {backendReady ? (
                      <>
                        Your app is already connected to a healthy backend. Use this guide only if you want to{' '}
                        <strong className="text-slate-300">self-host</strong> or change infrastructure.
                      </>
                    ) : (
                      <>
                        Browsers cannot install software on your machine or log into Railway for you. This wizard opens
                        Railway’s deploy flow and copies the values you need — the closest thing to a one-click setup.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-4 py-3 space-y-2">
                <p className="text-[11px] font-semibold text-emerald-200/90 uppercase tracking-wide">Step 1 — Railway (Python API)</p>
                <button
                  type="button"
                  onClick={openRailway}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2.5 px-4 transition-colors"
                >
                  Open Railway — new project
                  <ExternalLink className="w-4 h-4" />
                </button>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Choose <strong className="text-slate-300">Deploy from GitHub</strong>, pick this repository, then set{' '}
                  <strong className="text-slate-300">Root Directory</strong> to:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] font-mono bg-slate-900 rounded px-2 py-1.5 text-amber-100 truncate">
                    {repoServiceRoot}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(repoServiceRoot, 'root')}
                    className="shrink-0 rounded-lg border border-slate-600 p-2 text-slate-300 hover:bg-slate-800"
                    title="Copy"
                  >
                    {copiedId === 'root' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  Railway uses the repo <code className="text-slate-400">Procfile</code> and{' '}
                  <code className="text-slate-400">requirements.txt</code> automatically.{' '}
                  <a href={RAILWAY_DOCS_PYTHON} target="_blank" rel="noopener noreferrer" className="text-emerald-400/90 underline">
                    Python on Railway
                  </a>
                </p>
              </div>

              <div className="rounded-xl border border-violet-500/25 bg-violet-950/15 px-4 py-3 space-y-2">
                <p className="text-[11px] font-semibold text-violet-200/90 uppercase tracking-wide">Step 2 — Vercel env</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  After Railway shows a public URL (must start with <code className="text-slate-300">https://</code>), add it to
                  Vercel:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] font-mono bg-slate-900 rounded px-2 py-1.5 text-violet-200 truncate">
                    TRADING_AGENTS_BASE=https://…up.railway.app
                  </code>
                  <button
                    type="button"
                    onClick={() => copy('TRADING_AGENTS_BASE', 'envname')}
                    className="shrink-0 rounded-lg border border-slate-600 p-2 text-slate-300 hover:bg-slate-800"
                    title="Copy variable name"
                  >
                    {copiedId === 'envname' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Redeploy the Next.js app after saving the variable.</p>
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 px-4 py-3 space-y-2">
                <p className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Local install (optional)</p>
                <p className="text-[10px] text-slate-500">Run the Python server on your machine next to <code className="text-slate-400">npm run dev</code>:</p>
                <div className="relative">
                  <pre className="text-[10px] font-mono bg-black/40 rounded-lg p-3 pr-10 text-slate-300 whitespace-pre-wrap break-all overflow-x-auto max-h-28 overflow-y-auto">
                    {localInstallCmd}
                  </pre>
                  <button
                    type="button"
                    onClick={() => copy(localInstallCmd.replace(/\r\n/g, '\n'), 'localcmd')}
                    className="absolute right-2 top-2 rounded border border-slate-600 p-1.5 text-slate-400 hover:bg-slate-800"
                    title="Copy command"
                  >
                    {copiedId === 'localcmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-lg border border-slate-600 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
