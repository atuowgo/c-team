import { useEffect, useState, useCallback } from "react"
import { useAppStore } from "@/stores/app-store"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AvatarGradient } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { AiColleagueData, ChannelMemberData } from "@common/ipc"
import { Hash, LayoutGrid, Users, Settings, Sun, Moon, ChevronLeft, ChevronRight, UserPlus, Puzzle } from "lucide-react"

function getStatusDot(status: string) {
  const map: Record<string, string> = {
    online: "bg-[var(--success)]",
    busy: "bg-[var(--warning)]",
    idle: "bg-[var(--text-muted)]",
    offline: "bg-transparent border-2 border-[var(--text-muted)]",
  }
  return map[status] ?? map.offline
}

const NAV_ITEMS = [
  { view: "channel", icon: Hash, label: "频道" },
  { view: "board", icon: LayoutGrid, label: "看板" },
  { view: "employees", icon: Users, label: "员工管理" },
  { view: "skills", icon: Puzzle, label: "技能管理" },
  { view: "settings", icon: Settings, label: "设置" },
] as const

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const {
    sidebarCollapsed, rightSidebarCollapsed,
    toggleSidebar, toggleRightSidebar,
    activeView, setActiveView,
    selectedChannelId,
  } = useAppStore()
  const { toggleTheme, resolvedTheme } = useTheme()

  // Channel members for right sidebar
  const [members, setMembers] = useState<ChannelMemberData[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  // All colleagues — for invite dropdown
  const [allColleagues, setAllColleagues] = useState<AiColleagueData[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [inviteId, setInviteId] = useState("")
  const [inviting, setInviting] = useState(false)

  const fetchMembers = useCallback((channelId: string) => {
    setMembersLoading(true)
    window.electron.invoke<ChannelMemberData[]>("channel:members-list", channelId)
      .then((list) => setMembers(list))
      .catch(console.error)
      .finally(() => setMembersLoading(false))
  }, [])

  useEffect(() => {
    if (selectedChannelId) {
      fetchMembers(selectedChannelId)
    } else {
      setMembers([])
    }
  }, [selectedChannelId, fetchMembers])

  // Refresh members when status changes
  useEffect(() => {
    const unsub = window.electron.on("ai:status-changed", () => {
      if (selectedChannelId) fetchMembers(selectedChannelId)
    })
    return () => { unsub?.() }
  }, [selectedChannelId, fetchMembers])

  // Load all colleagues for invite dropdown
  useEffect(() => {
    if (showInvite) {
      window.electron.invoke<AiColleagueData[]>("ai:list")
        .then((list) => setAllColleagues(list.filter((c) => c.type !== "manager")))
        .catch(console.error)
    }
  }, [showInvite])

  const handleInvite = useCallback(async () => {
    if (!inviteId || !selectedChannelId) return
    setInviting(true)
    try {
      await window.electron.invoke("channel:members-add", selectedChannelId, inviteId)
      fetchMembers(selectedChannelId)
      setShowInvite(false)
      setInviteId("")
    } catch (e) {
      console.error("Invite failed:", e)
    } finally {
      setInviting(false)
    }
  }, [inviteId, selectedChannelId, fetchMembers])

  const handleRemoveMember = useCallback(async (colleagueId: string) => {
    if (!selectedChannelId) return
    try {
      await window.electron.invoke("channel:members-remove", selectedChannelId, colleagueId)
      fetchMembers(selectedChannelId)
    } catch (e) {
      console.error("Remove member failed:", e)
    }
  }, [selectedChannelId, fetchMembers])

  // Non-member colleagues available to invite
  const memberIds = new Set(members.map((m) => m.colleague_id))
  const invitableColleagues = allColleagues.filter((c) => !memberIds.has(c.id))

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

      {/* Right Sidebar - Channel Members */}
      <aside
        className={cn(
          "flex flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)] transition-all duration-300",
          rightSidebarCollapsed ? "w-0 overflow-hidden" : "w-60"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
          <span className="font-semibold text-sm">频道成员</span>
          <div className="flex items-center gap-1">
            {selectedChannelId && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowInvite((v) => !v)}
                title="邀请成员"
                className="h-7 w-7"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={toggleRightSidebar} className="h-7 w-7">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Invite panel */}
        {showInvite && selectedChannelId && (
          <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
            <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">邀请成员加入频道</p>
            {invitableColleagues.length === 0 ? (
              <p className="text-[11px] text-[var(--text-muted)]">暂无可邀请的员工</p>
            ) : (
              <div className="flex gap-1.5">
                <select
                  value={inviteId}
                  onChange={(e) => setInviteId(e.target.value)}
                  className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-primary)] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                >
                  <option value="">选择员工</option>
                  {invitableColleagues.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nickname || c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleInvite}
                  disabled={!inviteId || inviting}
                  className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-md bg-[var(--accent)] text-white disabled:opacity-50"
                >
                  {inviting ? "..." : "邀请"}
                </button>
              </div>
            )}
          </div>
        )}

        {!selectedChannelId ? (
          <div className="px-3 py-3 text-xs text-[var(--text-muted)]">请先选择一个频道</div>
        ) : membersLoading ? (
          <div className="px-3 py-3 text-xs text-[var(--text-muted)]">加载中...</div>
        ) : members.length === 0 ? (
          <div className="px-3 py-3 text-xs text-[var(--text-muted)]">暂无成员</div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="py-2">
              {/* system-manager pinned at top */}
              {members.filter((m) => m.colleague_id === "system-manager").map((m) => (
                <div
                  key={m.colleague_id}
                  className="flex items-center gap-3 px-[12px] py-[10px] mx-2 rounded-md hover:bg-[var(--bg-hover)] transition-colors group"
                >
                  <div className="relative shrink-0">
                    <div className="h-8 w-8 rounded-full bg-[var(--accent-muted)] flex items-center justify-center text-base">
                      👑
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate block">
                      {m.name || "频道管理员"}
                    </span>
                    <p className="text-[11.5px] text-[var(--text-muted)]">系统角色</p>
                  </div>
                </div>
              ))}
              {/* Regular members */}
              {members.filter((m) => m.colleague_id !== "system-manager").map((m) => (
                <div
                  key={m.colleague_id}
                  className="flex items-center gap-3 px-[12px] py-[10px] mx-2 rounded-md hover:bg-[var(--bg-hover)] transition-colors group"
                >
                  <div className="relative shrink-0">
                    <AvatarGradient name={m.name || m.colleague_id} className="h-8 w-8 text-sm" />
                    {m.status && m.status !== "offline" && (
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-surface)]",
                          getStatusDot(m.status)
                        )}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                        {m.nickname || m.name}
                      </span>
                      <span className="shrink-0 text-[10px] px-1.5 rounded-full bg-[var(--ai-muted)] text-[var(--ai)]">
                        AI
                      </span>
                    </div>
                    {m.role_name && (
                      <p className="text-[11.5px] text-[var(--text-muted)] truncate">{m.role_name}</p>
                    )}
                  </div>
                  {/* Remove button — hover only */}
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(m.colleague_id)}
                    title="移出频道"
                    className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-opacity text-[13px] leading-none"
                  >
                    ×
                  </button>
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
