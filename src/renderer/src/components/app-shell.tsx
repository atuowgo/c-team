import { useEffect, useState, useCallback } from "react"
import { useAppStore } from "@/stores/app-store"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { AiColleagueData } from "@/common/ipc"

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  online: { label: "在线", variant: "default" },
  busy: { label: "忙碌", variant: "secondary" },
  idle: { label: "空闲", variant: "outline" },
  offline: { label: "离线", variant: "outline" },
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const }
}

function sortColleagues(list: AiColleagueData[]): AiColleagueData[] {
  const order: Record<string, number> = { online: 0, idle: 1, busy: 2, offline: 3 }
  return [...list].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
}

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { sidebarCollapsed, rightSidebarCollapsed, toggleSidebar, toggleRightSidebar, activeView, setActiveView } =
    useAppStore()
  const { toggleTheme, resolvedTheme } = useTheme()
  const [colleagues, setColleagues] = useState<AiColleagueData[]>([])

  const fetchColleagues = useCallback(() => {
    window.electron
      .invoke("ai:list")
      .then((list: AiColleagueData[]) => setColleagues(list))
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetchColleagues()
    const interval = setInterval(fetchColleagues, 10_000)
    return () => clearInterval(interval)
  }, [fetchColleagues])

  useEffect(() => {
    const unsub = window.electron.on("ai:status-changed", (colleagueId: unknown, status: unknown) => {
      setColleagues((prev) =>
        prev.map((c) =>
          c.id === (colleagueId as string) ? { ...c, status: (status as string) ?? c.status } : c
        )
      )
    })
    return () => {
      unsub?.()
    }
  }, [])

  const sortedColleagues = sortColleagues(colleagues)

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Left Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border bg-muted/30 transition-all duration-300",
          sidebarCollapsed ? "w-0 overflow-hidden" : "w-60"
        )}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <span className="font-semibold text-sm">频道 / 看板</span>
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-7 w-7">
            ◀
          </Button>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-1">
          <button
            onClick={() => setActiveView("channel")}
            className={cn(
              "w-full text-left px-3 py-1.5 rounded text-sm transition-colors",
              activeView === "channel" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            )}
          >
            # 频道
          </button>
          <button
            onClick={() => setActiveView("board")}
            className={cn(
              "w-full text-left px-3 py-1.5 rounded text-sm transition-colors",
              activeView === "board" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            )}
          >
            📋 看板
          </button>
          <button
            onClick={() => setActiveView("settings")}
            className={cn(
              "w-full text-left px-3 py-1.5 rounded text-sm transition-colors",
              activeView === "settings" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            )}
          >
            ⚙ 设置
          </button>
        </nav>
      </aside>

      {/* Sidebar toggle when collapsed */}
      {sidebarCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="absolute left-2 top-3 z-10 h-7 w-7"
        >
          ▶
        </Button>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">{children}</main>

      {/* Right Sidebar - AI Colleagues */}
      <aside
        className={cn(
          "flex flex-col border-l border-border bg-muted/30 transition-all duration-300",
          rightSidebarCollapsed ? "w-0 overflow-hidden" : "w-60"
        )}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-border shrink-0">
          <span className="font-semibold text-sm">AI 同事</span>
          <Button variant="ghost" size="icon" onClick={toggleRightSidebar} className="h-7 w-7">
            ▶
          </Button>
        </div>

        {sortedColleagues.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">暂无活跃 AI 同事</div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="px-3 py-2 space-y-2">
              {sortedColleagues.map((colleague, idx) => {
                const sc = getStatusConfig(colleague.status)
                return (
                  <div key={colleague.id}>
                    {idx > 0 && <Separator className="mb-2" />}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground truncate">
                          {colleague.name}
                        </span>
                        <Badge variant={sc.variant} className="text-xs px-1.5 py-0 h-4">
                          {sc.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{colleague.role}</p>
                      {colleague.current_task && (
                        <p className="text-xs text-muted-foreground/70 truncate italic">
                          {colleague.current_task}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </aside>

      {/* Right sidebar toggle when collapsed */}
      {rightSidebarCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleRightSidebar}
          className="absolute right-2 top-3 z-10 h-7 w-7"
        >
          ◀
        </Button>
      )}

      {/* Theme toggle - bottom left */}
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleTheme}
        className="absolute bottom-3 left-3 text-xs"
      >
        {resolvedTheme === "dark" ? "☀" : "☾"}
      </Button>
    </div>
  )
}