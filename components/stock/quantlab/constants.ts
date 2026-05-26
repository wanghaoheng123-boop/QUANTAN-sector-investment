import type { QuantLabSubTab } from '@/components/stock/quantlab/types'

export const QUANT_LAB_DEFAULT_QUERY = 'wacc=0.09&tg=0.025&gBear=0.02&gBase=0.05&gBull=0.09'

export const QUANT_LAB_TABS: { key: QuantLabSubTab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'technicals', label: 'Technicals & RS' },
  { key: 'financials', label: 'Financials' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'llm', label: 'LLM Agents' },
  { key: 'frameworks', label: 'Codex frameworks' },
]
