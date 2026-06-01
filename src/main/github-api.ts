import { getSetting } from './settings-store'

interface GitHubConfig {
  token: string
  owner: string
  repo: string
}

function getConfig(): GitHubConfig | null {
  const token = getSetting('ghToken') as string | null
  const owner = getSetting('ghOwner') as string | null
  const repo = getSetting('ghRepo') as string | null

  if (!token || !owner || !repo) return null
  return { token, owner, repo }
}

function baseUrl(config: GitHubConfig): string {
  return `https://api.github.com/repos/${config.owner}/${config.repo}`
}

function authHeaders(config: GitHubConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

async function githubFetch(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  let lastStatus = 0

  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await fetch(url, options)

    if (resp.ok) return resp

    lastStatus = resp.status

    // Rate limited: use Retry-After header or default 60s
    if (resp.status === 429) {
      const retryAfter = resp.headers.get('Retry-After')
      const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, wait))
        continue
      }
    }

    // Server errors: retry with backoff
    if (resp.status >= 500 && attempt < retries) {
      const backoff = Math.min(1000 * Math.pow(2, attempt), 16000)
      await new Promise(resolve => setTimeout(resolve, backoff))
      continue
    }

    // Client errors (4xx, not 429): don't retry
    if (resp.status !== 429 && resp.status < 500) {
      const err = await resp.text().catch(() => 'Unknown error')
      throw new Error(`GitHub API error ${resp.status}: ${err}`)
    }
  }

  const err = await responseTextFallback(url, lastStatus, options)
  throw new Error(`GitHub API error ${lastStatus}: ${err}`)
}

async function responseTextFallback(url: string, status: number, options: RequestInit): Promise<string> {
  try {
    const resp = await fetch(url, options)
    return await resp.text()
  } catch {
    return 'Unknown error'
  }
}

export async function createBranch(branchName: string, baseBranch = 'main'): Promise<void> {
  const config = getConfig()
  if (!config) throw new Error('GitHub not configured')

  // Get base branch SHA
  const refResp = await githubFetch(`${baseUrl(config)}/git/ref/heads/${baseBranch}`, {
    headers: authHeaders(config)
  })
  const refData = await refResp.json()
  const sha = refData.object.sha

  // Create new branch
  try {
    await githubFetch(`${baseUrl(config)}/git/refs`, {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha })
    })
  } catch (e) {
    // 422 = already exists — not an error for our use case
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes('422')) throw e
  }
}

export async function commitFile(
  branch: string,
  path: string,
  content: string,
  message: string
): Promise<void> {
  const config = getConfig()
  if (!config) throw new Error('GitHub not configured')

  // Check if file exists
  let sha: string | undefined
  const existingResp = await githubFetch(`${baseUrl(config)}/contents/${path}?ref=${branch}`, {
    headers: authHeaders(config)
  })
  if (existingResp.ok) {
    const existing = await existingResp.json()
    sha = existing.sha
  }

  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch
  }
  if (sha) body.sha = sha

  const resp = await githubFetch(`${baseUrl(config)}/contents/${path}`, {
    method: 'PUT',
    headers: authHeaders(config),
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Failed to commit file: ${resp.status} ${err}`)
  }
}

export async function createPullRequest(
  title: string,
  head: string,
  base = 'main',
  body = ''
): Promise<{ number: number; url: string }> {
  const config = getConfig()
  if (!config) throw new Error('GitHub not configured')

  const resp = await githubFetch(`${baseUrl(config)}/pulls`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ title, head, base, body })
  })
  const data = await resp.json()
  return { number: data.number, url: data.html_url }
}

export async function listIssues(labels?: string[]): Promise<Array<{ number: number; title: string; url: string }>> {
  const config = getConfig()
  if (!config) throw new Error('GitHub not configured')

  let url = `${baseUrl(config)}/issues?state=open`
  if (labels?.length) url += `&labels=${labels.join(',')}`

  const resp = await githubFetch(url, { headers: authHeaders(config) })
  const data = await resp.json()
  return data.map((i: Record<string, unknown>) => ({
    number: i.number,
    title: i.title,
    url: i.html_url
  }))
}

export function isConfigured(): boolean {
  return getConfig() !== null
}