import { getDatabase } from './database'
import { callClaude } from './claude-api'
import { createBranch, commitFile, createPullRequest } from './github-api'
import { aiScheduler } from './ai-scheduler'
import { BrowserWindow } from 'electron'

interface SessionContext {
  taskId: string
  colleagueId: string
  ticketId: string
}

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
    // Not a programming task — skip
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

    // 4. Create a git branch for this ticket
    const branchName = `ai/${(ticket.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${ticketId.slice(0, 8)}`

    try {
      await createBranch(branchName)
    } catch (e) {
      // Branch might already exist — continue
    }

    notifyRenderer('ai:task-progress', taskId, 20)

    // 5. Build the Claude prompt
    const systemPrompt = (colleague.system_prompt as string) || 'You are a helpful software engineer.'
    const userMessage = buildPrompt(ticket, colleague)

    // 6. Call Claude
    const response = await callClaude(systemPrompt, userMessage)

    notifyRenderer('ai:task-progress', taskId, 60)

    // 7. Commit the generated code to GitHub
    // The response should contain a file path and content, or we generate a reasonable commit
    const filePath = payload.filePath as string || `src/ai-generated/${ticketId.slice(0, 8)}.ts`
    await commitFile(branchName, filePath, response, `AI: ${ticket.title}\n\nCloses #${ticketId.slice(0, 8)}`)

    notifyRenderer('ai:task-progress', taskId, 80)

    // 8. Create PR
    const pr = await createPullRequest(
      `AI: ${ticket.title}`,
      branchName,
      'main',
      `Automated PR by ${colleague.name}\n\nTicket: ${ticket.title}\n\n${response.slice(0, 500)}`
    )

    // 9. Update ticket with PR URL
    db.prepare('UPDATE tickets SET pr_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(pr.url, ticketId)

    // 10. Complete the task
    db.prepare("UPDATE ai_task_queue SET status='completed', result=?, completed_at=datetime('now') WHERE id=?").run(
      JSON.stringify({ pr_url: pr.url, pr_number: pr.number }), taskId
    )

    notifyRenderer('ai:task-progress', taskId, 100)
    notifyRenderer('ai:task-completed', taskId, JSON.stringify({ pr_url: pr.url }))

    aiScheduler.completeTask(taskId)

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?").run(errorMsg, taskId)
    notifyRenderer('ai:task-progress', taskId, -1) // -1 means error
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