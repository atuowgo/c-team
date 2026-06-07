import Database from 'better-sqlite3'

interface Migration {
  version: number
  name: string
  sql: string
  requiresFkOff?: boolean
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'topic',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        parent_id TEXT,
        context_ref TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);

      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        channel_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        board_id TEXT,
        column_id TEXT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        assignee TEXT,
        priority TEXT DEFAULT 'medium',
        labels TEXT DEFAULT '[]',
        pr_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE SET NULL,
        FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_board ON tickets(board_id);

      CREATE TABLE IF NOT EXISTS ticket_comments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_colleagues (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        capabilities TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'idle',
        current_task TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ai_task_queue (
        id TEXT PRIMARY KEY,
        colleague_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        priority INTEGER DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (colleague_id) REFERENCES ai_colleagues(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `
  },
  {
    version: 3,
    name: 'encrypt_sensitive_settings',
    sql: `SELECT 1` // runtime migration in settings-store.ts
  },
  {
    version: 4,
    name: 'add_colleague_model_nickname',
    sql: `
    ALTER TABLE ai_colleagues ADD COLUMN model TEXT;
    ALTER TABLE ai_colleagues ADD COLUMN nickname TEXT;
  `
  },
  {
    version: 6,
    name: 'colleague_type',
    sql: `ALTER TABLE ai_colleagues ADD COLUMN type TEXT NOT NULL DEFAULT 'colleague';`
  },
  {
    version: 5,
    name: 'memory_and_features',
    sql: `
    ALTER TABLE messages ADD COLUMN reply_to_id TEXT;

    CREATE TABLE IF NOT EXISTS channel_managers (
      channel_id TEXT PRIMARY KEY,
      colleague_id TEXT NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (colleague_id) REFERENCES ai_colleagues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channel_memories (
      channel_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS topic_summaries (
      topic_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      message_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS colleague_notes (
      colleague_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (colleague_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS memory_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `
  },
  {
    version: 7,
    name: 'roles_and_channel_members',
    sql: `
    CREATE TABLE IF NOT EXISTS ai_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO ai_roles (id, name, system_prompt, is_system)
    VALUES (
      'system-manager',
      '频道管理员',
      '你是团队的频道管理员，负责理解用户需求并协调团队成员完成任务。你是 Planner，其他同事是 Executor。需要分配任务时，用 @姓名 方式指派给对应成员。',
      1
    );

    UPDATE ai_roles SET system_prompt = (
      SELECT system_prompt FROM ai_colleagues WHERE type = 'manager' LIMIT 1
    ) WHERE id = 'system-manager' AND EXISTS (SELECT 1 FROM ai_colleagues WHERE type = 'manager');

    INSERT OR IGNORE INTO ai_roles (id, name, system_prompt, is_system)
    VALUES ('role-default', '默认岗位', '你是一名 AI 助手，协助完成分配给你的任务。', 0);

    ALTER TABLE ai_colleagues ADD COLUMN role_id TEXT REFERENCES ai_roles(id);
    ALTER TABLE ai_colleagues ADD COLUMN personal_notes TEXT;

    UPDATE ai_colleagues SET role_id = 'role-default' WHERE type != 'manager' AND role_id IS NULL;

    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      colleague_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, colleague_id)
    );

    INSERT OR IGNORE INTO channel_members (channel_id, colleague_id)
    SELECT channel_id, 'system-manager' FROM channel_managers;
  `
  },
  {
    version: 8,
    name: 'fix_task_queue_colleague_fk',
    requiresFkOff: true,
    sql: `
    CREATE TABLE ai_task_queue_v8 (
      id TEXT PRIMARY KEY,
      colleague_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      priority INTEGER DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO ai_task_queue_v8 SELECT id, colleague_id, event_type, payload, priority, status, result, completed_at, created_at FROM ai_task_queue;
    DROP TABLE ai_task_queue;
    ALTER TABLE ai_task_queue_v8 RENAME TO ai_task_queue;
    `
  },
  {
    version: 9,
    name: 'add_role_description',
    sql: `
    ALTER TABLE ai_roles ADD COLUMN description TEXT NOT NULL DEFAULT '';
    UPDATE ai_roles SET description = '负责理解用户需求、分解任务并协调团队成员执行' WHERE id = 'system-manager';
    UPDATE ai_roles SET description = '协助完成分配给你的各类任务' WHERE id = 'role-default';
    `
  }
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all()
      .map((r: unknown) => (r as { version: number }).version)
  )

  for (const m of migrations) {
    if (!applied.has(m.version)) {
      if (m.requiresFkOff) db.pragma('foreign_keys = OFF')
      db.exec(m.sql)
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(m.version, m.name)
      if (m.requiresFkOff) db.pragma('foreign_keys = ON')
    }
  }
}