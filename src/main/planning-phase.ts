import { getDatabase } from './database'
import { callClaude } from './claude-api'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'

// Generate an execution plan via Claude and submit as a ticket comment.
// Returns true if plan was submitted (waiting for approval), false if skipped.
export async function startPlanningPhase(
  taskId: string,
  ticket: Record<string, unknown>,
  colleague: Record<string, unknown>,
  skipPlan: boolean,
  previousFeedback?: string
): Promise<boolean> {
  if (skipPlan) return false

  const db = getDatabase()

  // Build plan prompt
  const systemPrompt = (colleague.system_prompt as string) || 'You are a helpful software engineer.'
  const planPrompt = buildPlanPrompt(ticket, colleague, previousFeedback)

  const planContent = await callClaude(systemPrompt, planPrompt, {
    maxTokens: 2048,
    modelOverride: (colleague.model as string | null) || undefined,
  })

  // Save plan as ticket comment
  const commentId = randomUUID()
  db.prepare(
    `INSERT INTO ticket_comments (id, ticket_id, author_id, content) VALUES (?, ?, ?, ?)`
  ).run(commentId, ticket.id, colleague.id, planContent)

  // Update task status to waiting_approval
  db.prepare(
    `UPDATE ai_task_queue SET status = 'waiting_approval', result = ? WHERE id = ?`
  ).run(planContent, taskId)

  // Notify renderer
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.webContents.send('ai:plan-submitted', taskId, ticket.id as string, planContent)
  }

  return true
}

// Approve the plan and trigger the coding phase
export function approvePlan(taskId: string): void {
  const db = getDatabase()

  const task = db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
  if (!task || task.status !== 'waiting_approval') {
    throw new Error(`Task ${taskId} is not in waiting_approval status`)
  }

  // Re-queue for coding phase — set a flag in payload so programming-session knows to skip plan
  const payload = JSON.parse(task.payload as string)
  payload.skipPlan = true
  payload.planApproved = true

  db.prepare(
    `UPDATE ai_task_queue SET status = 'pending', payload = ? WHERE id = ?`
  ).run(JSON.stringify(payload), taskId)

  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.webContents.send('ai:plan-approved', taskId)
  }
}

// Reject the plan with feedback, trigger re-generation
export function rejectPlan(taskId: string, feedback: string): void {
  const db = getDatabase()

  const task = db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
  if (!task || task.status !== 'waiting_approval') {
    throw new Error(`Task ${taskId} is not in waiting_approval status`)
  }

  // Save feedback as ticket comment
  const ticketId = (JSON.parse(task.payload as string) as Record<string, unknown>).ticketId as string
  const commentId = randomUUID()
  db.prepare(
    `INSERT INTO ticket_comments (id, ticket_id, author_id, content) VALUES (?, ?, ?, ?)`
  ).run(commentId, ticketId, 'human', `❌ 方案被拒绝，反馈：${feedback}`)

  // Re-queue for re-planning
  const payload = JSON.parse(task.payload as string)
  payload.planFeedback = feedback

  db.prepare(
    `UPDATE ai_task_queue SET status = 'pending', payload = ? WHERE id = ?`
  ).run(JSON.stringify(payload), taskId)

  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.webContents.send('ai:plan-rejected', taskId)
  }
}

function buildPlanPrompt(
  ticket: Record<string, unknown>,
  colleague: Record<string, unknown>,
  feedback?: string
): string {
  let prompt = `## 工单执行方案

**工单标题**: ${ticket.title}
**工单描述**: ${ticket.description || '无描述'}
**优先级**: ${ticket.priority || 'medium'}
**执行人**: ${colleague.name} (${colleague.role})

请为此工单制定详细的执行方案，包括：
1. **改动范围**：需要修改哪些文件/模块
2. **技术方案**：具体实现思路和关键技术点
3. **预估工作量**：规模评估（小/中/大）
4. **风险点**：潜在问题和注意事项

请以清晰、结构化的方式呈现方案。`

  if (feedback) {
    prompt += `\n\n⚠️ 上一版方案被拒绝，反馈意见：${feedback}\n请根据反馈重新制定方案。`
  }

  return prompt
}