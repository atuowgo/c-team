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
import type { ChannelData, MessageData, AiColleagueData } from "@/common/ipc"

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
      <span key={match.index} className="text-blue-400 font-medium">
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
      .invoke("channel:list")
      .then((list: ChannelData[]) => setChannels(list))
      .catch((e) => addToast("error", `加载频道失败: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLoadingChannels(false))
  }, [addToast])

  useEffect(() => {
    loadChannels()
    window.electron
      .invoke("ai:list")
      .then((list: AiColleagueData[]) => setAiColleagues(list))
      .catch((e) => addToast("error", `加载AI同事列表失败: ${e instanceof Error ? e.message : String(e)}`))
  }, [loadChannels, addToast])

  useEffect(() => {
    if (!selectedChannelId) return
    setLoadingMessages(true)
    window.electron
      .invoke("message:list", selectedChannelId)
      .then((list: MessageData[]) => {
        setMessages(list)
        // scroll to bottom after messages load
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
      })
      .catch((e) => addToast("error", `加载消息失败: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLoadingMessages(false))
  }, [selectedChannelId, addToast])

  // Auto-scroll when messages array changes (new message added)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const content = inputValue.trim()
      if (!content || !selectedChannelId) return

      // Detect @AI colleague mention
      const mentionPattern = /@(\S+)/
      const mentionMatch = content.match(mentionPattern)
      const mentionedColleague = mentionMatch
        ? aiColleagues.find((c) => content.includes(`@${c.name}`))
        : null

      window.electron
        .invoke("message:send", selectedChannelId, content, "current-user")
        .then((msg: MessageData) => {
          setMessages((prev) => [...prev, msg])
          setInputValue("")

          // Create AI task if an AI colleague was mentioned
          if (mentionedColleague) {
            window.electron
              .invoke("ai:task-create", {
                event_type: "chat_mention",
                payload: {
                  channelId: selectedChannelId,
                  message: content,
                  mentionedColleague: mentionedColleague.name,
                },
                priority: 2,
              })
              .catch((e) => addToast("error", `创建AI任务失败: ${e instanceof Error ? e.message : String(e)}`))
          }
        })
        .catch((e) => addToast("error", `发送消息失败: ${e instanceof Error ? e.message : String(e)}`))
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
      .catch((e) => addToast("error", `创建频道失败: ${e instanceof Error ? e.message : String(e)}`))
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
        .catch((e) => addToast("error", `删除频道失败: ${e instanceof Error ? e.message : String(e)}`))
    },
    [selectedChannelId, loadChannels, addToast]
  )

  const colleagueNames = aiColleagues.map((c) => c.name)

  if (loadingChannels) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground text-sm">加载频道中...</p>
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground text-sm mb-2">暂无频道</p>
          <p className="text-muted-foreground text-xs">创建一个频道开始协作</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setDialogOpen(true)}
          >
            + 新建频道
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
      <div className="w-52 border-r border-border flex flex-col bg-card">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">频道列表</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setDialogOpen(true)}
            title="新建频道"
          >
            <span className="text-xs leading-none">+</span>
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {channels.map((ch) => (
            <div key={ch.id} className="group flex items-center">
              <button
                onClick={() => selectChannel(ch.id)}
                className={cn(
                  "flex-1 text-left px-3 py-1.5 text-sm transition-colors",
                  ch.id === selectedChannelId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-foreground"
                )}
              >
                # {ch.name}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteChannel(ch.id)
                }}
                className={cn(
                  "shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs",
                  "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "mr-1"
                )}
                title="删除频道"
              >
                x
              </button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Message area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedChannel ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">选择一个频道开始聊天</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-border shrink-0">
              <span className="font-semibold text-sm"># {selectedChannel.name}</span>
            </div>

            <ScrollArea className="flex-1 px-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full pt-8">
                  <p className="text-muted-foreground text-sm">加载消息中...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full pt-8">
                  <p className="text-muted-foreground text-sm">暂无消息，发送第一条消息吧</p>
                </div>
              ) : (
                <div className="py-3 space-y-3">
                  {messages.map((msg) => (
                    <div key={msg.id} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-medium shrink-0">
                        {msg.sender_id.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{msg.sender_id}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-foreground break-words whitespace-pre-wrap">
                          {highlightMentions(msg.content, colleagueNames)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            <form onSubmit={handleSend} className="px-4 py-2 border-t border-border flex gap-2 shrink-0">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="输入消息...  使用 @AI同事名 提及AI同事"
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={!inputValue.trim()}>
                发送
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