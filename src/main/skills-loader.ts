import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

interface SkillMeta {
  name: string
  description: string
  body: string
}

function parseSkillMd(content: string): SkillMeta | null {
  // 解析 YAML frontmatter: ---\nname: ...\ndescription: ...\n---\n...body
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null

  const frontmatter = match[1]
  const body = match[2].trim()

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  if (!nameMatch || !descMatch) return null

  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
    body,
  }
}

let skillsDir: string | null = null

function getSkillsDir(): string {
  if (skillsDir) return skillsDir
  // 在开发和生产环境下都指向项目根目录的 skills/
  skillsDir = join(process.cwd(), 'skills')
  return skillsDir
}

/**
 * 返回所有 skills 的摘要（name + description），用于 system prompt 的 Level 1 加载。
 * 返回 null 表示没有 skill。
 */
export function loadSkillsContext(): string | null {
  const dir = getSkillsDir()
  if (!existsSync(dir)) return null

  const skills: SkillMeta[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillMdPath = join(dir, entry.name, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    const content = readFileSync(skillMdPath, 'utf-8')
    const meta = parseSkillMd(content)
    if (meta) skills.push(meta)
  }

  if (skills.length === 0) return null

  const lines = [
    '## 可用技能 (Agent Skills)',
    '当任务需要以下技能时，你可以请求加载完整技能指令。',
    '',
    ...skills.map((s) => `- **${s.name}**: ${s.description}`),
  ]
  return lines.join('\n')
}

/**
 * 加载指定 skill 的完整指令内容（Level 2/3 加载）。
 */
export function loadSkillBody(skillName: string): string | null {
  const dir = getSkillsDir()
  const skillMdPath = join(dir, skillName, 'SKILL.md')
  if (!existsSync(skillMdPath)) return null

  const content = readFileSync(skillMdPath, 'utf-8')
  const meta = parseSkillMd(content)
  return meta?.body ?? null
}

/**
 * 加载所有 skills 的完整信息（name + description + body），供 AI 自动选技能使用。
 */
export function loadAllSkillsWithBodies(): SkillMeta[] {
  const dir = getSkillsDir()
  if (!existsSync(dir)) return []

  const skills: SkillMeta[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillMdPath = join(dir, entry.name, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    const content = readFileSync(skillMdPath, 'utf-8')
    const meta = parseSkillMd(content)
    if (meta) skills.push(meta)
  }

  return skills
}
