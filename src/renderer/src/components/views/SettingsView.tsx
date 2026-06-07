import { useState, useEffect, useCallback, type FormEvent } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useToastStore } from "@/stores/toast-store"
import type { AiColleagueData, ModelEntry } from "@common/ipc"

type TabValue = "api" | "github" | "colleagues"
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

function getAvatarClass(name: string): string {
  const idx = name.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) % 8
  return `avatar-gradient-${idx}`
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

  // AI colleagues
  const [colleagues, setColleagues] = useState<AiColleagueData[]>([])
  const [colleaguesLoading, setColleaguesLoading] = useState(false)

  // Colleague edit panel state
  const [selectedColleagueId, setSelectedColleagueId] = useState<string | null>(null) // null = none, 'new' = create form
  const [editNickname, setEditNickname] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editSystemPrompt, setEditSystemPrompt] = useState('')
  const [editCapabilities, setEditCapabilities] = useState<string[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [capInput, setCapInput] = useState('')

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

  const loadColleagues = useCallback(() => {
    setColleaguesLoading(true)
    window.electron.invoke<AiColleagueData[]>("ai:list").then((list) => {
      setColleagues(list)
    }).catch((e) => addToast(`加载AI同事列表失败: ${e instanceof Error ? e.message : String(e)}`, "error")).finally(() => setColleaguesLoading(false))
  }, [addToast])

  useEffect(() => {
    if (tab === "colleagues") loadColleagues()
  }, [tab, loadColleagues])

  const handleSelectColleague = useCallback((c: AiColleagueData) => {
    setSelectedColleagueId(c.id)
    setEditNickname(c.nickname || '')
    setEditRole(c.role)
    setEditModel(c.model || '')
    setEditSystemPrompt(c.system_prompt)
    try { setEditCapabilities(JSON.parse(c.capabilities) as string[]) } catch { setEditCapabilities([]) }
    setDeleteConfirm(false)
  }, [])

  const handleNewColleague = useCallback(() => {
    setSelectedColleagueId('new')
    setEditNickname('')
    setEditRole('')
    setEditModel('')
    setEditSystemPrompt('')
    setEditCapabilities([])
    setDeleteConfirm(false)
  }, [])

  const handleSaveColleague = useCallback(async () => {
    if (!editRole.trim() || !editSystemPrompt.trim()) {
      addToast('角色和系统提示词不能为空', 'error')
      return
    }
    setEditSaving(true)
    try {
      const payload = {
        name: editNickname.trim() || editRole.trim(),
        role: editRole.trim(),
        system_prompt: editSystemPrompt.trim(),
        capabilities: editCapabilities,
        model: editModel || null,
        nickname: editNickname.trim() || null,
      }
      if (selectedColleagueId === 'new') {
        await window.electron.invoke('ai:create', payload)
      } else {
        await window.electron.invoke('ai:update', selectedColleagueId, payload)
      }
      addToast('已保存', 'success')
      loadColleagues()
    } catch (e) {
      addToast('保存失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setEditSaving(false)
    }
  }, [selectedColleagueId, editNickname, editRole, editModel, editSystemPrompt, editCapabilities, addToast, loadColleagues])

  const handleDeleteColleague = useCallback(async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return }
    try {
      await window.electron.invoke('ai:delete', selectedColleagueId as string)
      setSelectedColleagueId(null)
      loadColleagues()
    } catch (e) {
      addToast('删除失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [deleteConfirm, selectedColleagueId, addToast, loadColleagues])

  const handleAddCap = useCallback(() => {
    const v = capInput.trim()
    if (v && !editCapabilities.includes(v)) {
      setEditCapabilities(prev => [...prev, v])
    }
    setCapInput('')
  }, [capInput, editCapabilities])

  const handleRemoveCap = useCallback((cap: string) => {
    setEditCapabilities(prev => prev.filter(c => c !== cap))
  }, [])

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

  return (
    <div className="flex-1 p-6">
      <h1 className="text-base font-semibold mb-1">设置</h1>
      <p className="text-[13px] text-[var(--text-secondary)] mb-6">配置 API Key、GitHub 集成和管理 AI 同事</p>

      <Tabs value={tab} onValueChange={(v: string) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="api">API 配置</TabsTrigger>
          <TabsTrigger value="github">GitHub 集成</TabsTrigger>
          <TabsTrigger value="colleagues">AI 同事管理</TabsTrigger>
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

              {/* Add Model Input */}
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

              {/* Custom Model List */}
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

        <TabsContent value="colleagues">
          <div className="flex gap-4" style={{ minHeight: 400 }}>
            {/* Left: colleague list */}
            <div className={cardClass + " w-56 shrink-0 flex flex-col"}>
              <div className="flex items-center justify-between mb-3">
                <p className={cardTitleClass}>AI 同事</p>
                <button
                  type="button"
                  onClick={handleNewColleague}
                  className="text-[12px] text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium"
                >
                  + 新建
                </button>
              </div>
              {colleaguesLoading ? (
                <p className="text-[var(--text-muted)] text-[12px] py-4 text-center">加载中...</p>
              ) : colleagues.length === 0 ? (
                <p className="text-[var(--text-muted)] text-[12px] py-4 text-center">暂无同事</p>
              ) : (
                <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
                  {colleagues.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectColleague(c)}
                      className={[
                        "flex items-center gap-2 py-2 px-2 rounded-md text-left transition-colors w-full",
                        selectedColleagueId === c.id
                          ? "bg-[var(--accent)] text-white"
                          : "hover:bg-[var(--bg-base)] text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      <div className={[
                        "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                        selectedColleagueId === c.id ? "bg-white/20" : getAvatarClass(c.name),
                      ].join(" ")}>
                        <span className="text-white text-[11px] font-semibold">{(c.nickname || c.name).charAt(0)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium truncate">{c.nickname || c.name}</p>
                        <div className="flex items-center gap-1">
                          <span className={["w-1.5 h-1.5 rounded-full shrink-0", selectedColleagueId === c.id ? "bg-white/70" : statusDot(c.status)].join(" ")} />
                          <span className={"text-[11px] " + (selectedColleagueId === c.id ? "text-white/70" : "text-[var(--text-muted)]")}>{statusLabel(c.status)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: edit panel */}
            {selectedColleagueId ? (
              <div className={cardClass + " flex-1 flex flex-col gap-4"}>
                <p className={cardTitleClass}>{selectedColleagueId === 'new' ? '新建同事' : '编辑同事'}</p>

                {/* Nickname */}
                <div className="space-y-1">
                  <label className={labelClass}>昵称</label>
                  <Input value={editNickname} onChange={(e) => setEditNickname(e.target.value)} placeholder="留空则显示角色名" />
                </div>

                {/* Role */}
                <div className="space-y-1">
                  <label className={labelClass}>角色 <span className="text-[var(--danger)]">*</span></label>
                  <Input value={editRole} onChange={(e) => setEditRole(e.target.value)} placeholder="如：全栈工程师" />
                </div>

                {/* Model override */}
                <div className="space-y-1">
                  <label className={labelClass}>使用模型</label>
                  <Select key={selectedColleagueId} value={editModel || "__inherit__"} onValueChange={(v) => setEditModel(v === "__inherit__" ? "" : v)}>
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

                {/* System prompt */}
                <div className="space-y-1 flex flex-col flex-1">
                  <label className={labelClass}>系统提示词 <span className="text-[var(--danger)]">*</span></label>
                  <textarea
                    value={editSystemPrompt}
                    onChange={(e) => setEditSystemPrompt(e.target.value)}
                    placeholder="描述该 AI 同事的行为和能力..."
                    rows={6}
                    className="w-full rounded-md border border-[var(--border-default)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>

                {/* Capabilities */}
                <div className="space-y-1">
                  <label className={labelClass}>能力标签</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editCapabilities.map((cap) => (
                      <span key={cap} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--ai-muted)] text-[var(--ai)] text-[11.5px] font-medium">
                        {cap}
                        <button type="button" onClick={() => handleRemoveCap(cap)} className="text-[var(--ai)] hover:text-[var(--danger)] leading-none">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={capInput}
                      onChange={(e) => setCapInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCap())}
                      placeholder="添加标签，回车确认"
                      className="flex-1 text-[13px]"
                    />
                    <Button type="button" onClick={handleAddCap} disabled={!capInput.trim()} className="shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-3">
                      添加
                    </Button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-default)]">
                  <Button
                    type="button"
                    onClick={handleSaveColleague}
                    disabled={editSaving || !editRole.trim() || !editSystemPrompt.trim()}
                    className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                  >
                    {editSaving ? '保存中...' : '保存'}
                  </Button>
                  {selectedColleagueId !== 'new' && (
                    deleteConfirm ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-[var(--danger)]">确认删除？</span>
                        <button type="button" onClick={handleDeleteColleague} className="text-[12px] text-[var(--danger)] hover:underline font-medium">确认</button>
                        <button type="button" onClick={() => setDeleteConfirm(false)} className="text-[12px] text-[var(--text-muted)] hover:underline">取消</button>
                      </div>
                    ) : (
                      <button type="button" onClick={handleDeleteColleague} className="text-[12px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors">
                        删除
                      </button>
                    )
                  )}
                </div>
              </div>
            ) : (
              <div className={cardClass + " flex-1 flex items-center justify-center"}>
                <p className="text-[13px] text-[var(--text-muted)]">选择一位同事编辑，或新建同事</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
