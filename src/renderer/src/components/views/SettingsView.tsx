import { useState, useEffect, useCallback, type FormEvent } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useToastStore } from "@/stores/toast-store"
import type { AiRoleData, ModelEntry } from "@common/ipc"

type TabValue = "api" | "github" | "roles"
type ProviderType = "anthropic" | "openai-compatible" | "deepseek"

const BUILTIN_MODELS: Record<ProviderType, ModelEntry[]> = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  "openai-compatible": [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  deepseek: [
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  ],
}

const PROVIDER_DEFAULT_BASEURL: Record<ProviderType, string> = {
  anthropic: "",
  "openai-compatible": "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
}

const PROVIDER_DEFAULT_MODEL: Record<ProviderType, string> = {
  anthropic: "claude-sonnet-4-6",
  "openai-compatible": "gpt-4o",
  deepseek: "deepseek-v4-flash",
}

function normalizeProviderModel(providerType: ProviderType, value: string): string {
  if (providerType !== "deepseek") return value
  if (value === "deepseek-chat" || value === "deepseek-reasoner") return PROVIDER_DEFAULT_MODEL.deepseek
  return value
}

export function SettingsView(): React.ReactElement {
  const [tab, setTab] = useState<TabValue>("api")

  // API config
  const [providerType, setProviderType] = useState<ProviderType>("deepseek")
  const [baseURL, setBaseURL] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(PROVIDER_DEFAULT_MODEL.deepseek)
  const [maxConcurrency, setMaxConcurrency] = useState("2")
  const [apiSaved, setApiSaved] = useState(false)
  const [apiSaving, setApiSaving] = useState(false)

  // Custom models
  const [customModels, setCustomModels] = useState<ModelEntry[]>([])
  const [newModelId, setNewModelId] = useState("")
  const [newModelLabel, setNewModelLabel] = useState("")

  // GitHub config
  const [ghToken, setGhToken] = useState("")
  const [ghOwner, setGhOwner] = useState("")
  const [ghRepo, setGhRepo] = useState("")
  const [ghSaved, setGhSaved] = useState(false)
  const [ghSaving, setGhSaving] = useState(false)
  const [ghConnected, setGhConnected] = useState<boolean | null>(null)

  // Roles (岗位)
  const [roles, setRoles] = useState<AiRoleData[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [editRoleName, setEditRoleName] = useState("")
  const [editRolePrompt, setEditRolePrompt] = useState("")
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleDeleteConfirm, setRoleDeleteConfirm] = useState(false)

  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    Promise.all([
      window.electron.invoke("settings:get", "apiKey").then((v) => {
        if (typeof v === "string" && v) setApiKey(v)
      }),
      window.electron.invoke("settings:get", "model").then((v) => {
        if (typeof v === "string" && v) setModel(normalizeProviderModel(providerType, v))
      }),
      window.electron.invoke("settings:get", "providerType").then((v) => {
        if (v === "anthropic" || v === "openai-compatible" || v === "deepseek") setProviderType(v)
      }),
      window.electron.invoke("settings:get", "baseURL").then((v) => {
        if (typeof v === "string") setBaseURL(v)
      }),
      window.electron.invoke("settings:get", "maxConcurrency").then((v) => {
        if (typeof v === "string" && v) setMaxConcurrency(v)
        else if (typeof v === "number" && v) setMaxConcurrency(String(v))
      }),
      window.electron.invoke("settings:get", "ghToken").then((v) => {
        if (typeof v === "string" && v) setGhToken(v)
      }),
      window.electron.invoke("settings:get", "ghOwner").then((v) => {
        if (typeof v === "string" && v) setGhOwner(v)
      }),
      window.electron.invoke("settings:get", "ghRepo").then((v) => {
        if (typeof v === "string" && v) setGhRepo(v)
      }),
      window.electron.invoke<ModelEntry[]>("models:list").then((list) => {
        setCustomModels(list)
      }),
    ]).catch((e) => addToast(`加载设置失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
  }, [addToast])

  const allModels = [...BUILTIN_MODELS[providerType], ...customModels]

  useEffect(() => {
    setModel((current) => normalizeProviderModel(providerType, current))
  }, [providerType])

  const handleProviderChange = (type: ProviderType) => {
    const wasDefault = baseURL === PROVIDER_DEFAULT_BASEURL[providerType]
    setProviderType(type)
    if (wasDefault) setBaseURL(PROVIDER_DEFAULT_BASEURL[type])
    const validIds = [...BUILTIN_MODELS[type], ...customModels].map((m) => m.id)
    if (!validIds.includes(model)) setModel(PROVIDER_DEFAULT_MODEL[type])
  }

  const handleAddModel = useCallback(() => {
    const id = newModelId.trim()
    if (!id) return
    window.electron.invoke<ModelEntry[]>("models:add", id, newModelLabel.trim() || id)
      .then((updated) => {
        setCustomModels(updated)
        setNewModelId("")
        setNewModelLabel("")
      })
      .catch((e) => addToast(`添加模型失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
  }, [newModelId, newModelLabel, addToast])

  const handleRemoveModel = useCallback((id: string) => {
    window.electron.invoke<ModelEntry[]>("models:remove", id)
      .then((updated) => {
        setCustomModels(updated)
        if (model === id) setModel(PROVIDER_DEFAULT_MODEL[providerType])
      })
      .catch((e) => addToast(`删除模型失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
  }, [model, providerType, addToast])

  // --- Roles ---
  const loadRoles = useCallback(() => {
    setRolesLoading(true)
    window.electron.invoke<AiRoleData[]>("ai:role-list")
      .then((list) => setRoles(list))
      .catch((e) => addToast(`加载岗位列表失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
      .finally(() => setRolesLoading(false))
  }, [addToast])

  useEffect(() => {
    if (tab === "roles") loadRoles()
  }, [tab, loadRoles])

  const handleSelectRole = useCallback((r: AiRoleData) => {
    setSelectedRoleId(r.id)
    setEditRoleName(r.name)
    setEditRolePrompt(r.system_prompt)
    setRoleDeleteConfirm(false)
  }, [])

  const handleNewRole = useCallback(() => {
    setSelectedRoleId("new")
    setEditRoleName("")
    setEditRolePrompt("")
    setRoleDeleteConfirm(false)
  }, [])

  const handleSaveRole = useCallback(async () => {
    if (!editRoleName.trim()) {
      addToast("岗位名称不能为空", "error")
      return
    }
    setRoleSaving(true)
    try {
      if (selectedRoleId === "new") {
        await window.electron.invoke("ai:role-create", {
          name: editRoleName.trim(),
          system_prompt: editRolePrompt.trim(),
        })
      } else {
        await window.electron.invoke("ai:role-update", selectedRoleId, {
          name: editRoleName.trim(),
          system_prompt: editRolePrompt.trim(),
        })
      }
      addToast("已保存", "success")
      loadRoles()
    } catch (e) {
      addToast("保存失败: " + (e instanceof Error ? e.message : String(e)), "error")
    } finally {
      setRoleSaving(false)
    }
  }, [selectedRoleId, editRoleName, editRolePrompt, addToast, loadRoles])

  const handleDeleteRole = useCallback(async () => {
    if (!roleDeleteConfirm) { setRoleDeleteConfirm(true); return }
    try {
      await window.electron.invoke("ai:role-delete", selectedRoleId as string)
      setSelectedRoleId(null)
      loadRoles()
    } catch (e) {
      addToast("删除失败: " + (e instanceof Error ? e.message : String(e)), "error")
    }
  }, [roleDeleteConfirm, selectedRoleId, addToast, loadRoles])

  const handleSaveApi = useCallback((e: FormEvent) => {
    e.preventDefault()
    setApiSaving(true)
    Promise.all([
      window.electron.invoke("settings:set", "apiKey", apiKey),
      window.electron.invoke("settings:set", "model", model),
      window.electron.invoke("settings:set", "providerType", providerType),
      window.electron.invoke("settings:set", "baseURL", baseURL),
      window.electron.invoke("settings:set", "maxConcurrency", Number(maxConcurrency)),
    ]).then(() => {
      setApiSaved(true)
      setTimeout(() => setApiSaved(false), 2000)
    }).catch((e) => addToast(`保存API配置失败: ${e instanceof Error ? e.message : String(e)}`, "error")).finally(() => setApiSaving(false))
  }, [apiKey, model, providerType, baseURL, maxConcurrency, addToast])

  const handleSaveGh = useCallback((e: FormEvent) => {
    e.preventDefault()
    setGhSaving(true)
    Promise.all([
      window.electron.invoke("settings:set", "ghToken", ghToken),
      window.electron.invoke("settings:set", "ghOwner", ghOwner),
      window.electron.invoke("settings:set", "ghRepo", ghRepo),
    ]).then(() => {
      setGhConnected(true)
      setGhSaved(true)
      setTimeout(() => setGhSaved(false), 2000)
    }).catch((e) => {
      setGhConnected(false)
      addToast(`保存GitHub配置失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }).finally(() => setGhSaving(false))
  }, [ghToken, ghOwner, ghRepo, addToast])

  const cardClass =
    "bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-lg)] p-5"
  const cardTitleClass = "text-sm font-semibold text-[var(--text-primary)]"
  const cardDescClass = "text-[12px] text-[var(--text-muted)]"
  const labelClass = "text-[12.5px] font-medium text-[var(--text-secondary)]"

  const baseURLPlaceholder =
    providerType === "anthropic"
      ? "https://api.anthropic.com （留空使用默认）"
      : providerType === "deepseek"
      ? "https://api.deepseek.com"
      : "https://api.openai.com/v1"

  const selectedRole = roles.find((r) => r.id === selectedRoleId)
  const isSystemRole = selectedRole?.is_system === 1

  return (
    <div className="flex-1 p-6">
      <h1 className="text-base font-semibold mb-1">设置</h1>
      <p className="text-[13px] text-[var(--text-secondary)] mb-6">配置 API Key、GitHub 集成和管理 AI 岗位</p>

      <Tabs value={tab} onValueChange={(v: string) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="api">API 配置</TabsTrigger>
          <TabsTrigger value="github">GitHub 集成</TabsTrigger>
          <TabsTrigger value="roles">岗位管理</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <div className={cardClass + " max-w-lg"}>
            <p className={cardTitleClass}>API 配置</p>
            <p className={cardDescClass + " mt-1 mb-4"}>配置 AI 模型提供方、API Key 和默认模型</p>
            <form onSubmit={handleSaveApi} className="space-y-4">
              {/* Provider Type */}
              <div className="space-y-2">
                <Label className={labelClass}>Provider</Label>
                <div className="flex gap-2">
                  {(["anthropic", "deepseek", "openai-compatible"] as ProviderType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleProviderChange(type)}
                      className={[
                        "flex-1 py-1.5 px-3 rounded-md text-[12.5px] font-medium border transition-colors",
                        providerType === type
                          ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                          : "bg-transparent text-[var(--text-secondary)] border-[var(--border-default)] hover:border-[var(--text-muted)]",
                      ].join(" ")}
                    >
                      {type === "anthropic" ? "Anthropic" : type === "deepseek" ? "DeepSeek" : "OpenAI-compatible"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Base URL */}
              <div className="space-y-2">
                <Label htmlFor="base-url" className={labelClass}>Base URL</Label>
                <Input
                  id="base-url"
                  type="text"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder={baseURLPlaceholder}
                />
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <Label htmlFor="api-key" className={labelClass}>API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>

              {/* Model Select */}
              <div className="space-y-2">
                <Label htmlFor="model" className={labelClass}>默认模型</Label>
                <Select key={providerType} value={model} onValueChange={setModel}>
                  <SelectTrigger id="model">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {allModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Max Concurrency */}
              <div className="space-y-2">
                <Label htmlFor="max-concurrency" className={labelClass}>AI 最大并发数</Label>
                <Select value={maxConcurrency} onValueChange={setMaxConcurrency}>
                  <SelectTrigger id="max-concurrency">
                    <SelectValue placeholder="选择并发数" />
                  </SelectTrigger>
                  <SelectContent>
                    {["1", "2", "3", "4", "5"].map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={apiSaving || !apiKey}
                  className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                >
                  {apiSaving ? "保存中..." : "保存"}
                </Button>
                {apiSaved && <span className="text-[13px] text-[var(--success)]">已保存</span>}
              </div>
            </form>

            {/* Custom Models Management */}
            <div className="mt-6 pt-5 border-t border-[var(--border-default)]">
              <p className={cardTitleClass + " mb-1"}>自定义模型</p>
              <p className={cardDescClass + " mb-3"}>手动添加任意模型 ID（如本地 Ollama、第三方接口等）</p>

              <div className="flex gap-2 mb-3">
                <Input
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  placeholder="模型 ID，如 llama3.2"
                  className="flex-1 text-[13px]"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddModel())}
                />
                <Input
                  value={newModelLabel}
                  onChange={(e) => setNewModelLabel(e.target.value)}
                  placeholder="显示名称（可选）"
                  className="flex-1 text-[13px]"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddModel())}
                />
                <Button
                  type="button"
                  onClick={handleAddModel}
                  disabled={!newModelId.trim()}
                  className="shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-3"
                >
                  添加
                </Button>
              </div>

              {customModels.length > 0 ? (
                <div className="space-y-1">
                  {customModels.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md bg-[var(--bg-base)] group"
                    >
                      <div className="min-w-0">
                        <span className="text-[13px] text-[var(--text-primary)] font-medium">{m.label}</span>
                        {m.label !== m.id && (
                          <span className="ml-2 text-[11px] text-[var(--text-muted)]">{m.id}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(m.id)}
                        className="text-[var(--text-muted)] hover:text-[var(--danger)] text-[13px] px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--text-muted)]">暂无自定义模型</p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="github">
          <div className={cardClass + " max-w-lg"}>
            <p className={cardTitleClass}>GitHub 集成</p>
            <p className={cardDescClass + " mt-1 mb-4"}>连接 GitHub 仓库以启用自动化 PR 和代码审查</p>
            <form onSubmit={handleSaveGh} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gh-token" className={labelClass}>GitHub Token</Label>
                <Input
                  id="gh-token"
                  type="password"
                  value={ghToken}
                  onChange={(e) => setGhToken(e.target.value)}
                  placeholder="ghp_..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="gh-owner" className={labelClass}>Owner</Label>
                  <Input
                    id="gh-owner"
                    value={ghOwner}
                    onChange={(e) => setGhOwner(e.target.value)}
                    placeholder="e.g. facebook"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gh-repo" className={labelClass}>Repo</Label>
                  <Input
                    id="gh-repo"
                    value={ghRepo}
                    onChange={(e) => setGhRepo(e.target.value)}
                    placeholder="e.g. react"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={ghSaving || !ghToken}
                  className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                >
                  {ghSaving ? "保存中..." : "保存并连接"}
                </Button>
                {ghSaved && <span className="text-[13px] text-[var(--success)]">已保存</span>}
                {ghConnected === true && (
                  <span className="text-[12px] font-medium text-[var(--success)] flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                    已连接
                  </span>
                )}
                {ghConnected === false && (
                  <span className="text-[12px] font-medium text-[var(--danger)] flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--danger)]" />
                    连接失败
                  </span>
                )}
              </div>
            </form>
          </div>
        </TabsContent>

        <TabsContent value="roles">
          <div className="flex gap-4" style={{ minHeight: 400 }}>
            {/* Left: role list */}
            <div className={cardClass + " w-56 shrink-0 flex flex-col"}>
              <div className="flex items-center justify-between mb-3">
                <p className={cardTitleClass}>岗位列表</p>
                <button
                  type="button"
                  onClick={handleNewRole}
                  className="text-[12px] text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium"
                >
                  + 新建
                </button>
              </div>

              {rolesLoading ? (
                <p className="text-[var(--text-muted)] text-[12px] py-4 text-center">加载中...</p>
              ) : (
                <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
                  {/* system-manager pinned at top */}
                  {roles.filter((r) => r.is_system === 1).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleSelectRole(r)}
                      className={[
                        "flex items-center gap-2 py-2 px-2 rounded-md text-left transition-colors w-full",
                        selectedRoleId === r.id
                          ? "bg-[var(--accent)] text-white"
                          : "hover:bg-[var(--bg-base)] text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      <div className={[
                        "w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-base",
                        selectedRoleId === r.id ? "bg-white/20" : "bg-[var(--ai-muted)]",
                      ].join(" ")}>
                        👑
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium truncate">{r.name}</p>
                        <p className={[
                          "text-[11px]",
                          selectedRoleId === r.id ? "text-white/70" : "text-[var(--text-muted)]",
                        ].join(" ")}>系统角色</p>
                      </div>
                    </button>
                  ))}

                  {/* Regular roles */}
                  {roles.filter((r) => r.is_system !== 1).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleSelectRole(r)}
                      className={[
                        "flex items-center gap-2 py-2 px-2 rounded-md text-left transition-colors w-full",
                        selectedRoleId === r.id
                          ? "bg-[var(--accent)] text-white"
                          : "hover:bg-[var(--bg-base)] text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      <div className={[
                        "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                        selectedRoleId === r.id ? "bg-white/20" : "bg-[var(--bg-base)]",
                      ].join(" ")}>
                        <span className={[
                          "text-[11px] font-semibold",
                          selectedRoleId === r.id ? "text-white" : "text-[var(--text-muted)]",
                        ].join(" ")}>
                          {r.name.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium truncate">{r.name}</p>
                      </div>
                    </button>
                  ))}

                  {roles.length === 0 && (
                    <p className="text-[var(--text-muted)] text-[12px] py-4 text-center">暂无岗位</p>
                  )}
                </div>
              )}
            </div>

            {/* Right: edit panel */}
            {selectedRoleId ? (
              <div className={cardClass + " flex-1 flex flex-col gap-4"}>
                <p className={cardTitleClass}>
                  {selectedRoleId === "new" ? "新建岗位" : isSystemRole ? "编辑系统角色" : "编辑岗位"}
                </p>

                {/* Role name */}
                <div className="space-y-1">
                  <label className={labelClass}>
                    岗位名称 <span className="text-[var(--danger)]">*</span>
                  </label>
                  <Input
                    value={editRoleName}
                    onChange={(e) => setEditRoleName(e.target.value)}
                    placeholder="如：全栈工程师"
                    disabled={isSystemRole}
                    className={isSystemRole ? "opacity-60 cursor-not-allowed" : ""}
                  />
                  {isSystemRole && (
                    <p className="text-[11px] text-[var(--text-muted)]">系统角色名称不可修改</p>
                  )}
                </div>

                {/* System prompt */}
                <div className="space-y-1 flex flex-col flex-1">
                  <label className={labelClass}>系统提示词</label>
                  <textarea
                    value={editRolePrompt}
                    onChange={(e) => setEditRolePrompt(e.target.value)}
                    placeholder="描述该岗位的职责和行为规范..."
                    rows={8}
                    className="w-full rounded-md border border-[var(--border-default)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)] flex-1"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-default)]">
                  <Button
                    type="button"
                    onClick={handleSaveRole}
                    disabled={roleSaving || !editRoleName.trim()}
                    className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                  >
                    {roleSaving ? "保存中..." : "保存"}
                  </Button>
                  {!isSystemRole && selectedRoleId !== "new" && (
                    roleDeleteConfirm ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-[var(--danger)]">确认删除？</span>
                        <button
                          type="button"
                          onClick={handleDeleteRole}
                          className="text-[12px] text-[var(--danger)] hover:underline font-medium"
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          onClick={() => setRoleDeleteConfirm(false)}
                          className="text-[12px] text-[var(--text-muted)] hover:underline"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleDeleteRole}
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
                <p className="text-[13px] text-[var(--text-muted)]">
                  选择一个岗位编辑，或
                  <button type="button" onClick={handleNewRole} className="text-[var(--accent)] hover:underline">新建岗位</button>
                </p>
              </div>
            )}
          </div>
        </TabsContent>

      </Tabs>
    </div>
  )
}
