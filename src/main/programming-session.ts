import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { callClaude } from './claude-api'
import { createBranch, commitFile, createPullRequest } from './github-api'
import { aiScheduler } from './ai-scheduler'
import { startPlanningPhase } from './planning-phase'
import { processMemoryJobs } from './memory-manager'
import { BrowserWindow } from 'electron'

// Main entry point: called when a task is assigned to a colleague
export async function startProgrammingSession(taskId: string): Promise<void> {
  const db = getDatabase()

  // 1. Get task details
  const task = db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
  if (!task) throw new Error(`Task ${taskId} not found`)

  const payload = JSON.parse(task.payload as string)
  const colleagueId = task.colleague_id as string
  const ticketId = payload.ticketId as string | undefined

  if (!ticketId) {
    // Chat mention — generate a reply and post it as a message
    const colleague = db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(colleagueId) as Record<string, unknown> | undefined
    if (!colleague) {
      db.prepare("UPDATE ai_task_queue SET status='failed', result=? WHERE id=?").run('Colleague not found', taskId)
      aiScheduler.completeTask(taskId)
      return
    }
    await startChatReply(taskId, colleague, payload)
    return
  }

  // 2. Get ticket and colleague details
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as Record<string, unknown> | undefined
  const colleague = db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(colleagueId) as Record<string, unknown> | undefined

  if (!ticket || !colleague) {
    db.prepare("UPDATE ai_task_queue SET status='failed', result=? WHERE id=?").run('Ticket or colleague not found', taskId)
    aiScheduler.completeTask(taskId)
    return
  }

  try {
    // 3. Update task status to processing
    db.prepare("UPDATE ai_task_queue SET status='processing' WHERE id=?").run(taskId)
    notifyRenderer('ai:task-progress', taskId, 10)

    // 4. Plan phase: skip if already approved or explicitly skipped
    const skipPlan = payload.skipPlan === true || payload.planApproved === true
    const feedback = payload.planFeedback as string | undefined

    const planSubmitted = await startPlanningPhase(taskId, ticket, colleague, skipPlan, feedback)

    if (planSubmitted) {
      // Plan submitted, waiting for human approval
      // Don't call completeTask — AI stays busy waiting for approval
      return
    }

    // 5. Coding phase
    await startCodingPhase(taskId, ticket, colleague, payload)

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?").run(errorMsg, taskId)
    notifyRenderer('ai:task-progress', taskId, -1)
    aiScheduler.completeTask(taskId)
  }
}

// Chat reply: AI generates a response and posts it as a channel message
async function startChatReply(
  taskId: string,
  colleague: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getDatabase()
  const channelId = payload.channelId as string
  const message = payload.message as string
  const colleagueId = colleague.id as string
  const displayName = (colleague.nickname as string | null) || (colleague.name as string)

  notifyRenderer('ai:typing-start', colleagueId, displayName)

  try {
    const systemPrompt = (colleague.system_prompt as string) || 'You are a helpful assistant.'
    let response: string
    try {
      response = await callClaude(systemPrompt, message, {
        modelOverride: (colleague.model as string | null) || undefined,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      db.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?")
        .run(errorMsg, taskId)
      notifyRenderer("system:notification", "AI错误: " + errorMsg)
      aiScheduler.completeTask(taskId)
      return
    } finally {
      notifyRenderer('ai:typing-stop', colleagueId)
    }

    const messageId = randomUUID()
    db.prepare(
      'INSERT INTO messages (id, channel_id, sender_id, content) VALUES (?, ?, ?, ?)'
    ).run(messageId, channelId, displayName, response)

    const newMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId)
    notifyRenderer('message:new', newMsg)

    db.prepare('INSERT INTO memory_jobs (id, type, payload) VALUES (?, ?, ?)').run(
      randomUUID(), 'colleague_notes',
      JSON.stringify({ channelId, colleagueId, aiResponse: response })
    )
    db.prepare('INSERT INTO memory_jobs (id, type, payload) VALUES (?, ?, ?)').run(
      randomUUID(), 'topic_snapshot',
      JSON.stringify({ channelId, messageId })
    )

    processMemoryJobs().catch(console.error)

    db.prepare("UPDATE ai_task_queue SET status='completed', result=?, completed_at=datetime('now') WHERE id=?")
      .run(JSON.stringify({ reply: response }), taskId)

    notifyRenderer('ai:task-completed', taskId, JSON.stringify({ reply: response }))
    aiScheduler.completeTask(taskId)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?")
      .run(errorMsg, taskId)
    notifyRenderer("system:notification", "AI错误: " + errorMsg)
    aiScheduler.completeTask(taskId)
  }
}

// Coding phase: branch → Claude → commit → PR
export async function startCodingPhase(
  taskId: string,
  ticket: Record<string, unknown>,
  colleague: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getDatabase()
  const ticketId = ticket.id as string

  try {
    // Create a git branch for this ticket
    const branchName = `ai/${(ticket.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${ticketId.slice(0, 8)}`

    try {
      await createBranch(branchName)
    } catch (e) {
      // Branch might already exist — continue
    }

    notifyRenderer('ai:task-progress', taskId, 20)

    // Build the Claude prompt
    const systemPrompt = (colleague.system_prompt as string) || 'You are a helpful software engineer.'
    const userMessage = buildPrompt(ticket, colleague)

    // Call Claude
    const response = await callClaude(systemPrompt, userMessage, {
      modelOverride: (colleague.model as string | null) || undefined,
    })

    notifyRenderer('ai:task-progress', taskId, 60)

    // Commit the generated code to GitHub
    const filePath = payload.filePath as string || `src/ai-generated/${ticketId.slice(0, 8)}.ts`
    await commitFile(branchName, filePath, response, `AI: ${ticket.title}\n\nCloses #${ticketId.slice(0, 8)}`)

    notifyRenderer('ai:task-progress', taskId, 80)

    // Create PR
    const pr = await createPullRequest(
      `AI: ${ticket.title}`,
      branchName,
      'main',
      `Automated PR by ${colleague.name}\n\nTicket: ${ticket.title}\n\n${response.slice(0, 500)}`
    )

    // Update ticket with PR URL
    db.prepare('UPDATE tickets SET pr_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(pr.url, ticketId)

    // Complete the task
    db.prepare("UPDATE ai_task_queue SET status='completed', result=?, completed_at=datetime('now') WHERE id=?").run(
      JSON.stringify({ pr_url: pr.url, pr_number: pr.number }), taskId
    )

    notifyRenderer('ai:task-progress', taskId, 100)
    notifyRenderer('ai:task-completed', taskId, JSON.stringify({ pr_url: pr.url }))

    aiScheduler.completeTask(taskId)

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?").run(errorMsg, taskId)
    notifyRenderer('ai:task-progress', taskId, -1)
    aiScheduler.completeTask(taskId)
  }
}

function buildPrompt(ticket: Record<string, unknown>, colleague: Record<string, unknown>): string {
  return `## Task: ${ticket.title}

**Description**: ${ticket.description || 'No description provided'}
**Priority**: ${ticket.priority || 'medium'}
**Assigned to**: ${colleague.name} (${colleague.role})

Please implement the changes described above. Provide the complete code with explanations.`
}

function notifyRenderer(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send(channel, ...args)
}