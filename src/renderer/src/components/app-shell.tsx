import { useEffect, useState, useCallback } from "react"
import { useAppStore } from "@/stores/app-store"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AvatarGradient } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { AiColleagueData } from "@common/ipc"
import { Hash, LayoutGrid, Settings, Sun, Moon, ChevronLeft, ChevronRight } from "lucide-react"

function getStatusDot(status: string) {
  const map: Record<string, string> = {
    online: "bg-[var(--success)]",
    busy: "bg-[var(--warning)]",
    idle: "bg-[var(--text-muted)]",
    offline: "bg-transparent border-2 border-[var(--text-muted)]",
  }
  return map[status] ?? map.offline
}

function sortColleagues(list: AiColleagueData[]): AiColleagueData[] {
  const order: Record<string, number> = { online: 0, idle: 1, busy: 2, offline: 3 }
  return [...list].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
}

const NAV_ITEMS = [
  { view: "channel", icon: Hash, label: "频道" },
  { view: "board", icon: LayoutGrid, label: "看板" },
  { view: "settings", icon: Settings, label: "设置" },
] as const

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { sidebarCollapsed, rightSidebarCollapsed, toggleSidebar, toggleRightSidebar, activeView, setActiveView } =
    useAppStore()
  const { toggleTheme, resolvedTheme } = useTheme()
  const [colleagues, setColleagues] = useState<AiColleagueData[]>([])

  const fetchColleagues = useCallback(() => {
    window.electron
      .invoke<AiColleagueData[]>("ai:list")
      .then((list) => setColleagues(list))
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
          "flex flex-col border-r border-[var(--border-default)] bg-[var(--bg-surface)] transition-all duration-300",
          sidebarCollapsed ? "w-0 overflow-hidden" : "w-60"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <span className="font-semibold text-sm">C-Team</span>
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-4 mb-1">
            Navigation
          </div>
          {NAV_ITEMS.map(({ view, icon: Icon, label }) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 mx-2 rounded-md text-[13.5px] font-medium transition-colors w-full text-left",
                activeView === view
                  ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0 opacity-70" />
              {label}
            </button>
          ))}
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
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">{children}</main>

      {/* Right Sidebar - AI Colleagues */}
      <aside
        className={cn(
          "flex flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)] transition-all duration-300",
          rightSidebarCollapsed ? "w-0 overflow-hidden" : "w-60"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
          <span className="font-semibold text-sm">AI 同事</span>
          <Button variant="ghost" size="icon" onClick={toggleRightSidebar} className="h-7 w-7">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {sortedColleagues.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--text-muted)]">暂未配置可用 AI 同事</div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="py-2">
              {sortedColleagues.map((colleague) => (
                <div
                  key={colleague.id}
                  className="flex items-center gap-3 px-[12px] py-[10px] mx-2 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
                >
                  {/* Avatar with status dot */}
                  <div className="relative shrink-0">
                    <AvatarGradient name={colleague.name} className="h-8 w-8 text-sm" />
                    {colleague.status !== "offline" && (
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-surface)]",
                          getStatusDot(colleague.status)
                        )}
                      />
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                        {colleague.name}
                      </span>
                      <span className="shrink-0 text-[10px] px-1.5 rounded-full bg-[var(--ai-muted)] text-[var(--ai)]">
                        AI
                      </span>
                    </div>
                    <p className="text-[11.5px] text-[var(--text-muted)] truncate">{colleague.role}</p>
                    {colleague.current_task && (
                      <p className="text-[11px] text-[var(--text-muted)] truncate italic">
                        {colleague.current_task}
                      </p>
                    )}
                  </div>
                </div>
              ))}
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
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Theme toggle - bottom left */}
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleTheme}
        className="absolute bottom-3 left-3 text-xs"
      >
        {resolvedTheme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}