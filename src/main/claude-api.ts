import { getSetting } from './settings-store'

interface ClaudeConfig {
  apiKey: string
  model: string
}

function getConfig(): ClaudeConfig | null {
  const apiKey = getSetting('apiKey') as string | null
  const model = (getSetting('model') as string) || 'claude-sonnet-4-6'

  if (!apiKey) return null
  return { apiKey, model }
}

interface CallOptions {
  maxTokens?: number
  maxRetries?: number
  timeoutMs?: number
}

async function callClaudeOnce(
  systemPrompt: string,
  userMessage: string,
  config: ClaudeConfig,
  signal: AbortSignal,
  options?: CallOptions
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    }),
    signal
  })

  if (!response.ok) {
    const err = await response.text().catch(() => 'Unknown error')
    const status = response.status
    // Distinguish retryable vs non-retryable errors
    if (status === 429 || status === 529) {
      throw new RetryableError(`Claude API rate limited (${status}): ${err}`, status)
    }
    if (status >= 500) {
      throw new RetryableError(`Claude API server error (${status}): ${err}`, status)
    }
    throw new Error(`Claude API error ${status}: ${err}`)
  }

  const data = await response.json()
  const text = data?.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new Error(`Claude API returned unexpected response format: ${JSON.stringify(data).slice(0, 200)}`)
  }
  return text
}

class RetryableError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'RetryableError'
    this.status = status
  }
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  options?: CallOptions
): Promise<string> {
  const config = getConfig()
  if (!config) throw new Error('Claude API not configured. Please set API key in Settings.')

  const maxRetries = options?.maxRetries ?? 3
  const timeoutMs = options?.timeoutMs ?? 120_000

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const result = await callClaudeOnce(systemPrompt, userMessage, config, controller.signal, options)
      clearTimeout(timeout)
      return result
    } catch (err) {
      clearTimeout(timeout)

      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new Error(`Claude API request timed out after ${timeoutMs / 1000}s`)
      } else if (err instanceof Error) {
        lastError = err
      } else {
        lastError = new Error(String(err))
      }

      // Don't retry on non-retryable errors (e.g., auth failure)
      if (!(lastError instanceof RetryableError) && !(err instanceof DOMException && err.name === 'AbortError')) {
        throw lastError
      }

      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 16000)
        await new Promise(resolve => setTimeout(resolve, backoff))
      }
    }
  }

  throw lastError || new Error('Claude API request failed after retries')
}