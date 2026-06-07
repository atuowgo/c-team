import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { callClaude } from './claude-api'

// ---------------------------------------------------------------------------
// Row shape helpers (better-sqlite3 returns unknown from .get()/.all())
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string
  channel_id: string
  sender_id: string
  content: string
  parent_id: string | null
  reply_to_id: string | null
  created_at: string
}

interface ColleagueNotesRow {
  colleague_id: string
  channel_id: string
  notes: string
  updated_at: string
}

interface ChannelMemoryRow {
  channel_id: string
  summary: string
  updated_at: string
}

interface TopicSummaryRow {
  topic_id: string
  channel_id: string
  summary: string
  message_count: number
  updated_at: string
}

interface MemoryJobRow {
  id: string
  type: string
  payload: string
  status: string
  created_at: string
}

// ---------------------------------------------------------------------------
// assembleContext
// ---------------------------------------------------------------------------

export function assembleContext(
  colleagueId: string,
  channelId: string,
  currentTopicRootId: string | null
): { role: 'user' | 'assistant'; content: string }[] {
  const db = getDatabase()
  const context: { role: 'user' | 'assistant'; content: string }[] = []

  // 1. Colleague notes for (colleagueId, channelId)
  const notesRow = db
    .prepare('SELECT * FROM colleague_notes WHERE colleague_id = ? AND channel_id = ?')
    .get(colleagueId, channelId) as ColleagueNotesRow | undefined

  if (notesRow && notesRow.notes.trim()) {
    context.push({ role: 'user', content: `[个人笔记]\n${notesRow.notes}` })
    context.push({ role: 'assistant', content: '已了解。' })
  }

  // 2. Channel memory summary for channelId
  const channelMemRow = db
    .prepare('SELECT * FROM channel_memories WHERE channel_id = ?')
    .get(channelId) as ChannelMemoryRow | undefined

  if (channelMemRow && channelMemRow.summary.trim()) {
    context.push({ role: 'user', content: `[频道历史摘要]\n${channelMemRow.summary}` })
    context.push({ role: 'assistant', content: '已了解频道背景。' })
  }

  // 3. Other topic snapshots (NOT currentTopicRootId, limit 5 most recent)
  const otherTopics = (
    currentTopicRootId
      ? db
          .prepare(
            'SELECT * FROM topic_summaries WHERE channel_id = ? AND topic_id != ? ORDER BY updated_at DESC LIMIT 5'
          )
          .all(channelId, currentTopicRootId)
      : db
          .prepare(
            'SELECT * FROM topic_summaries WHERE channel_id = ? ORDER BY updated_at DESC LIMIT 5'
          )
          .all(channelId)
  ) as TopicSummaryRow[]

  if (otherTopics.length > 0) {
    const joined = otherTopics.map((t) => t.summary).join('\n\n')
    context.push({ role: 'user', content: `[其他活跃话题摘要]\n${joined}` })
    context.push({ role: 'assistant', content: '已了解。' })
  }

  // 4. Current topic full messages
  if (currentTopicRootId) {
    const messages = db
      .prepare(
        `SELECT * FROM messages
         WHERE channel_id = ?
           AND (id = ? OR reply_to_id = ? OR parent_id = ?)
         ORDER BY created_at`
      )
      .all(channelId, currentTopicRootId, currentTopicRootId, currentTopicRootId) as MessageRow[]

    for (const msg of messages) {
      context.push({
        role: msg.sender_id !== 'user' ? 'assistant' : 'user',
        content: msg.content,
      })
    }
  }

  return context
}

// ---------------------------------------------------------------------------
// queueMemoryJob
// ---------------------------------------------------------------------------

export function queueMemoryJob(type: string, payload: Record<string, string>): void {
  const db = getDatabase()
  db.prepare(
    'INSERT INTO memory_jobs (id, type, payload, status) VALUES (?, ?, ?, ?)'
  ).run(randomUUID(), type, JSON.stringify(payload), 'pending')
}

// ---------------------------------------------------------------------------
// processMemoryJobs
// ---------------------------------------------------------------------------

export async function processMemoryJobs(): Promise<void> {
  const db = getDatabase()
  const jobs = db
    .prepare("SELECT * FROM memory_jobs WHERE status = 'pending' ORDER BY created_at")
    .all() as MemoryJobRow[]

  for (const job of jobs) {
    let payload: Record<string, string>
    try {
      payload = JSON.parse(job.payload) as Record<string, string>
    } catch {
      // Malformed payload — mark done to avoid infinite retries
      db.prepare("UPDATE memory_jobs SET status = 'done' WHERE id = ?").run(job.id)
      continue
    }

    try {
      if (job.type === 'topic_snapshot') {
        await updateTopicSnapshot(payload.channelId, payload.messageId)
      } else if (job.type === 'colleague_notes') {
        await updateColleagueNotes(payload.colleagueId, payload.channelId, payload.aiResponse)
      } else if (job.type === 'channel_summary') {
        await updateChannelSummary(payload.channelId, payload.topicId)
      }
      db.prepare("UPDATE memory_jobs SET status = 'done' WHERE id = ?").run(job.id)
    } catch {
      // Leave as pending — will retry next time
    }
  }
}

// ---------------------------------------------------------------------------
// updateTopicSnapshot
// ---------------------------------------------------------------------------

export async function updateTopicSnapshot(
  channelId: string,
  anyMessageId: string
): Promise<void> {
  const db = getDatabase()

  // Find the message to resolve the topic root
  const msg = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(anyMessageId) as MessageRow | undefined

  if (!msg) return

  const topicRootId: string = msg.reply_to_id ?? msg.parent_id ?? msg.id

  // Count current messages in this topic
  const countRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM messages
       WHERE channel_id = ?
         AND (id = ? OR reply_to_id = ? OR parent_id = ?)`
    )
    .get(channelId, topicRootId, topicRootId, topicRootId) as { count: number }

  const currentCount = countRow.count

  // Check existing snapshot
  const existing = db
    .prepare('SELECT * FROM topic_summaries WHERE topic_id = ?')
    .get(topicRootId) as TopicSummaryRow | undefined

  const shouldUpdate =
    !existing || currentCount >= existing.message_count + 10

  if (!shouldUpdate) return

  // Build transcript
  const messages = db
    .prepare(
      `SELECT * FROM messages
       WHERE channel_id = ?
         AND (id = ? OR reply_to_id = ? OR parent_id = ?)
       ORDER BY created_at`
    )
    .all(channelId, topicRootId, topicRootId, topicRootId) as MessageRow[]

  const transcript = messages.map((m) => `${m.sender_id}: ${m.content}`).join('\n')

  const summary = await callClaude(
    '你是对话摘要助手，用2-3句中文概括核心内容和结论。',
    transcript
  )

  db.prepare(
    `INSERT OR REPLACE INTO topic_summaries (topic_id, channel_id, summary, message_count, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(topicRootId, channelId, summary, currentCount)
}

// ---------------------------------------------------------------------------
// updateColleagueNotes
// ---------------------------------------------------------------------------

export async function updateColleagueNotes(
  colleagueId: string,
  channelId: string,
  aiResponse: string
): Promise<void> {
  const db = getDatabase()

  const existingRow = db
    .prepare('SELECT * FROM colleague_notes WHERE colleague_id = ? AND channel_id = ?')
    .get(colleagueId, channelId) as ColleagueNotesRow | undefined

  const existingNotes = existingRow?.notes ?? ''

  const prompt =
    `现有笔记: ${existingNotes}\n本次回复: ${aiResponse}\n` +
    `如有值得长期记录的信息（用户偏好/项目背景/重要决定），返回更新后完整笔记（不超过500字）。否则返回空字符串。`

  const response = await callClaude('你是帮助AI同事积累记忆的助手', prompt)

  if (!response || !response.trim()) return

  db.prepare(
    `INSERT OR REPLACE INTO colleague_notes (colleague_id, channel_id, notes, updated_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(colleagueId, channelId, response.trim())
}

// ---------------------------------------------------------------------------
// updateChannelSummary
// ---------------------------------------------------------------------------

export async function updateChannelSummary(
  channelId: string,
  topicId: string
): Promise<void> {
  const db = getDatabase()

  // Get topic summary
  const topicRow = db
    .prepare('SELECT * FROM topic_summaries WHERE topic_id = ?')
    .get(topicId) as TopicSummaryRow | undefined

  if (!topicRow) return

  // Get existing channel memory
  const channelMemRow = db
    .prepare('SELECT * FROM channel_memories WHERE channel_id = ?')
    .get(channelId) as ChannelMemoryRow | undefined

  const existingSummary = channelMemRow?.summary ?? ''

  const combined = existingSummary
    ? `${existingSummary}\n---\n${topicRow.summary}`
    : topicRow.summary

  const newSummary = await callClaude(
    '你是频道历史摘要助手，合并压缩频道历史，保留关键信息，控制在800字以内。',
    combined
  )

  db.prepare(
    `INSERT OR REPLACE INTO channel_memories (channel_id, summary, updated_at)
     VALUES (?, ?, datetime('now'))`
  ).run(channelId, newSummary)
}
