import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { getSetting } from './settings-store'
import { loadSkillsContext } from './skills-loader'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

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

function buildChatModel(config: LLMConfig, model: string, maxTokens: number) {
  if (config.providerType === 'anthropic') {
    return new ChatAnthropic({
      model,
      apiKey: config.apiKey,
      maxTokens,
      ...(config.baseURL ? { anthropicApiUrl: config.baseURL } : {}),
    })
  }

  const baseURL =
    config.providerType === 'deepseek'
      ? config.baseURL || 'https://api.deepseek.com'
      : config.baseURL || 'https://api.openai.com/v1'

  return new ChatOpenAI({
    model,
    apiKey: config.apiKey,
    maxTokens,
    configuration: { baseURL },
  })
}

interface CallOptions {
  maxTokens?: number
  maxRetries?: number
  timeoutMs?: number
  modelOverride?: string
  /** 是否注入 skills 上下文（默认 false） */
  useSkills?: boolean
}

export async function callClaude(
  systemPrompt: string,
  userMessageOrMessages: string | ChatMessage[],
  options?: CallOptions
): Promise<string> {
  const config = getConfig()
  if (!config) throw new Error('AI API not configured. Please set API key in Settings.')

  const model = options?.modelOverride || config.model
  const maxTokens = options?.maxTokens ?? 4096
  const maxRetries = options?.maxRetries ?? 3
  const timeoutMs = options?.timeoutMs ?? 120_000

  const chatModel = buildChatModel(config, model, maxTokens)

  const messages: ChatMessage[] =
    typeof userMessageOrMessages === 'string'
      ? [{ role: 'user', content: userMessageOrMessages }]
      : userMessageOrMessages

  // 注入 skills 上下文到 system prompt
  let finalSystemPrompt = systemPrompt
  if (options?.useSkills) {
    const skillsContext = loadSkillsContext()
    if (skillsContext) {
      finalSystemPrompt = `${systemPrompt}\n\n${skillsContext}`
    }
  }

  const langchainMessages = [
    new SystemMessage(finalSystemPrompt),
    ...messages.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
    ),
  ]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let lastErr: unknown
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await chatModel.invoke(langchainMessages, { signal: controller.signal })
        return typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
      } catch (err) {
        lastErr = err
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  } finally {
    clearTimeout(timeout)
  }
  throw lastErr
}
