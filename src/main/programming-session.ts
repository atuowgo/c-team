import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { callClaude } from './claude-api'
import { createBranch, commitFile, createPullRequest } from './github-api'
import { aiScheduler } from './ai-scheduler'
import { startPlanningPhase } from './planning-phase'
import { processMemoryJobs, assembleContext } from './memory-manager'
import { loadAllSkillsWithBodies } from './skills-loader'
import { BrowserWindow } from 'electron'

/**
 * 构建带技能指令和思考过程要求的 system prompt。
 * 所有 chat reply 场景（普通同事和 system-manager）均使用此函数增强 prompt。
 */
function buildEnhancedSystemPrompt(basePrompt: string): string {
  let prompt = basePrompt || 'You are a helpful assistant.'

  const skills = loadAllSkillsWithBodies()
  if (skills.length > 0) {
    const skillsSection = [
      '',
      '## 可用技能 (Available Skills)',
      '根据用户问题，自动判断并使用合适的技能。使用技能时，在回答最开头用 `[SKILL: skill-name]` 标注（如 `[SKILL: mermaid]`）。若不需要技能则直接回答，无需标注。',
      '',
      ...skills.map(
        (s) => `### 技能: ${s.name}\n**描述**: ${s.description}\n\n${s.body}`
      ),
    ].join('\n')
    prompt += skillsSection
  }

  prompt += [
    '',
    '## 思考过程',
    '回答前，请先在 `<think>` 和 `</think>` 标签之间简要写出你的分析思路（3-6句），然后再给出正式回答。',
    '格式示例：',
    '<think>',
    '用户询问的是...，我需要考虑...，最佳方案是...',
    '</think>',
    '',
    '正式回答内容...',
  ].join('\n')

  return prompt
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
    // system-manager is handled separately — reads config from ai_roles
    if (colleagueId === 'system-manager') {
      const role = db.prepare("SELECT * FROM ai_roles WHERE id = 'system-manager'").get() as Record<string, unknown> | undefined
      if (!role) {
        db.prepare("UPDATE ai_task_queue SET status='failed', result=? WHERE id=?").run('system-manager role not found', taskId)
        aiScheduler.completeTask(taskId)
        return
      }
      const channelId = payload.channelId as string | undefined
      let teamInfo = ''
      if (channelId) {
        const members = db.prepare(
          `SELECT c.name, c.nickname, r.name as role_name, r.description as role_description, c.personal_notes
           FROM channel_members cm
           JOIN ai_colleagues c ON cm.colleague_id = c.id
           LEFT JOIN ai_roles r ON c.role_id = r.id
           WHERE cm.channel_id = ? AND cm.colleague_id != 'system-manager'`
        ).all(channelId) as Array<{ name: string; nickname: string | null; role_name: string; role_description: string | null; personal_notes: string | null }>
        if (members.length > 0) {
          const memberLines = members.map((m) => {
            const displayName = m.nickname || m.name
            const desc = m.role_description ? m.role_description : ''
            const notes = m.personal_notes ? `；${m.personal_notes}` : ''
            return `  - 成员名：${displayName}（必须写作 @${displayName}）\n    岗位：${m.role_name}${desc ? `\n    职责：${desc}` : ''}${notes ? `\n    备注：${notes}` : ''}`
          }).join('\n')
          const allowedNames = members.map((m) => `@${m.nickname || m.name}`).join('、')
          teamInfo = `\n\n【团队成员 - 严格约束】\n你频道内的可用成员如下，分配任务时只能 @ 下列名称，禁止使用任何不在列表中的名字（如 @Developer、@Backend、@用户 等均为违规）：\n\n${memberLines}\n\n允许使用的 @ 名称（完整列表）：${allowedNames}\n违规示例（禁止）：@Developer、@Tester、@JavaDev、@Backend、@Frontend、@用户\n合规示例（必须）：${allowedNames}`
        }
      }
      const managerColleague = {
        id: 'system-manager',
        name: '频道管理员',
        nickname: null,
        system_prompt: (role.system_prompt as string) + teamInfo,
        model: null,
        type: 'manager',
      }
      await startChatReply(taskId, managerColleague, payload)
      return
    }

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
    const systemPrompt = buildEnhancedSystemPrompt((colleague.system_prompt as string) || '')
    const context = assembleContext(colleagueId, channelId, null)
    const messages = [...context, { role: 'user' as const, content: message }]
    let response: string
    try {
      response = await callClaude(systemPrompt, messages, {
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

    // When system-manager responds, create tasks for any @mentioned channel members
    if (colleagueId === 'system-manager') {
      const channelMembers = db.prepare(
        `SELECT c.id, c.name, c.nickname
         FROM channel_members cm
         JOIN ai_colleagues c ON cm.colleague_id = c.id
         WHERE cm.channel_id = ? AND cm.colleague_id != 'system-manager'`
      ).all(channelId) as Array<{ id: string; name: string; nickname: string | null }>

      for (const member of channelMembers) {
        const names = [member.name, member.nickname].filter((n): n is string => Boolean(n))
        if (names.some((n) => response.includes(`@${n}`))) {
          db.prepare(
            'INSERT INTO ai_task_queue (id, colleague_id, event_type, payload, priority, status) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            randomUUID(),
            member.id,
            'chat_mention',
            JSON.stringify({ channelId, message: response, mentionedColleague: member.nickname || member.name }),
            2,
            'pending'
          )
        }
      }
    }

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