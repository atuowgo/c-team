import { useState, useEffect, useCallback, useRef, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useToastStore } from "@/stores/toast-store"
import type { ChannelData, MessageData, AiColleagueData } from "@common/ipc"
import { Hash, Plus, X, Send, MessageSquare } from "lucide-react"
import { AvatarGradient } from "@/components/ui/avatar"

function highlightMentions(content: string, colleagueNames: string[]): React.ReactNode[] {
  if (colleagueNames.length === 0) return [content]
  const escaped = colleagueNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const pattern = new RegExp(`(@(${escaped.join("|")})\\b)`, "g")
  const parts: React.ReactNode[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIdx) {
      parts.push(content.slice(lastIdx, match.index))
    }
    parts.push(
      <span key={match.index} className="text-[var(--ai)] font-medium">
        {match[1]}
      </span>
    )
    lastIdx = match.index + match[1].length
  }
  if (lastIdx < content.length) {
    parts.push(content.slice(lastIdx))
  }
  return parts
}

export function ChannelView(): React.ReactElement {
  const [channels, setChannels] = useState<ChannelData[]>([])
  const [messages, setMessages] = useState<MessageData[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [aiColleagues, setAiColleagues] = useState<AiColleagueData[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState("")
  const addToast = useToastStore((s) => s.addToast)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadChannels = useCallback(() => {
    setLoadingChannels(true)
    window.electron
      .invoke<ChannelData[]>("channel:list")
      .then((list) => setChannels(list))
      .catch((e) => addToast(`加载频道失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
      .finally(() => setLoadingChannels(false))
  }, [addToast])

  useEffect(() => {
    loadChannels()
    window.electron
      .invoke<AiColleagueData[]>("ai:list")
      .then((list) => setAiColleagues(list))
      .catch((e) => addToast(`加载AI同事列表失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
  }, [loadChannels, addToast])

  useEffect(() => {
    if (!selectedChannelId) return
    setLoadingMessages(true)
    window.electron
      .invoke<MessageData[]>("message:list", selectedChannelId)
      .then((list) => {
        setMessages(list)
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
      })
      .catch((e) => addToast(`加载消息失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
      .finally(() => setLoadingMessages(false))
  }, [selectedChannelId, addToast])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const content = inputValue.trim()
      if (!content || !selectedChannelId) return

      const mentionPattern = /@(\S+)/
      const mentionMatch = content.match(mentionPattern)
      const mentionedColleague = mentionMatch
        ? aiColleagues.find((c) => content.includes(`@${c.name}`))
        : null

      window.electron
        .invoke<MessageData>("message:send", selectedChannelId, content, "current-user")
        .then((msg) => {
          setMessages((prev) => [...prev, msg])
          setInputValue("")

          if (mentionedColleague) {
            window.electron
              .invoke("ai:task-create", {
                colleague_id: mentionedColleague.id,
                event_type: "chat_mention",
                payload: {
                  channelId: selectedChannelId,
                  message: content,
                  mentionedColleague: mentionedColleague.name,
                },
                priority: 2,
              })
              .catch((e) => addToast(`创建AI任务失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
          }
        })
        .catch((e) => addToast(`发送消息失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
    },
    [inputValue, selectedChannelId, aiColleagues, addToast]
  )

  const selectChannel = useCallback((id: string) => {
    setSelectedChannelId(id)
    setMessages([])
  }, [])

  const handleCreateChannel = useCallback(() => {
    const name = newChannelName.trim()
    if (!name) return
    window.electron
      .invoke("channel:create", name)
      .then(() => {
        setNewChannelName("")
        setDialogOpen(false)
        loadChannels()
      })
      .catch((e) => addToast(`创建频道失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
  }, [newChannelName, loadChannels, addToast])

  const handleDeleteChannel = useCallback(
    (channelId: string) => {
      window.electron
        .invoke("channel:delete", channelId)
        .then(() => {
          if (selectedChannelId === channelId) {
            setSelectedChannelId(null)
            setMessages([])
          }
          loadChannels()
        })
        .catch((e) => addToast(`删除频道失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
    },
    [selectedChannelId, loadChannels, addToast]
  )

  const colleagueNames = aiColleagues.map((c) => c.name)

  if (loadingChannels) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--text-secondary)] text-sm">加载频道中...</p>
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <MessageSquare className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
          <p className="text-[var(--text-primary)] text-sm font-medium mb-1">暂无频道</p>
          <p className="text-[var(--text-muted)] text-xs">创建一个频道开始协作</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="w-4 h-4 mr-1" />
            新建频道
          </Button>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建频道</DialogTitle>
              <DialogDescription>输入频道名称以创建新的协作频道</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 mt-2">
              <Input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="频道名称"
                onKeyDown={(e) => e.key === "Enter" && handleCreateChannel()}
              />
              <Button onClick={handleCreateChannel} disabled={!newChannelName.trim()}>
                创建
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  const selectedChannel = channels.find((c) => c.id === selectedChannelId)

  return (
    <div className="flex-1 flex">
      {/* Channel list */}
      <div className="w-[220px] border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            频道
          </span>
          <button
            onClick={() => setDialogOpen(true)}
            className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="新建频道"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <ScrollArea className="flex-1">
          {channels.map((ch) => (
            <div key={ch.id} className="group flex items-center">
              <button
                onClick={() => selectChannel(ch.id)}
                className={cn(
                  "flex-1 flex items-center gap-1.5 px-3 py-1.5 mx-2 rounded-md text-[13px] transition-colors",
                  ch.id === selectedChannelId
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                )}
              >
                <Hash className="w-[14px] h-[14px] text-[var(--text-muted)] shrink-0" />
                {ch.name}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteChannel(ch.id)
                }}
                className={cn(
                  "shrink-0 flex items-center justify-center rounded",
                  "text-[var(--text-muted)] hover:text-destructive hover:bg-destructive/10",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "mr-1"
                )}
                title="删除频道"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Message area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedChannel ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-[var(--text-muted)] text-sm">选择一个频道开始聊天</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2 shrink-0">
              <Hash className="w-5 h-5 text-[var(--text-muted)]" />
              <span className="font-semibold text-[15px] text-[var(--text-primary)]">{selectedChannel.name}</span>
            </div>

            <ScrollArea className="flex-1 px-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full pt-8">
                  <p className="text-[var(--text-secondary)] text-sm">加载消息中...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full pt-8">
                  <div className="text-center">
                    <MessageSquare className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
                    <p className="text-[var(--text-muted)] text-sm">暂无消息，发送第一条消息吧</p>
                  </div>
                </div>
              ) : (
                <div className="py-3 flex flex-col gap-2">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className="flex gap-3 px-2 py-1 -mx-2 rounded-md hover:bg-[var(--bg-hover)]/50 transition-colors group"
                    >
                      <AvatarGradient name={msg.sender_id} className="w-9 h-9 text-xs" />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13.5px] font-semibold text-[var(--text-primary)]">
                            {msg.sender_id}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-[13.5px] leading-relaxed text-[var(--text-primary)] break-words whitespace-pre-wrap">
                          {highlightMentions(msg.content, colleagueNames)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            <form onSubmit={handleSend} className="px-4 py-3 border-t border-[var(--border-subtle)] flex gap-2 shrink-0">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="输入消息...  使用 @AI同事名 提及AI同事"
                className="flex-1 bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-md focus:border-[var(--accent)]"
              />
              <Button type="submit" size="sm" disabled={!inputValue.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </>
        )}
      </div>

      {/* Create Channel Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建频道</DialogTitle>
            <DialogDescription>输入频道名称以创建新的协作频道</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Input
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="频道名称"
              onKeyDown={(e) => e.key === "Enter" && handleCreateChannel()}
            />
            <Button onClick={handleCreateChannel} disabled={!newChannelName.trim()}>
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}