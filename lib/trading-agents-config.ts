// Shared config for TradingAgents — used by both the API route and UI components.
// This file is NOT a route file, so it can export arbitrary values.

export const SUPPORTED_PROVIDERS = [
  'openai',
  'google',
  'anthropic',
  'deepseek',
  'xai',
  'openrouter',
  'ollama',
] as const

export type LLMProvider = (typeof SUPPORTED_PROVIDERS)[number]

// Default models per provider
export const DEFAULT_MODELS: Record<LLMProvider, { deep: string; quick: string }> = {
  openai:    { deep: 'gpt-4o',         quick: 'gpt-4o-mini' },
  google:    { deep: 'gemini-2.0-flash', quick: 'gemini-1.5-flash' },
  anthropic: { deep: 'claude-sonnet-4-20250514', quick: 'claude-3-5-haiku-20241022' },
  deepseek:  { deep: 'deepseek-v4-pro', quick: 'deepseek-chat' },
  xai:       { deep: 'grok-3',          quick: 'grok-3-mini' },
  openrouter: { deep: 'anthropic/claude-sonnet-4', quick: 'anthropic/claude-3-5-haiku' },
  ollama:    { deep: 'llama3',          quick: 'llama3' },
}

// Provider display names
export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai:    'OpenAI (GPT)',
  google:    'Google (Gemini)',
  anthropic: 'Anthropic (Claude)',
  deepseek:  'DeepSeek',
  xai:       'xAI (Grok)',
  openrouter: 'OpenRouter',
  ollama:    'Ollama (Local)',
}
