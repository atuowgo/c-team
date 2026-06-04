import { useState, useEffect, useCallback, type FormEvent } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useToastStore } from "@/stores/toast-store"
import type { AiColleagueData } from "@/common/ipc"

type TabValue = "api" | "github" | "colleagues"

const MODELS = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "gpt-5", label: "GPT-5" },
]

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "online") return "default"
  if (status === "busy") return "secondary"
  return "outline"
}

function statusLabel(status: string): string {
  if (status === "online") return "在线"
  if (status === "busy") return "忙碌"
  return "离线"
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
    ]).catch((e) => addToast("error", `加载设置失败: ${e instanceof Error ? e.message : String(e)}`))
  }, [addToast])

  const loadColleagues = useCallback(() => {
    setColleaguesLoading(true)
    window.electron.invoke("ai:list").then((list: AiColleagueData[]) => {
      setColleagues(list)
    }).catch((e) => addToast("error", `加载AI同事列表失败: ${e instanceof Error ? e.message : String(e)}`)).finally(() => setColleaguesLoading(false))
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
    }).catch((e) => addToast("error", `保存API配置失败: ${e instanceof Error ? e.message : String(e)}`)).finally(() => setApiSaving(false))
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
      addToast("error", `保存GitHub配置失败: ${e instanceof Error ? e.message : String(e)}`)
    }).finally(() => setGhSaving(false))
  }, [ghToken, ghOwner, ghRepo, addToast])

  return (
    <div className="flex-1 p-6">
      <h1 className="text-2xl font-bold mb-1">设置</h1>
      <p className="text-muted-foreground text-sm mb-6">配置 API Key、GitHub 集成和管理 AI 同事</p>

      <Tabs value={tab} onValueChange={(v: string) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="api">API 配置</TabsTrigger>
          <TabsTrigger value="github">GitHub 集成</TabsTrigger>
          <TabsTrigger value="colleagues">AI 同事管理</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>API 配置</CardTitle>
              <CardDescription>配置 AI 模型的 API Key 和默认模型</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveApi} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key</Label>
                  <Input
                    id="api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">默认模型</Label>
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
                  <Label htmlFor="max-concurrency">AI 最大并发数</Label>
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
                  <Button type="submit" disabled={apiSaving || !apiKey}>
                    {apiSaving ? "保存中..." : "保存"}
                  </Button>
                  {apiSaved && <span className="text-sm text-green-600">已保存</span>}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="github">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>GitHub 集成</CardTitle>
              <CardDescription>连接 GitHub 仓库以启用自动化 PR 和代码审查</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveGh} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="gh-token">GitHub Token</Label>
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
                    <Label htmlFor="gh-owner">Owner</Label>
                    <Input
                      id="gh-owner"
                      value={ghOwner}
                      onChange={(e) => setGhOwner(e.target.value)}
                      placeholder="e.g. facebook"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gh-repo">Repo</Label>
                    <Input
                      id="gh-repo"
                      value={ghRepo}
                      onChange={(e) => setGhRepo(e.target.value)}
                      placeholder="e.g. react"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={ghSaving || !ghToken}>
                    {ghSaving ? "保存中..." : "保存并连接"}
                  </Button>
                  {ghSaved && <span className="text-sm text-green-600">已保存</span>}
                  {ghConnected === true && (
                    <Badge variant="default">已连接</Badge>
                  )}
                  {ghConnected === false && (
                    <Badge variant="secondary">连接失败</Badge>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="colleagues">
          <Card>
            <CardHeader>
              <CardTitle>AI 同事管理</CardTitle>
              <CardDescription>管理团队中的 AI 同事及其状态</CardDescription>
            </CardHeader>
            <CardContent>
              {colleaguesLoading ? (
                <p className="text-muted-foreground text-sm py-8 text-center">加载中...</p>
              ) : colleagues.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">暂无 AI 同事</p>
              ) : (
                <div className="space-y-1">
                  {colleagues.map((c, i) => (
                    <div key={c.id}>
                      {i > 0 && <Separator className="my-1" />}
                      <div className="flex items-center justify-between py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{c.name}</span>
                            <Badge variant={statusVariant(c.status)} className="text-[10px] px-1.5 py-0">
                              {statusLabel(c.status)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.role}</p>
                          {c.current_task && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              当前任务: {c.current_task}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}