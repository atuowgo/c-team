import { getDatabase } from './database'
import { BrowserWindow } from 'electron'
import { startProgrammingSession } from './programming-session'

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
      // Find pending tasks with highest priority first
      const tasks = db.prepare(
        `SELECT * FROM ai_task_queue WHERE status = 'pending' ORDER BY priority ASC, created_at ASC LIMIT 5`
      ).all() as Array<Record<string, unknown>>

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
    // For now: find first idle colleague
    const colleague = db.prepare(
      `SELECT * FROM ai_colleagues WHERE status = 'idle' LIMIT 1`
    ).get() as Record<string, unknown> | undefined

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
  completeTask(taskId: string): void {
    const db = getDatabase()
    const task = db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
    if (!task || !task.colleague_id) return

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