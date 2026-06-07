import { getDatabase } from './database'
import { BrowserWindow } from 'electron'
import { startProgrammingSession } from './programming-session'
import { getSetting } from './settings-store'

class AiScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false

  // Start polling ai_task_queue every 3 seconds
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 3000)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private async tick(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const db = getDatabase()

      // Check concurrency limit
      const maxConcurrency = (getSetting('maxConcurrency') as number) || 2
      const busyCount = (db.prepare(
        "SELECT COUNT(*) as count FROM ai_colleagues WHERE status = 'busy'"
      ).get() as { count: number }).count
      if (busyCount >= maxConcurrency) return

      // Find pending tasks with highest priority first
      // Exclude waiting_approval — those are waiting for human review
      // Limit to (maxConcurrency - busyCount) to not exceed concurrency cap
      const tasks = db.prepare(
        `SELECT * FROM ai_task_queue WHERE status = 'pending' ORDER BY priority ASC, created_at ASC LIMIT ?`
      ).all(maxConcurrency - busyCount) as Array<Record<string, unknown>>

      for (const task of tasks) {
        await this.dispatchTask(task)
      }
    } finally {
      this.polling = false
    }
  }

  private async dispatchTask(task: Record<string, unknown>): Promise<void> {
    const db = getDatabase()
    const taskId = task.id as string

    // Find an idle AI colleague capable of handling this event_type
    // Try pre-assigned colleague first (from @mention), then fall back to any idle colleague
    const preAssignedId = task.colleague_id as string | null
    let colleague = preAssignedId
      ? db.prepare("SELECT * FROM ai_colleagues WHERE id = ? AND status = 'idle'").get(preAssignedId) as Record<string, unknown> | undefined
      : undefined
    if (!colleague) {
      colleague = db.prepare("SELECT * FROM ai_colleagues WHERE status = 'idle' LIMIT 1").get() as Record<string, unknown> | undefined
    }

    if (!colleague) {
      // No idle colleagues — leave task pending
      return
    }

    // Assign task to colleague
    db.prepare(
      `UPDATE ai_task_queue SET colleague_id = ?, status = 'assigned' WHERE id = ?`
    ).run(colleague.id, taskId)

    // Update colleague status to busy
    db.prepare(
      `UPDATE ai_colleagues SET status = 'busy', current_task = ? WHERE id = ?`
    ).run(taskId, colleague.id)

    // Notify renderer
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('ai:task-assigned', taskId, colleague.id)
      win.webContents.send('ai:status-changed', colleague.id, 'busy')
    }

    // Fire and forget: let the programming session run asynchronously
    startProgrammingSession(taskId).catch((err) => {
      console.error('Programming session failed:', err)
      // Safety net: ensure task and colleague are cleaned up even on unexpected failures
      try {
        const db = getDatabase()
        const taskCheck = db.prepare('SELECT status FROM ai_task_queue WHERE id = ?')
          .get(taskId) as { status: string } | undefined
        if (taskCheck && taskCheck.status !== 'failed' && taskCheck.status !== 'completed') {
          db.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?")
            .run(err instanceof Error ? err.message : String(err), taskId)
        }
      } catch (cleanupErr) {
        console.error('Cleanup failed:', cleanupErr)
      }
      this.completeTask(taskId)
    })
  }

  // Called when a task completes to free up the colleague
  // Does NOT free the colleague if task is waiting_approval (AI stays busy)
  completeTask(taskId: string): void {
    const db = getDatabase()
    const task = db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
    if (!task || !task.colleague_id) return

    // Don't release colleague if waiting for plan approval
    if (task.status === 'waiting_approval') return

    db.prepare(
      `UPDATE ai_colleagues SET status = 'idle', current_task = NULL WHERE id = ?`
    ).run(task.colleague_id)

    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('ai:status-changed', task.colleague_id as string, 'idle')
    }
  }
}

export const aiScheduler = new AiScheduler()
export { AiScheduler }