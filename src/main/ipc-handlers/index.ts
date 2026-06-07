import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase } from '../database'
import { getSetting, setSetting } from '../settings-store'
import { approvePlan, rejectPlan } from '../planning-phase'
import { startCodingPhase } from '../programming-session'
import type { ModelEntry } from '../../common/ipc'

export function registerIpcHandlers(): void {
  const db = getDatabase()

  // --- Channels ---

  ipcMain.handle('channel:list', () => {
    return db.prepare('SELECT * FROM channels ORDER BY created_at').all()
  })

  ipcMain.handle('channel:create', (_e, name: string) => {
    const id = randomUUID()
    db.prepare('INSERT INTO channels (id, name) VALUES (?, ?)').run(id, name)
    db.prepare('INSERT OR IGNORE INTO channel_memories (channel_id) VALUES (?)').run(id)
    return db.prepare('SELECT * FROM channels WHERE id = ?').get(id)
  })

  ipcMain.handle('channel:delete', (_e, id: string) => {
    db.prepare('DELETE FROM channels WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('channel:manager-get', (_e, channelId: string) => {
    const row = db.prepare('SELECT colleague_id FROM channel_managers WHERE channel_id = ?').get(channelId) as { colleague_id: string } | undefined
    if (!row) return null
    return db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(row.colleague_id) ?? null
  })

  ipcMain.handle('channel:manager-set', (_e, channelId: string, colleagueId: string) => {
    db.prepare('INSERT OR REPLACE INTO channel_managers (channel_id, colleague_id) VALUES (?, ?)').run(channelId, colleagueId)
    return { success: true }
  })

  // --- Messages ---

  ipcMain.handle('message:list', (_e, channelId: string) => {
    return db.prepare(
      'SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at'
    ).all(channelId)
  })

  ipcMain.handle('message:send', (_e, channelId: string, content: string, senderId: string, replyToId?: string) => {
    const id = randomUUID()
    db.prepare(
      'INSERT INTO messages (id, channel_id, sender_id, content, reply_to_id) VALUES (?, ?, ?, ?, ?)'
    ).run(id, channelId, senderId, content, replyToId ?? null)
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id)
  })

  ipcMain.handle('message:delete', (_e, id: string) => {
    db.prepare('DELETE FROM messages WHERE id = ?').run(id)
    return { success: true }
  })

  // --- Boards ---

  ipcMain.handle('board:list', () => {
    return db.prepare('SELECT * FROM boards ORDER BY created_at').all()
  })

  ipcMain.handle('board:create', (_e, name: string) => {
    const id = randomUUID()
    db.prepare('INSERT INTO boards (id, name) VALUES (?, ?)').run(id, name)
    return db.prepare('SELECT * FROM boards WHERE id = ?').get(id)
  })

  ipcMain.handle('board:delete', (_e, id: string) => {
    db.prepare('DELETE FROM boards WHERE id = ?').run(id)
    return { success: true }
  })

  // --- Board create-with-columns ---

  ipcMain.handle('board:create-with-columns', (_e, name: string, columnNames: string[]) => {
    const boardId = randomUUID()
    const createBoard = db.prepare('INSERT INTO boards (id, name) VALUES (?, ?)')
    const createCol = db.prepare('INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)')

    const transaction = db.transaction(() => {
      createBoard.run(boardId, name)
      const columns = columnNames.map((colName, idx) => {
        const colId = randomUUID()
        createCol.run(colId, boardId, colName, idx)
        return db.prepare('SELECT * FROM columns WHERE id = ?').get(colId)
      })
      return columns
    })

    const columns = transaction()
    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
    return { board, columns }
  })

  // --- Columns ---

  ipcMain.handle('column:list', (_e, boardId: string) => {
    return db.prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position').all(boardId)
  })

  ipcMain.handle('column:create', (_e, boardId: string, name: string, position?: number) => {
    const id = randomUUID()
    db.prepare('INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)').run(id, boardId, name, position ?? 0)
    return db.prepare('SELECT * FROM columns WHERE id = ?').get(id)
  })

  ipcMain.handle('column:update', (_e, id: string, data: Record<string, unknown>) => {
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        sets.push(`${key} = ?`)
        values.push(val)
      }
    }
    if (sets.length === 0) {
      return db.prepare('SELECT * FROM columns WHERE id = ?').get(id)
    }
    values.push(id)
    db.prepare(`UPDATE columns SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM columns WHERE id = ?').get(id)
  })

  ipcMain.handle('column:delete', (_e, id: string) => {
    db.prepare('DELETE FROM columns WHERE id = ?').run(id)
    return { success: true }
  })

  // --- Tickets ---

  ipcMain.handle('ticket:list', (_e, boardId: string) => {
    return db.prepare(
      'SELECT * FROM tickets WHERE board_id = ? ORDER BY created_at'
    ).all(boardId)
  })

  ipcMain.handle('ticket:create', (_e, data: { boardId?: string; columnId?: string; title: string; description?: string }) => {
    const id = randomUUID()
    db.prepare(
      'INSERT INTO tickets (id, board_id, column_id, title, description) VALUES (?, ?, ?, ?, ?)'
    ).run(id, data.boardId || null, data.columnId || null, data.title, data.description || '')
    return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
  })

  ipcMain.handle('ticket:update', (_e, id: string, data: Record<string, unknown>) => {
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        const col = key === 'boardId' ? 'board_id'
          : key === 'columnId' ? 'column_id'
          : key
        sets.push(`${col} = ?`)
        values.push(val)
      }
    }
    if (sets.length === 0) {
      return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
    }
    sets.push("updated_at = datetime('now')")
    values.push(id)
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
  })

  ipcMain.handle('ticket:delete', (_e, id: string) => {
    db.prepare('DELETE FROM tickets WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('ticket:assign', (_e, id: string, colleagueId: string) => {
    const colleague = db.prepare('SELECT name FROM ai_colleagues WHERE id = ?').get(colleagueId) as { name: string } | undefined
    if (!colleague) {
      throw new Error(`AI colleague not found: ${colleagueId}`)
    }
    db.prepare("UPDATE tickets SET assignee = ?, updated_at = datetime('now') WHERE id = ?").run(colleague.name, id)
    return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
  })

  // --- Ticket Comments ---

  ipcMain.handle('ticket:comment-list', (_e, ticketId: string) => {
    return db.prepare(
      'SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at'
    ).all(ticketId)
  })

  ipcMain.handle('ticket:comment-create', (_e, data: { ticket_id: string; author_id: string; content: string }) => {
    const id = randomUUID()
    db.prepare(
      'INSERT INTO ticket_comments (id, ticket_id, author_id, content) VALUES (?, ?, ?, ?)'
    ).run(id, data.ticket_id, data.author_id, data.content)
    return db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(id)
  })

  // --- Plan Approval ---

  ipcMain.handle('plan:approve', async (_e, taskId: string) => {
    const db = getDatabase()
    const task = db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
    if (!task) throw new Error(`Task ${taskId} not found`)

    const payload = JSON.parse(task.payload as string)
    const ticketId = payload.ticketId as string
    const colleagueId = task.colleague_id as string

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as Record<string, unknown> | undefined
    const colleague = db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(colleagueId) as Record<string, unknown> | undefined

    if (!ticket || !colleague) throw new Error('Ticket or colleague not found')

    approvePlan(taskId)

    // Fire and forget: start coding phase
    startCodingPhase(taskId, ticket, colleague, payload).catch((err) => {
      console.error('Coding phase failed:', err)
    })

    return { success: true }
  })

  ipcMain.handle('plan:reject', (_e, taskId: string, feedback: string) => {
    rejectPlan(taskId, feedback)
    return { success: true }
  })

  // --- AI Colleagues ---

  ipcMain.handle('ai:list', () => {
    return db.prepare('SELECT * FROM ai_colleagues ORDER BY created_at').all()
  })

  ipcMain.handle('ai:status', (_e, id: string) => {
    return db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(id) ?? null
  })

  ipcMain.handle('ai:create', (_e, data: { name: string; role: string; system_prompt: string; capabilities?: string[]; model?: string | null; nickname?: string | null }) => {
    const id = randomUUID()
    const capabilities = data.capabilities ? JSON.stringify(data.capabilities) : '[]'
    db.prepare('INSERT INTO ai_colleagues (id, name, role, system_prompt, capabilities, status, model, nickname) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, data.name, data.role, data.system_prompt, capabilities, 'idle', data.model ?? null, data.nickname ?? null)
    return db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(id)
  })

  ipcMain.handle('ai:update', (_e, id: string, data: Record<string, unknown>) => {
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        if (key === 'capabilities' && Array.isArray(val)) {
          sets.push('capabilities = ?')
          values.push(JSON.stringify(val))
        } else {
          sets.push(`${key} = ?`)
          values.push(val)
        }
      }
    }
    if (sets.length === 0) {
      return db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(id)
    }
    values.push(id)
    db.prepare(`UPDATE ai_colleagues SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM ai_colleagues WHERE id = ?').get(id)
  })

  ipcMain.handle('ai:delete', (_e, id: string) => {
    db.prepare('DELETE FROM ai_colleagues WHERE id = ?').run(id)
    return { success: true }
  })

  // --- AI Task Queue ---

  ipcMain.handle('ai:task-list', (_e, filters?: { colleagueId?: string; status?: string }) => {
    const conditions: string[] = []
    const values: unknown[] = []
    if (filters?.colleagueId) {
      conditions.push('colleague_id = ?')
      values.push(filters.colleagueId)
    }
    if (filters?.status) {
      conditions.push('status = ?')
      values.push(filters.status)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return db.prepare(`SELECT * FROM ai_task_queue ${where} ORDER BY created_at`).all(...values)
  })

  ipcMain.handle('ai:task-create', (_e, data: { colleague_id?: string; event_type: string; payload: object; priority?: number }) => {
    const id = randomUUID()
    const payload = JSON.stringify(data.payload)
    db.prepare('INSERT INTO ai_task_queue (id, colleague_id, event_type, payload, priority) VALUES (?, ?, ?, ?, ?)').run(id, data.colleague_id || null, data.event_type, payload, data.priority ?? 0)
    return db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(id)
  })

  ipcMain.handle('ai:task-update', (_e, id: string, data: Record<string, unknown>) => {
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        if (key === 'payload' && typeof val === 'object') {
          sets.push('payload = ?')
          values.push(JSON.stringify(val))
        } else {
          sets.push(`${key} = ?`)
          values.push(val)
        }
      }
    }
    if (data.status === 'completed') {
      sets.push("completed_at = datetime('now')")
    }
    if (sets.length === 0) {
      return db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(id)
    }
    values.push(id)
    db.prepare(`UPDATE ai_task_queue SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    if (data.status === 'completed' && data.result !== undefined) {
      BrowserWindow.getAllWindows()[0]?.webContents.send('ai:task-completed', id, data.result)
    }

    return db.prepare('SELECT * FROM ai_task_queue WHERE id = ?').get(id)
  })

  ipcMain.handle('ai:task-delete', (_e, id: string) => {
    db.prepare('DELETE FROM ai_task_queue WHERE id = ?').run(id)
    return { success: true }
  })

  // --- Settings ---

  ipcMain.handle('settings:get', (_e, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    setSetting(key, value)
  })

  // --- Models ---

  ipcMain.handle('models:list', () => {
    return (getSetting('customModels') as ModelEntry[] | null) || []
  })

  ipcMain.handle('models:add', (_e, id: string, label: string) => {
    const custom = (getSetting('customModels') as ModelEntry[] | null) || []
    if (!custom.find((m) => m.id === id)) {
      const updated = [...custom, { id, label: label || id }]
      setSetting('customModels', updated)
      return updated
    }
    return custom
  })

  ipcMain.handle('models:remove', (_e, id: string) => {
    const custom = (getSetting('customModels') as ModelEntry[] | null) || []
    const updated = custom.filter((m) => m.id !== id)
    setSetting('customModels', updated)
    return updated
  })
}