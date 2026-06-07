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

      // Check concurrency limit (regular colleagues + system-manager active tasks)
      const maxConcurrency = (getSetting('maxConcurrency') as number) || 2
      const colleagueBusy = (db.prepare(
        "SELECT COUNT(*) as count FROM ai_colleagues WHERE status = 'busy'"
      ).get() as { count: number }).count
      const managerBusy = (db.prepare(
        "SELECT COUNT(*) as count FROM ai_task_queue WHERE colleague_id = 'system-manager' AND status IN ('assigned', 'processing')"
      ).get() as { count: number }).count
      const busyCount = colleagueBusy + managerBusy
      if (busyCount >= maxConcurrency) return

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
    const preAssignedId = task.colleague_id as string | null

    // Pre-assigned to system-manager (e.g. pinned while manager was busy)
    if (preAssignedId === 'system-manager') {
      const busy = (db.prepare(
        "SELECT COUNT(*) as count FROM ai_task_queue WHERE colleague_id = 'system-manager' AND status IN ('assigned', 'processing') AND id != ?"
      ).get(taskId) as { count: number }).count > 0
      if (busy) return
      this.assignToSystemManager(db, taskId)
      return
    }

    // Pre-assigned to a regular colleague (from @mention)
    let colleague = preAssignedId
      ? db.prepare("SELECT * FROM ai_colleagues WHERE id = ? AND status = 'idle'").get(preAssignedId) as Record<string, unknown> | undefined
      : undefined

    // No pre-assignment — route to system-manager for this channel
    if (!colleague && !preAssignedId) {
      const payload = JSON.parse(task.payload as string)
      const channelId = payload.channelId as string | undefined
      if (channelId) {
        const isMember = db.prepare(
          "SELECT 1 FROM channel_members WHERE channel_id = ? AND colleague_id = 'system-manager'"
        ).get(channelId)
        if (isMember) {
          const busy = (db.prepare(
            "SELECT COUNT(*) as count FROM ai_task_queue WHERE colleague_id = 'system-manager' AND status IN ('assigned', 'processing')"
          ).get() as { count: number }).count > 0
          if (busy) {
            // Pin to system-manager and wait
            db.prepare(`UPDATE ai_task_queue SET colleague_id = 'system-manager' WHERE id = ?`).run(taskId)
          } else {
            this.assignToSystemManager(db, taskId)
          }
          return
        }
      }
      // No channel or system-manager not in channel — fall back to any idle colleague
      colleague = db.prepare("SELECT * FROM ai_colleagues WHERE status = 'idle' LIMIT 1").get() as Record<string, unknown> | undefined
    }

    if (!colleague) return

    // Assign task to regular colleague
    db.prepare(`UPDATE ai_task_queue SET colleague_id = ?, status = 'assigned' WHERE id = ?`).run(colleague.id, taskId)
    db.prepare("UPDATE ai_colleagues SET status = 'busy', current_task = ? WHERE id = ?").run(taskId, colleague.id)

    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('ai:task-assigned', taskId, colleague.id)
      win.webContents.send('ai:status-changed', colleague.id, 'busy')
    }

    startProgrammingSession(taskId).catch((err) => {
      console.error('Programming session failed:', err)
      try {
        const db2 = getDatabase()
        const taskCheck = db2.prepare('SELECT status FROM ai_task_queue WHERE id = ?').get(taskId) as { status: string } | undefined
        if (taskCheck && taskCheck.status !== 'failed' && taskCheck.status !== 'completed') {
          db2.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?")
            .run(err instanceof Error ? err.message : String(err), taskId)
        }
      } catch (cleanupErr) {
        console.error('Cleanup failed:', cleanupErr)
      }
      this.completeTask(taskId)
    })
  }

  private assignToSystemManager(db: ReturnType<typeof getDatabase>, taskId: string): void {
    db.prepare(`UPDATE ai_task_queue SET colleague_id = 'system-manager', status = 'assigned' WHERE id = ?`).run(taskId)
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('ai:task-assigned', taskId, 'system-manager')
      win.webContents.send('ai:status-changed', 'system-manager', 'busy')
    }
    startProgrammingSession(taskId).catch((err) => {
      console.error('Programming session failed (system-manager):', err)
      try {
        const db2 = getDatabase()
        const taskCheck = db2.prepare('SELECT status FROM ai_task_queue WHERE id = ?').get(taskId) as { status: string } | undefined
        if (taskCheck && taskCheck.status !== 'failed' && taskCheck.status !== 'completed') {
          db2.prepare("UPDATE ai_task_queue SET status='failed', result=?, completed_at=datetime('now') WHERE id=?")
            .run(err instanceof Error ? err.message : String(err), taskId)
        }
      } catch (cleanupErr) {
        console.error('Cleanup failed (system-manager):', cleanupErr)
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

    const win = BrowserWindow.getAllWindows()[0]

    // system-manager has no row in ai_colleagues — just send status notification
    if (task.colleague_id === 'system-manager') {
      if (win) win.webContents.send('ai:status-changed', 'system-manager', 'idle')
      return
    }

    db.prepare(`UPDATE ai_colleagues SET status = 'idle', current_task = NULL WHERE id = ?`).run(task.colleague_id)
    if (win) win.webContents.send('ai:status-changed', task.colleague_id as string, 'idle')
  }
}

export const aiScheduler = new AiScheduler()
export { AiScheduler }