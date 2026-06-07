import { useState, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useToastStore } from "@/stores/toast-store"
import type { AiColleagueData, AiRoleData, ModelEntry } from "@common/ipc"

function getAvatarClass(name: string): string {
  const idx = name.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) % 8
  return `avatar-gradient-${idx}`
}

function statusDot(status: string): string {
  if (status === "online") return "bg-[var(--success)]"
  if (status === "busy") return "bg-[var(--warning)]"
  if (status === "idle") return "bg-[var(--text-muted)]"
  return "border border-[var(--text-muted)]"
}

function statusLabel(status: string): string {
  if (status === "online") return "在线"
  if (status === "idle") return "空闲"
  if (status === "busy") return "忙碌"
  return "离线"
}

const BUILTIN_MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "gpt-4o", label: "GPT-4o" },
]

export function EmployeeView(): React.ReactElement {
  const [employees, setEmployees] = useState<AiColleagueData[]>([])
  const [roles, setRoles] = useState<AiRoleData[]>([])
  const [customModels, setCustomModels] = useState<ModelEntry[]>([])
  const [loading, setLoading] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editNickname, setEditNickname] = useState("")
  const [editRoleId, setEditRoleId] = useState("")
  const [editPersonalNotes, setEditPersonalNotes] = useState("")
  const [editModel, setEditModel] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const addToast = useToastStore((s) => s.addToast)

  const allModels = [...BUILTIN_MODELS, ...customModels]

  const loadData = useCallback(() => {
    setLoading(true)
    Promise.all([
      window.electron.invoke<AiColleagueData[]>("ai:list"),
      window.electron.invoke<AiRoleData[]>("ai:role-list"),
      window.electron.invoke<ModelEntry[]>("models:list"),
    ]).then(([colleagues, roleList, models]) => {
      setEmployees(colleagues.filter((c) => c.type !== "manager"))
      setRoles(roleList)
      setCustomModels(models)
    }).catch((e) => addToast(`加载失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
      .finally(() => setLoading(false))
  }, [addToast])

  useEffect(() => { loadData() }, [loadData])

  const handleSelect = useCallback((e: AiColleagueData) => {
    setSelectedId(e.id)
    setEditName(e.name)
    setEditNickname(e.nickname || "")
    setEditRoleId(e.role_id || "")
    setEditPersonalNotes(e.personal_notes || "")
    setEditModel(e.model || "")
    setDeleteConfirm(false)
  }, [])

  const handleNew = useCallback(() => {
    setSelectedId("new")
    setEditName("")
    setEditNickname("")
    setEditRoleId(roles.find((r) => r.is_system !== 1)?.id || "")
    setEditPersonalNotes("")
    setEditModel("")
    setDeleteConfirm(false)
  }, [roles])

  const handleSave = useCallback(async () => {
    if (!editName.trim()) {
      addToast("员工姓名不能为空", "error")
      return
    }
    if (!editRoleId) {
      addToast("请选择岗位", "error")
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: editName.trim(),
        nickname: editNickname.trim() || null,
        role_id: editRoleId,
        personal_notes: editPersonalNotes.trim() || null,
        model: editModel || null,
        role: roles.find((r) => r.id === editRoleId)?.name || "",
        system_prompt: "",
        type: "colleague",
      }
      if (selectedId === "new") {
        await window.electron.invoke("ai:create", payload)
      } else {
        await window.electron.invoke("ai:update", selectedId, payload)
      }
      addToast("已保存", "success")
      loadData()
    } catch (e) {
      addToast("保存失败: " + (e instanceof Error ? e.message : String(e)), "error")
    } finally {
      setSaving(false)
    }
  }, [selectedId, editName, editNickname, editRoleId, editPersonalNotes, editModel, roles, addToast, loadData])

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return }
    try {
      await window.electron.invoke("ai:delete", selectedId as string)
      setSelectedId(null)
      loadData()
    } catch (e) {
      addToast("删除失败: " + (e instanceof Error ? e.message : String(e)), "error")
    }
  }, [deleteConfirm, selectedId, addToast, loadData])

  const cardClass = "bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-lg)] p-5"
  const cardTitleClass = "text-sm font-semibold text-[var(--text-primary)]"
  const labelClass = "text-[12.5px] font-medium text-[var(--text-secondary)]"

  const selectedEmployee = employees.find((e) => e.id === selectedId)

  return (
    <div className="flex-1 p-6">
      <h1 className="text-base font-semibold mb-1">员工管理</h1>
      <p className="text-[13px] text-[var(--text-secondary)] mb-6">管理 AI 员工实例，每位员工绑定一个岗位</p>

      <div className="flex gap-4" style={{ minHeight: 400 }}>
        {/* Left: employee list */}
        <div className={cardClass + " w-56 shrink-0 flex flex-col"}>
          <div className="flex items-center justify-between mb-3">
            <p className={cardTitleClass}>员工列表</p>
            <button
              type="button"
              onClick={handleNew}
              className="text-[12px] text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium"
            >
              + 新建
            </button>
          </div>

          {loading ? (
            <p className="text-[var(--text-muted)] text-[12px] py-4 text-center">加载中...</p>
          ) : employees.length === 0 ? (
            <p className="text-[var(--text-muted)] text-[12px] py-4 text-center">暂无员工</p>
          ) : (
            <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
              {employees.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => handleSelect(e)}
                  className={[
                    "flex items-center gap-2 py-2 px-2 rounded-md text-left transition-colors w-full",
                    selectedId === e.id
                      ? "bg-[var(--accent)] text-white"
                      : "hover:bg-[var(--bg-base)] text-[var(--text-primary)]",
                  ].join(" ")}
                >
                  <div className={[
                    "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                    selectedId === e.id ? "bg-white/20" : getAvatarClass(e.name),
                  ].join(" ")}>
                    <span className="text-white text-[11px] font-semibold">
                      {(e.nickname || e.name).charAt(0)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium truncate">{e.nickname || e.name}</p>
                    <div className="flex items-center gap-1">
                      <span className={[
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        selectedId === e.id ? "bg-white/70" : statusDot(e.status),
                      ].join(" ")} />
                      <span className={"text-[11px] " + (selectedId === e.id ? "text-white/70" : "text-[var(--text-muted)]")}>
                        {statusLabel(e.status)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: edit panel */}
        {selectedId ? (
          <div className={cardClass + " flex-1 flex flex-col gap-4"}>
            <p className={cardTitleClass}>
              {selectedId === "new" ? "新建员工" : `编辑员工：${selectedEmployee?.nickname || selectedEmployee?.name || ""}`}
            </p>

            <div className="grid grid-cols-2 gap-4">
              {/* Name */}
              <div className="space-y-1">
                <label className={labelClass}>
                  姓名 <span className="text-[var(--danger)]">*</span>
                </label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="如：Alice"
                />
              </div>

              {/* Nickname */}
              <div className="space-y-1">
                <label className={labelClass}>昵称</label>
                <Input
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  placeholder="留空则使用姓名"
                />
              </div>
            </div>

            {/* Role */}
            <div className="space-y-1">
              <label className={labelClass}>
                岗位 <span className="text-[var(--danger)]">*</span>
              </label>
              <Select
                key={selectedId}
                value={editRoleId || "__none__"}
                onValueChange={(v) => setEditRoleId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择岗位" />
                </SelectTrigger>
                <SelectContent>
                  {roles.filter((r) => r.is_system !== 1).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editRoleId && roles.find((r) => r.id === editRoleId) && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">
                  岗位提示词：{roles.find((r) => r.id === editRoleId)?.system_prompt.slice(0, 80)}...
                </p>
              )}
            </div>

            {/* Personal notes */}
            <div className="space-y-1 flex flex-col flex-1">
              <label className={labelClass}>个人补充说明</label>
              <textarea
                value={editPersonalNotes}
                onChange={(e) => setEditPersonalNotes(e.target.value)}
                placeholder="补充该员工的个人特性，会追加到岗位提示词后面。如：擅长 Java 开发，熟悉 Spring Boot 框架..."
                rows={5}
                className="w-full rounded-md border border-[var(--border-default)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>

            {/* Model override */}
            <div className="space-y-1">
              <label className={labelClass}>使用模型</label>
              <Select
                key={selectedId + "-model"}
                value={editModel || "__inherit__"}
                onValueChange={(v) => setEditModel(v === "__inherit__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="继承全局默认" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__inherit__">继承全局默认</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-default)]">
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || !editName.trim() || !editRoleId}
                className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
              >
                {saving ? "保存中..." : "保存"}
              </Button>
              {selectedId !== "new" && (
                deleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[var(--danger)]">确认删除？</span>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="text-[12px] text-[var(--danger)] hover:underline font-medium"
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(false)}
                      className="text-[12px] text-[var(--text-muted)] hover:underline"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="text-[12px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                  >
                    删除
                  </button>
                )
              )}
            </div>
          </div>
        ) : (
          <div className={cardClass + " flex-1 flex items-center justify-center"}>
            <p className="text-[13px] text-[var(--text-muted)]">选择一位员工编辑，或新建员工</p>
          </div>
        )}
      </div>
    </div>
  )
}
