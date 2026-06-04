import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'workspace.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    seedAiColleagues(db)
  }
  return db
}

function seedAiColleagues(database: Database.Database): void {
  const row = database.prepare('SELECT COUNT(*) as count FROM ai_colleagues').get() as { count: number }
  if (row.count > 0) return

  const insertStmt = database.prepare(`
    INSERT INTO ai_colleagues (id, name, role, system_prompt, capabilities, status)
    VALUES (?, ?, ?, ?, ?, 'idle')
  `)

  const colleagues = [
    {
      id: randomUUID(),
      name: '工程师',
      role: '全栈工程师',
      systemPrompt: '你是一名经验丰富的全栈工程师，擅长 TypeScript、React、Node.js 和 Electron 开发。编写高质量、可维护的代码，遵循最佳实践。',
      capabilities: JSON.stringify(['coding', 'debugging', 'code-review', 'refactoring']),
    },
    {
      id: randomUUID(),
      name: '运维专家',
      role: '运维专家',
      systemPrompt: '你是一名 DevOps 运维专家，擅长 CI/CD、Docker、Kubernetes 和云基础设施。专注于系统的可靠性、可扩展性和自动化。',
      capabilities: JSON.stringify(['deployment', 'ci-cd', 'monitoring', 'infrastructure']),
    },
    {
      id: randomUUID(),
      name: '通用助手',
      role: '通用助手',
      systemPrompt: '你是一名通用 AI 助手，能够帮助处理各种任务，包括文档编写、需求分析、技术调研和项目管理。',
      capabilities: JSON.stringify(['documentation', 'research', 'planning', 'analysis']),
    },
  ]

  const insertMany = database.transaction(() => {
    for (const c of colleagues) {
      insertStmt.run(c.id, c.name, c.role, c.systemPrompt, c.capabilities)
    }
  })

  insertMany()
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

export { runMigrations }