import { useState, useEffect, useCallback, useRef, type FormEvent, type KeyboardEvent } from "react"
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
import { useAppStore } from "@/stores/app-store"
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState("")
  // Feature 1: Typing indicator
  const [typingColleagues, setTypingColleagues] = useState<Map<string, string>>(new Map())
  // Feature 2: Reply-To / Quote Reply
  const [replyToId, setReplyToId] = useState<string | null>(null)
  const [replyToContent, setReplyToContent] = useState<string>("")
  // Hover state for message reply buttons
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const addToast = useToastStore((s) => s.addToast)
  const setStoreChannelId = useAppStore((s) => s.setSelectedChannelId)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
    const unsub = window.electron.on("ai:status-changed", (colleagueId: unknown, status: unknown) => {
      setAiColleagues((prev) =>
        prev.map((c) => (c.id === (colleagueId as string) ? { ...c, status: (status as string) ?? c.status } : c))
      )
    })
    return () => { unsub?.() }
  }, [])

  const loadMessages = useCallback((channelId: string) => {
    setLoadingMessages(true)
    window.electron
      .invoke<MessageData[]>("message:list", channelId)
      .then((list) => {
        setMessages(list)
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
      })
      .catch((e) => addToast(`加载消息失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
      .finally(() => setLoadingMessages(false))
  }, [addToast])

  useEffect(() => {
    if (!selectedChannelId) return
    loadMessages(selectedChannelId)
  }, [selectedChannelId, loadMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    const unsubscribe = window.electron.on("ai:task-completed", () => {
      if (selectedChannelId) loadMessages(selectedChannelId)
    })
    return unsubscribe
  }, [selectedChannelId, loadMessages])

  // Feature 1: Subscribe to typing indicators and new messages
  useEffect(() => {
    const unsubTypingStart = window.electron.on("ai:typing-start", (colleagueId: unknown, displayName: unknown) => {
      setTypingColleagues((prev) => new Map(prev).set(colleagueId as string, displayName as string))
    })
    const unsubTypingStop = window.electron.on("ai:typing-stop", (colleagueId: unknown) => {
      setTypingColleagues((prev) => {
        const next = new Map(prev)
        next.delete(colleagueId as string)
        return next
      })
    })
    const unsubMessageNew = window.electron.on("message:new", (msg: unknown) => {
      const message = msg as MessageData
      setMessages((prev) => (prev.find((m) => m.id === message.id) ? prev : [...prev, message]))
    })
    return () => {
      unsubTypingStart()
      unsubTypingStop()
      unsubMessageNew()
    }
  }, [])

  const updateMentionQuery = useCallback((value: string) => {
    const match = value.match(/(?:^|\s)@([^\s@]*)$/)
    setMentionQuery(match ? match[1] : null)
    setSelectedMentionIndex(0)
  }, [])

  const getColleagueMentionName = useCallback((colleague: AiColleagueData) => {
    return colleague.nickname || colleague.name
  }, [])

  const mentionOptions = mentionQuery === null
    ? []
    : aiColleagues.filter((colleague) => {
        const query = mentionQuery.trim().toLowerCase()
        if (!query) return true
        return [colleague.name, colleague.nickname, colleague.role]
          .filter((v): v is string => Boolean(v))
          .some((v) => v.toLowerCase().includes(query))
      })
  const visibleMentionOptions = mentionOptions.slice(0, 6)

  const selectMention = useCallback((colleague: AiColleagueData) => {
    const mentionName = getColleagueMentionName(colleague)
    setInputValue((current) => {
      const next = current.replace(/(^|\s)@([^\s@]*)$/, `$1@${mentionName} `)
      setTimeout(() => inputRef.current?.focus(), 0)
      return next
    })
    setMentionQuery(null)
    setSelectedMentionIndex(0)
  }, [getColleagueMentionName])

  const findMentionedColleague = useCallback((content: string) => {
    return aiColleagues.find((colleague) => {
      const names = [colleague.name, colleague.nickname].filter((v): v is string => Boolean(v))
      return names.some((name) => content.includes(`@${name}`))
    }) ?? null
  }, [aiColleagues])

  const handleSend = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const content = inputValue.trim()
      if (!content || !selectedChannelId) return

      const mentionedColleague = findMentionedColleague(content)
      const currentReplyToId = replyToId

      window.electron
        .invoke<MessageData>("message:send", selectedChannelId, content, "current-user", currentReplyToId)
        .then((msg) => {
          setMessages((prev) => [...prev, msg])
          setInputValue("")
          setMentionQuery(null)
          // Feature 2: clear reply state after send
          setReplyToId(null)
          setReplyToContent("")

          if (mentionedColleague) {
            window.electron
              .invoke("ai:task-create", {
                colleague_id: mentionedColleague.id,
                event_type: "chat_mention",
                payload: {
                  channelId: selectedChannelId,
                  message: content,
                  mentionedColleague: getColleagueMentionName(mentionedColleague),
                },
                priority: 2,
              })
              .catch((e) => addToast(`创建AI任务失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
          } else if (aiColleagues.length > 0) {
            window.electron
              .invoke("ai:task-create", {
                event_type: "chat_message",
                payload: {
                  channelId: selectedChannelId,
                  message: content,
                },
                priority: 3,
              })
              .catch((e) => addToast(`创建AI任务失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
          }
        })
        .catch((e) => addToast(`发送消息失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
    },
    [inputValue, selectedChannelId, aiColleagues.length, findMentionedColleague, getColleagueMentionName, addToast, replyToId]
  )

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)
    updateMentionQuery(value)
  }, [updateMentionQuery])

  const handleInputKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery === null || visibleMentionOptions.length === 0) {
      if (e.key === "Escape") setMentionQuery(null)
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedMentionIndex((idx) => (idx + 1) % visibleMentionOptions.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedMentionIndex((idx) => (idx - 1 + visibleMentionOptions.length) % visibleMentionOptions.length)
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      selectMention(visibleMentionOptions[selectedMentionIndex] ?? visibleMentionOptions[0])
    } else if (e.key === "Escape") {
      e.preventDefault()
      setMentionQuery(null)
    }
  }, [mentionQuery, visibleMentionOptions, selectedMentionIndex, selectMention])

  const selectChannel = useCallback((id: string) => {
    setSelectedChannelId(id)
    setStoreChannelId(id)
    setMessages([])
    // Reset reply state when switching channels
    setReplyToId(null)
    setReplyToContent("")
  }, [setStoreChannelId])

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
            setStoreChannelId(null)
            setMessages([])
          }
          loadChannels()
        })
        .catch((e) => addToast(`删除频道失败: ${e instanceof Error ? e.message : String(e)}`, "error"))
    },
    [selectedChannelId, loadChannels, addToast]
  )

  const colleagueNames = aiColleagues.flatMap((c) => [c.name, c.nickname].filter((v): v is string => Boolean(v)))

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
    <div className="flex-1 flex min-h-0">
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
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
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

            <ScrollArea className="flex-1 min-h-0 px-4">
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
                      onMouseEnter={() => setHoveredMessageId(msg.id)}
                      onMouseLeave={() => setHoveredMessageId(null)}
                    >
                      <AvatarGradient name={msg.sender_id} className="w-9 h-9 text-xs" />
                      <div className="min-w-0 flex-1">
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
                          {/* Feature 2: Reply button on hover */}
                          {hoveredMessageId === msg.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setReplyToId(msg.id)
                                setReplyToContent(msg.content.slice(0, 60))
                                inputRef.current?.focus()
                              }}
                              className="ml-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)]"
                            >
                              回复
                            </button>
                          )}
                        </div>
                        {/* Feature 2: Show quote reference if this message is a reply */}
                        {msg.reply_to_id && (
                          <div
                            style={{
                              borderLeft: "2px solid var(--accent)",
                              paddingLeft: "8px",
                              fontSize: "12px",
                              color: "var(--text-muted)",
                              marginBottom: "4px",
                            }}
                          >
                            回复了一条消息
                          </div>
                        )}
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

            {/* Feature 1: Typing indicators */}
            {typingColleagues.size > 0 && (
              <div className="px-4">
                {Array.from(typingColleagues.entries()).map(([id, name]) => (
                  <div key={id} className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
                    <span className="font-medium">{name}</span>
                    <span className="animate-pulse">•••</span>
                    <span>正在输入...</span>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSend} className="px-4 py-3 border-t border-[var(--border-subtle)] flex flex-col gap-2 shrink-0">
              {/* Feature 2: Quote reply card */}
              {replyToId && (
                <div
                  style={{
                    borderLeft: "3px solid var(--accent)",
                    background: "var(--bg-elevated)",
                    padding: "6px 12px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    回复: {replyToContent}{replyToContent.length >= 60 ? "..." : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyToId(null)
                      setReplyToContent("")
                    }}
                    className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    title="取消回复"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="relative flex-1 flex gap-2">
                {mentionQuery !== null && mentionOptions.length > 0 && (
                  <div className="absolute left-0 right-0 bottom-[calc(100%+8px)] z-20 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-lg overflow-hidden">
                    {visibleMentionOptions.map((colleague, idx) => (
                      <button
                        key={colleague.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectMention(colleague)
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                          idx === selectedMentionIndex
                            ? "bg-[var(--bg-hover)]"
                            : "hover:bg-[var(--bg-hover)]"
                        )}
                      >
                        <AvatarGradient name={colleague.name} className="w-7 h-7 text-[11px]" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                            @{getColleagueMentionName(colleague)}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">{colleague.role}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="输入消息...  @ 指定同事，直接发送会由空闲 AI 回复"
                  className="w-full bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-md focus:border-[var(--accent)]"
                />
                <Button type="submit" size="sm" disabled={!inputValue.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
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
