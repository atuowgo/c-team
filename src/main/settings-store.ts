import { getDatabase } from './database'
import { encryptValue, decryptValue, isEncryptionAvailable, isEncryptedValue } from './safe-storage'

const SENSITIVE_KEYS = new Set(['apiKey', 'ghToken'])

export function getSetting(key: string): unknown {
  const db = getDatabase()
  const row = db.prepare('SELECT config FROM integrations WHERE type = ?')
    .get(`setting:${key}`) as { config: string } | undefined
  if (!row) return null
  const raw = SENSITIVE_KEYS.has(key) ? decryptValue(row.config) : row.config
  return JSON.parse(raw)
}

export function setSetting(key: string, value: unknown): void {
  const db = getDatabase()
  const config = JSON.stringify(value)
  const stored = SENSITIVE_KEYS.has(key) ? encryptValue(config) : config
  db.prepare(`
    INSERT INTO integrations (id, type, config) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = datetime('now')
  `).run(`setting:${key}`, `setting:${key}`, stored)
}

export function migratePlaintextSettings(): void {
  if (!isEncryptionAvailable()) return

  const db = getDatabase()
  const applied = db.prepare('SELECT version FROM _migrations WHERE version = 3').get()
  if (applied) return

  for (const key of SENSITIVE_KEYS) {
    const row = db.prepare('SELECT config FROM integrations WHERE type = ?')
      .get(`setting:${key}`) as { config: string } | undefined
    if (!row || isEncryptedValue(row.config)) continue

    const encrypted = encryptValue(row.config)
    db.prepare("UPDATE integrations SET config = ?, updated_at = datetime('now') WHERE type = ?")
      .run(encrypted, `setting:${key}`)
  }

  db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(3, 'encrypt_sensitive_settings')
}