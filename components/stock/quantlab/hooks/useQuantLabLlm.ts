'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_MODELS, type LLMProvider } from '@/lib/trading-agents-config'
import { isLlmConnectivityCode } from '@/components/stock/quantlab/formatters'
import type { LlmBackendHealth, QuantLabSubTab } from '@/components/stock/quantlab/types'

export function useQuantLabLlm(ticker: string, sub: QuantLabSubTab) {
  const [llmResult, setLlmResult] = useState<Record<string, unknown> | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmErrorCode, setLlmErrorCode] = useState<string | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('openai')
  const [llmDeepModel, setLlmDeepModel] = useState('gpt-4o')
  const [llmQuickModel, setLlmQuickModel] = useState('gpt-4o-mini')
  const [llmDebateRounds, setLlmDebateRounds] = useState(1)
  const [llmRiskRounds, setLlmRiskRounds] = useState(1)
  const [llmTradeDate, setLlmTradeDate] = useState('')
  const [llmHasRun, setLlmHasRun] = useState(false)
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmShowKey, setLlmShowKey] = useState(false)
  const [llmHealthLoading, setLlmHealthLoading] = useState(false)
  const [llmBackendHealth, setLlmBackendHealth] = useState<LlmBackendHealth>({
    checked: false,
    status: 'unknown',
    message: 'Checking backend status…',
  })

  const checkLlmBackendHealth = useCallback(async () => {
    setLlmHealthLoading(true)
    try {
      const r = await fetch('/api/trading-agents/health', { cache: 'no-store' })
      const j = (await r.json()) as Record<string, unknown>
      const status = String(j.status || 'unknown')
      if (status === 'ready') {
        setLlmBackendHealth({
          checked: true,
          status: 'ready',
          message: 'Backend connected and ready.',
          source: typeof j.source === 'string' ? j.source : undefined,
          base: typeof j.base === 'string' ? j.base : undefined,
        })
        setLlmErrorCode((prev) => {
          if (prev && isLlmConnectivityCode(prev)) {
            setLlmError(null)
            return null
          }
          return prev
        })
      } else if (status === 'config_error') {
        setLlmBackendHealth({
          checked: true,
          status: 'config_error',
          message: 'Backend is not configured yet. Use the Deploy button to set it up.',
          source: typeof j.source === 'string' ? j.source : undefined,
          base: typeof j.base === 'string' ? j.base : undefined,
        })
      } else {
        setLlmBackendHealth({
          checked: true,
          status: 'unreachable',
          message: 'Backend is configured but unreachable. Check service status or URL.',
          source: typeof j.source === 'string' ? j.source : undefined,
          base: typeof j.base === 'string' ? j.base : undefined,
        })
      }
    } catch {
      setLlmBackendHealth({
        checked: true,
        status: 'unreachable',
        message: 'Failed to check backend status due to a network error.',
      })
    } finally {
      setLlmHealthLoading(false)
    }
  }, [])

  const runLlmAnalysis = useCallback(async () => {
    if (!llmApiKey.trim()) {
      setLlmErrorCode('missing_api_key')
      setLlmError(
        'Please enter your API key first. It stays in your browser until you run an analysis (sessionStorage; cleared when the tab closes).',
      )
      return
    }
    setLlmLoading(true)
    setLlmError(null)
    setLlmErrorCode(null)
    setLlmResult(null)
    setLlmHasRun(false)
    try {
      const body: Record<string, unknown> = {
        llm_provider: llmProvider,
        deep_think_llm: llmDeepModel,
        quick_think_llm: llmQuickModel,
        max_debate_rounds: llmDebateRounds,
        max_risk_discuss_rounds: llmRiskRounds,
        api_key: llmApiKey.trim(),
      }
      if (llmTradeDate) body.trade_date = llmTradeDate
      const r = await fetch(`/api/trading-agents/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      let j: Record<string, unknown> = {}
      try {
        j = await r.json()
      } catch {
        setLlmErrorCode('parse_error')
        setLlmError(
          'Invalid response from analysis API. Check that TRADING_AGENTS_BASE points to a running TradingAgents server.',
        )
        return
      }
      if (!r.ok) {
        const code = typeof j.error === 'string' ? j.error : 'unknown'
        const msg =
          (typeof j.message === 'string' && j.message) ||
          (typeof j.details === 'string' && j.details) ||
          (typeof j.error === 'string' && j.error) ||
          r.statusText
        setLlmErrorCode(code)
        setLlmError(msg)
        return
      }
      setLlmResult(j)
      setLlmHasRun(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'LLM analysis failed'
      setLlmErrorCode('network_error')
      setLlmError(msg)
    } finally {
      setLlmLoading(false)
    }
  }, [ticker, llmProvider, llmDeepModel, llmQuickModel, llmDebateRounds, llmRiskRounds, llmTradeDate, llmApiKey])

  const fetchLlmLatest = useCallback(async () => {
    setLlmLoading(true)
    setLlmError(null)
    setLlmErrorCode(null)
    try {
      const r = await fetch(`/api/trading-agents/${encodeURIComponent(ticker)}`)
      let j: Record<string, unknown> = {}
      try {
        j = await r.json()
      } catch {
        setLlmErrorCode('parse_error')
        setLlmError('Invalid response when loading cached analysis.')
        return
      }
      if (r.ok) {
        setLlmResult(j)
        setLlmHasRun(true)
        return
      }
      if (r.status === 404) return
      const code = typeof j.error === 'string' ? j.error : 'unknown'
      const msg =
        (typeof j.message === 'string' && j.message) ||
        (typeof j.details === 'string' && j.details) ||
        r.statusText
      setLlmErrorCode(code)
      setLlmError(msg)
    } catch (e) {
      setLlmErrorCode('network_error')
      setLlmError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLlmLoading(false)
    }
  }, [ticker])

  const handleApiKeyChange = useCallback((key: string) => {
    setLlmApiKey(key)
    try {
      if (key.trim()) sessionStorage.setItem('llm_api_key', key)
      else sessionStorage.removeItem('llm_api_key')
    } catch (err) {
      console.warn('[QuantLabPanel] sessionStorage write failed', err)
    }
  }, [])

  const handleProviderChange = useCallback((p: LLMProvider) => {
    setLlmProvider(p)
    const defaults = DEFAULT_MODELS[p]
    if (defaults) {
      setLlmDeepModel(defaults.deep)
      setLlmQuickModel(defaults.quick)
    }
  }, [])

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('llm_api_key')
      if (saved) setLlmApiKey(saved)
    } catch (err) {
      console.warn('[QuantLabPanel] sessionStorage read failed', err)
    }
  }, [])

  useEffect(() => {
    if (sub !== 'llm' || llmBackendHealth.checked || llmHealthLoading) return
    void checkLlmBackendHealth()
  }, [sub, llmBackendHealth.checked, llmHealthLoading, checkLlmBackendHealth])

  return {
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
  }
}
