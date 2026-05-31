'use client'

import { Eye, EyeOff, Lock, CheckCircle2 } from 'lucide-react'
import { LlmDeployAssistant } from '@/components/stock/LlmDeployAssistant'
import { isLlmConnectivityCode, isLlmProviderAuthFailure } from '@/components/stock/quantlab/formatters'
import { PROVIDER_LABELS } from '@/lib/trading-agents-config'
import type { LLMProvider } from '@/lib/trading-agents-config'
import type { LlmBackendHealth } from '@/components/stock/quantlab/types'

export type LlmTabProps = {
  llmResult: Record<string, unknown> | null
  llmError: string | null
  llmErrorCode: string | null
  llmLoading: boolean
  llmProvider: LLMProvider
  llmDeepModel: string
  setLlmDeepModel: (v: string) => void
  llmQuickModel: string
  setLlmQuickModel: (v: string) => void
  llmDebateRounds: number
  setLlmDebateRounds: (v: number) => void
  llmRiskRounds: number
  setLlmRiskRounds: (v: number) => void
  llmTradeDate: string
  setLlmTradeDate: (v: string) => void
  llmHasRun: boolean
  llmApiKey: string
  llmShowKey: boolean
  setLlmShowKey: (v: boolean | ((p: boolean) => boolean)) => void
  llmHealthLoading: boolean
  llmBackendHealth: LlmBackendHealth
  checkLlmBackendHealth: () => Promise<void>
  runLlmAnalysis: () => Promise<void>
  fetchLlmLatest: () => Promise<void>
  handleApiKeyChange: (key: string) => void
  handleProviderChange: (p: LLMProvider) => void
}

export function LlmTab(props: LlmTabProps) {
  const {
    llmResult,
    llmError,
    llmErrorCode,
    llmLoading,
    llmProvider,
    llmDeepModel,
    setLlmDeepModel,
    llmQuickModel,
    setLlmQuickModel,
    llmDebateRounds,
    setLlmDebateRounds,
    llmRiskRounds,
    setLlmRiskRounds,
    llmTradeDate,
    setLlmTradeDate,
    llmHasRun,
    llmApiKey,
    llmShowKey,
    setLlmShowKey,
    llmHealthLoading,
    llmBackendHealth,
    checkLlmBackendHealth,
    runLlmAnalysis,
    fetchLlmLatest,
    handleApiKeyChange,
    handleProviderChange,
  } = props

  return (
    <div className="flex flex-col lg:flex-row-reverse gap-4 items-start">
            <LlmDeployAssistant
              backendReady={llmBackendHealth.checked && llmBackendHealth.status === 'ready'}
            />
            <div className="flex-1 min-w-0 space-y-5 w-full">
            <div
              className={`rounded-xl border p-3 ${
                llmBackendHealth.checked && llmBackendHealth.status === 'ready'
                  ? 'border-emerald-500/35 bg-emerald-950/25'
                  : 'border-slate-700/80 bg-slate-900/40'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {llmBackendHealth.checked && llmBackendHealth.status === 'ready' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        llmBackendHealth.status === 'ready'
                          ? 'bg-emerald-400'
                          : llmBackendHealth.status === 'unknown'
                            ? 'bg-slate-500'
                            : 'bg-rose-400'
                      }`}
                    />
                  )}
                  <p className="text-xs text-slate-200 font-semibold">
                    {llmBackendHealth.checked && llmBackendHealth.status === 'ready'
                      ? 'Setup complete'
                      : 'LLM backend status'}
                  </p>
                  {llmBackendHealth.checked && llmBackendHealth.status === 'ready' && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95">
                      Ready
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void checkLlmBackendHealth()}
                  disabled={llmHealthLoading}
                  className="text-[11px] rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  {llmHealthLoading ? 'Checking…' : 'Check connection'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{llmBackendHealth.message}</p>
              {llmBackendHealth.checked && llmBackendHealth.base && (
                <p className="mt-1 text-[10px] text-slate-500 font-mono break-all">
                  {llmBackendHealth.source || 'backend'}: {llmBackendHealth.base}
                </p>
              )}
            </div>
            {/* Header + config */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-amber-400 text-sm mt-0.5">⚡</span>
                <div>
                  <p className="text-xs text-amber-200/90 font-semibold">LLM Multi-Agent Analysis</p>
                  <p className="text-[10px] text-amber-200/60 mt-0.5 leading-relaxed">
                    Powered by{' '}
                    <a href="https://github.com/TauricResearch/TradingAgents" target="_blank" rel="noopener" className="underline">
                      TradingAgents
                    </a>{' '}
                    — 7 specialized agents (market, sentiment, news, fundamentals, bull/bear researchers, risk management, portfolio manager) debate
                    and produce a BUY / OVERWEIGHT / HOLD / UNDERWEIGHT / SELL rating.
                    Paste your API key below; it is sent to your TradingAgents backend for this run only, then to the LLM provider.
                  </p>
                </div>
              </div>

              {/* API Key — user-supplied; see privacy note below */}
              <div className="rounded-lg border border-amber-500/25 bg-amber-950/10 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <p className="text-[10px] text-amber-200/80 font-semibold uppercase tracking-wide">Your API Key (Required)</p>
                </div>
                <p className="text-[10px] text-amber-200/60 leading-relaxed">
                  <strong className="text-amber-200/85">Privacy:</strong> QUANTAN does not save your key in a database.
                  When you run an analysis, the key travels in one request: your browser → this site&apos;s API →{' '}
                  <em>your</em> TradingAgents server (HTTPS in production) → the LLM provider. Use a backend URL you control (e.g. Railway).
                  Stored only in this tab (<code className="font-mono">sessionStorage</code>, cleared on tab close).
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline ml-1"
                  >
                    Get an OpenAI key
                  </a>
                  {', '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Anthropic
                  </a>
                  {', '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Google AI
                  </a>
                  .
                </p>
                <div className="relative">
                  <input
                    type={llmShowKey ? 'text' : 'password'}
                    value={llmApiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="sk-...  (Paste your API key here)"
                    className="w-full rounded bg-slate-950 border border-amber-500/30 text-amber-100 px-3 py-2 pr-9 text-xs font-mono placeholder:text-amber-200/30"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="LLM provider API key"
                  />
                  <button
                    type="button"
                    onClick={() => setLlmShowKey(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-400/60 hover:text-amber-300 transition-colors"
                    title={llmShowKey ? 'Hide key' : 'Show key'}
                    aria-label={llmShowKey ? 'Hide API key' : 'Show API key'}
                  >
                    {llmShowKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Provider & model */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wide">Provider</span>
                  <select
                    value={llmProvider}
                    onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
                    className="rounded bg-slate-900 border border-slate-700 text-slate-200 px-2 py-1.5 font-mono"
                  >
                    {(Object.keys(PROVIDER_LABELS) as LLMProvider[]).map((p) => (
                      <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wide">Deep model</span>
                  <input
                    type="text"
                    value={llmDeepModel}
                    onChange={(e) => setLlmDeepModel(e.target.value)}
                    className="rounded bg-slate-900 border border-slate-700 text-slate-200 px-2 py-1.5 font-mono"
                    placeholder="gpt-4o"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wide">Quick model</span>
                  <input
                    type="text"
                    value={llmQuickModel}
                    onChange={(e) => setLlmQuickModel(e.target.value)}
                    className="rounded bg-slate-900 border border-slate-700 text-slate-200 px-2 py-1.5 font-mono"
                    placeholder="gpt-4o-mini"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wide">Trade date (YYYY-MM-DD)</span>
                  <input
                    type="text"
                    value={llmTradeDate}
                    onChange={(e) => setLlmTradeDate(e.target.value)}
                    className="rounded bg-slate-900 border border-slate-700 text-slate-200 px-2 py-1.5 font-mono"
                    placeholder="today if blank"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wide">Debate rounds</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={llmDebateRounds}
                    onChange={(e) => setLlmDebateRounds(parseInt(e.target.value) || 1)}
                    className="rounded bg-slate-900 border border-slate-700 text-slate-200 px-2 py-1.5 font-mono"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wide">Risk debate rounds</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={llmRiskRounds}
                    onChange={(e) => setLlmRiskRounds(parseInt(e.target.value) || 1)}
                    className="rounded bg-slate-900 border border-slate-700 text-slate-200 px-2 py-1.5 font-mono"
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={runLlmAnalysis}
                  disabled={
                    llmLoading ||
                    llmHealthLoading ||
                    llmBackendHealth.status === 'config_error' ||
                    llmBackendHealth.status === 'unreachable'
                  }
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                >
                  {llmLoading ? '⏳ Running agents…' : '▶ Run LLM Analysis'}
                </button>
                <button
                  type="button"
                  onClick={fetchLlmLatest}
                  disabled={llmLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  Load cached result
                </button>
              </div>
            </div>

            {/* Error */}
            {llmError && (
              <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-xs text-red-200/90">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong className="text-red-300">Error</strong>
                  {llmErrorCode && (
                    <span className="rounded bg-red-950/80 px-1.5 py-0.5 font-mono text-[10px] text-red-300/90">
                      {llmErrorCode}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-red-200/95 whitespace-pre-wrap">{llmError}</p>

                {llmErrorCode === 'missing_api_key' ? (
                  <p className="text-red-300/60 mt-2">
                    This is not a connectivity issue — add your key above to run the analysis.
                  </p>
                ) : isLlmConnectivityCode(llmErrorCode) ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-amber-200/90 font-semibold">Connectivity / deployment</p>
                    {llmBackendHealth.status === 'ready' ? (
                      <>
                        <p className="text-red-300/80">
                          The backend was healthy earlier. This is usually a temporary glitch or a timeout during the run.
                        </p>
                        <p className="text-red-300/60 mt-1">
                          Click <strong className="text-red-200/90">Check connection</strong> above, then try again. If it keeps
                          failing, open <strong className="text-red-200/90">Advanced: self-host</strong> on the right.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-red-300/80">
                          The Next.js app could not reach your TradingAgents Python server (wrong URL, server down, or env not set on Vercel).
                        </p>
                        <ol className="text-red-300/60 list-decimal pl-4 space-y-0.5">
                          <li>
                            Deploy <code className="font-mono text-red-200">server_trading_agents.py</code> to{' '}
                            <a href="https://railway.app" target="_blank" rel="noopener noreferrer" className="underline">
                              Railway
                            </a>{' '}
                            or Render (use <code className="font-mono text-red-200">Procfile</code> or start command with <code className="font-mono text-red-200">--host 0.0.0.0</code> and <code className="font-mono text-red-200">$PORT</code>).
                          </li>
                          <li>
                            In Vercel → Project → Environment Variables, set{' '}
                            <code className="font-mono text-red-200">TRADING_AGENTS_BASE</code> to your public{' '}
                            <code className="font-mono text-red-200">https://</code> origin (required in production; no trailing slash), then redeploy.
                          </li>
                          <li>Local dev: run <code className="font-mono text-red-200">python server_trading_agents.py</code> on port 3001 — no env var needed in <code className="font-mono text-red-200">npm run dev</code>.</li>
                        </ol>
                      </>
                    )}
                  </div>
                ) : isLlmProviderAuthFailure(llmErrorCode, llmError) ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-violet-200/90 font-semibold">LLM provider / API key</p>
                    <p className="text-red-300/80">
                      The TradingAgents backend reached the LLM provider, but authentication failed or the key was rejected. Check the key, billing, and model access — this is not a Vercel–Railway connectivity issue.
                    </p>
                    <p className="text-red-300/60">
                      Provider:{' '}
                      {llmProvider === 'openai'
                        ? 'OpenAI'
                        : llmProvider === 'anthropic'
                          ? 'Anthropic'
                          : llmProvider === 'google'
                            ? 'Google AI'
                            : PROVIDER_LABELS[llmProvider]}{' '}
                      — QUANTAN does not store your key.
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {/* Result */}
            {llmHasRun && llmResult && !llmError && (() => {
              // R5-C-5 (Phase 14): replace `as any` with a runtime-validated
              // narrow accessor. We do NOT trust the LLM backend response
              // shape — every field is read via getStr() which returns ''
              // for missing/non-string fields. This keeps TS strict and
              // prevents silent runtime errors on schema drift.
              const r = llmResult as Record<string, unknown>
              const getStr = (k: string): string => {
                const v = r[k]
                return typeof v === 'string' ? v : ''
              }
              const getNum = (k: string): number | null => {
                const v = r[k]
                return typeof v === 'number' && Number.isFinite(v) ? v : null
              }
              const decision = getStr('decision')
              const decisionGrade = getStr('decision_grade')
              const confidenceLabel = getStr('confidence_label')
              const elapsedSeconds = getNum('elapsed_seconds')
              const llmProviderField = getStr('llm_provider')
              const modelUsed = getStr('model_used')
              const investmentPlan = getStr('investment_plan')
              const finalTradeDecision = getStr('final_trade_decision')
              return (
              <div className="space-y-4">
                {/* Decision banner */}
                {decision && (
                  <div
                    className={`rounded-xl border p-5 text-center ${
                      decisionGrade === 'BUY'
                        ? 'border-green-500/40 bg-green-950/20'
                        : decisionGrade === 'SELL'
                          ? 'border-red-500/40 bg-red-950/20'
                          : 'border-yellow-500/40 bg-yellow-950/10'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">Final decision</div>
                    <div className="text-4xl font-bold font-mono text-white">
                      {decisionGrade}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {confidenceLabel} confidence &middot;{' '}
                      {elapsedSeconds != null ? `${elapsedSeconds}s` : '—'} &middot;{' '}
                      {llmProviderField}/{modelUsed || '—'}
                    </div>
                  </div>
                )}

                {/* Analyst reports */}
                {(['market_report', 'sentiment_report', 'news_report', 'fundamentals_report'] as const).map(
                  (field) => {
                    const val = getStr(field)
                    if (!val) return null
                    return (
                      <div key={field} className="rounded-xl border border-slate-800 p-4">
                        <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">
                          {field.replace('_', ' ')}
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{val}</p>
                      </div>
                    )
                  }
                )}

                {/* Investment plan */}
                {investmentPlan && (
                  <div className="rounded-xl border border-blue-500/20 bg-blue-950/10 p-4">
                    <div className="text-[10px] uppercase tracking-widest text-blue-400 mb-2">Investment plan</div>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {investmentPlan}
                    </p>
                  </div>
                )}

                {/* Risk debate + final decision */}
                {finalTradeDecision && (
                  <div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-4">
                    <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-2">Risk debate + final decision</div>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {finalTradeDecision}
                    </p>
                  </div>
                )}
              </div>
              )
            })()}

            {/* Not run yet */}
            {!llmHasRun && !llmError && !llmLoading && (
              <div className="text-center py-10 text-slate-400 text-sm">
                Click <strong className="text-slate-400">Run LLM Analysis</strong> to start the multi-agent debate.
              </div>
            )}
            </div>
    </div>
  )
}
