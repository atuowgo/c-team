import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { getSetting } from './settings-store'

type ProviderType = 'anthropic' | 'openai-compatible' | 'deepseek'

interface LLMConfig {
  providerType: ProviderType
  baseURL: string
  apiKey: string
  model: string
}

const PROVIDER_DEFAULT_MODEL: Record<ProviderType, string> = {
  anthropic: 'claude-sonnet-4-6',
  'openai-compatible': 'gpt-4o',
  deepseek: 'deepseek-v4-flash',
}

function normalizeModel(providerType: ProviderType, model: string): string {
  if (providerType !== 'deepseek') return model
  if (model === 'deepseek-chat' || model === 'deepseek-reasoner') return 'deepseek-v4-flash'
  return model
}

function getConfig(): LLMConfig | null {
  const apiKey = getSetting('apiKey') as string | null
  if (!apiKey) return null

  const providerType = ((getSetting('providerType') as string | null) || 'deepseek') as ProviderType
  const configuredModel = (getSetting('model') as string | null) || PROVIDER_DEFAULT_MODEL[providerType] || 'claude-sonnet-4-6'
  const model = normalizeModel(providerType, configuredModel)
  const baseURL = (getSetting('baseURL') as string | null) || ''

  return { providerType, baseURL, apiKey, model }
}

interface CallOptions {
  maxTokens?: number
  maxRetries?: number
  timeoutMs?: number
  modelOverride?: string
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  options?: CallOptions
): Promise<string> {
  const config = getConfig()
  if (!config) throw new Error('AI API not configured. Please set API key in Settings.')

  const model = options?.modelOverride || config.model

  let llmModel
  if (config.providerType === 'anthropic') {
    const provider = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    })
    llmModel = provider(model)
  } else if (config.providerType === 'deepseek') {
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.deepseek.com',
    })
    llmModel = provider.chat(model)
  } else {
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.openai.com/v1',
    })
    llmModel = provider(model)
  }

  const timeoutMs = options?.timeoutMs ?? 120_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { text } = await generateText({
      model: llmModel,
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: options?.maxTokens ?? 4096,
      maxRetries: options?.maxRetries ?? 3,
      abortSignal: controller.signal,
    })
    return text
  } finally {
    clearTimeout(timeout)
  }
}
