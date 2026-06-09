import { useState, useEffect } from "react"
import { Switch } from "@/components/ui/switch"

interface SkillMeta { name: string; description: string; body: string; enabled: boolean; installedAt: string }

export function SkillsView(): React.ReactElement {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())
  const [isDragOver, setIsDragOver] = useState(false)

  useEffect(() => {
    setSkillsLoading(true)
    window.electron.invoke<SkillMeta[]>('skills:list').then((list) => {
      setSkills(list)
      setSkillsLoading(false)
    })
  }, [])

  const handleSkillUpload = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const result = await window.electron.invoke<{ success: boolean; skill?: SkillMeta; error?: string }>(
      'skills:upload',
      { filename: file.name, buffer: Array.from(new Uint8Array(buffer)) }
    )
    if (result.success && result.skill) {
      setSkills((prev) => [...prev, result.skill!])
    } else {
      alert(result.error || '上传失败')
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">技能管理</h1>
      <p className="text-sm text-muted-foreground mb-6">管理 AI 同事可使用的技能包</p>

      {/* Upload Zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors mb-6 ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file && file.name.endsWith('.zip')) handleSkillUpload(file)
        }}
      >
        <p className="text-sm text-muted-foreground mb-3">拖拽 .zip 技能包到此处</p>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleSkillUpload(file)
            }}
          />
          <span className="inline-flex items-center px-3 py-1.5 text-sm border rounded-md hover:bg-muted cursor-pointer">
            选择文件
          </span>
        </label>
      </div>

      {/* Skills List */}
      {skillsLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">加载中...</p>
      ) : skills.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">暂无已安装技能</p>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.name} className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandedSkills((prev) => {
                    const next = new Set(prev)
                    next.has(skill.name) ? next.delete(skill.name) : next.add(skill.name)
                    return next
                  })}
                >
                  {expandedSkills.has(skill.name) ? '▼' : '▶'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{skill.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{skill.description}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">安装于 {skill.installedAt}</div>
                </div>
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={async (enabled) => {
                    await window.electron.invoke('skills:toggle', { name: skill.name, enabled })
                    setSkills((prev) => prev.map((s) => s.name === skill.name ? { ...s, enabled } : s))
                  }}
                />
                <button
                  className="text-muted-foreground hover:text-destructive ml-2"
                  onClick={async () => {
                    if (!confirm(`确认删除技能 "${skill.name}"？`)) return
                    await window.electron.invoke('skills:delete', skill.name)
                    setSkills((prev) => prev.filter((s) => s.name !== skill.name))
                  }}
                >
                  ✕
                </button>
              </div>
              {expandedSkills.has(skill.name) && (
                <pre className="bg-muted text-xs p-3 border-t overflow-auto whitespace-pre-wrap font-mono">
                  {skill.body}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
