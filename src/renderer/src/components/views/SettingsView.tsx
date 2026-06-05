import { useState, useEffect, useCallback, type FormEvent } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useToastStore } from "@/stores/toast-store"
import type { AiColleagueData } from "@common/ipc"

type TabValue = "api" | "github" | "colleagues"

const MODELS = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "gpt-5", label: "GPT-5" },
]

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
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(MODELS[0].value)
  const [maxConcurrency, setMaxConcurrency] = useState("2")
  const [apiSaved, setApiSaved] = useState(false)
  const [apiSaving, setApiSaving] = useState(false)

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

  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    Promise.all([
      window.electron.invoke("settings:get", "apiKey").then((v) => {
        if (typeof v === "string" && v) setApiKey(v)
      }),
      window.electron.invoke("settings:get", "model").then((v) => {
        if (typeof v === "string" && v) setModel(v)
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
    ]).catch((e) => addToast(`加载设置失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
  }, [addToast])

  const loadColleagues = useCallback(() => {
    setColleaguesLoading(true)
    window.electron.invoke<AiColleagueData[]>("ai:list").then((list) => {
      setColleagues(list)
    }).catch((e) => addToast(`加载AI同事列表失败: ${e instanceof Error ? e.message : String(e)}`, "error")).finally(() => setColleaguesLoading(false))
  }, [addToast])

  useEffect(() => {
    if (tab === "colleagues") loadColleagues()
  }, [tab, loadColleagues])

  const handleSaveApi = useCallback((e: FormEvent) => {
    e.preventDefault()
    setApiSaving(true)
    Promise.all([
      window.electron.invoke("settings:set", "apiKey", apiKey),
      window.electron.invoke("settings:set", "model", model),
      window.electron.invoke("settings:set", "maxConcurrency", Number(maxConcurrency)),
    ]).then(() => {
      setApiSaved(true)
      setTimeout(() => setApiSaved(false), 2000)
    }).catch((e) => addToast(`保存API配置失败: ${e instanceof Error ? e.message : String(e)}`, "error")).finally(() => setApiSaving(false))
  }, [apiKey, model, maxConcurrency, addToast])

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
            <p className={cardDescClass + " mt-1 mb-4"}>配置 AI 模型的 API Key 和默认模型</p>
            <form onSubmit={handleSaveApi} className="space-y-4">
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
              <div className="space-y-2">
                <Label htmlFor="model" className={labelClass}>默认模型</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="model">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-concurrency" className={labelClass}>AI 最大并发数</Label>
                <Select value={maxConcurrency} onValueChange={setMaxConcurrency}>
                  <SelectTrigger id="max-concurrency">
                    <SelectValue placeholder="选择并发数" />
                  </SelectTrigger>
                  <SelectContent>
                    {["1", "2", "3", "4", "5"].map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
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
          <div className={cardClass}>
            <p className={cardTitleClass}>AI 同事管理</p>
            <p className={cardDescClass + " mt-1 mb-4"}>管理团队中的 AI 同事及其状态</p>
            {colleaguesLoading ? (
              <p className="text-[var(--text-muted)] text-sm py-8 text-center">加载中...</p>
            ) : colleagues.length === 0 ? (
              <p className="text-[var(--text-muted)] text-sm py-8 text-center">暂无 AI 同事</p>
            ) : (
              <div>
                {colleagues.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-3">
                    <div className={`w-8 h-8 rounded-md ${getAvatarClass(c.name)} flex items-center justify-center shrink-0`}>
                      <span className="text-white text-xs font-semibold">{c.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[13px] text-[var(--text-primary)]">{c.name}</span>
                        <span className="text-[10px] px-1.5 rounded-full bg-[var(--ai-muted)] text-[var(--ai)] font-semibold">AI</span>
                        <span className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
                          <span className={`w-2 h-2 rounded-full ${statusDot(c.status)}`} />
                          {statusLabel(c.status)}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{c.role}</p>
                      {c.current_task && (
                        <p className="text-[11px] text-[var(--text-muted)] italic truncate mt-0.5">
                          {c.current_task}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}