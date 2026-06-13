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
import type { ChannelData, MessageData, AiColleagueData, ChannelMemberData } from "@common/ipc"
import { Hash, Plus, X, Send, MessageSquare, ChevronDown, ChevronRight, Wrench } from "lucide-react"
import { AvatarGradient } from "@/components/ui/avatar"
import mermaid from "mermaid"

// ────────────────────────────────────────────
// Mermaid 初始化（渲染器进程单次执行）
// ────────────────────────────────────────────
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose",
  fontFamily: "inherit",
})

// ────────────────────────────────────────────
// 消息内容解析工具
// ────────────────────────────────────────────

interface ParsedMessage {
  skill: string | null
  thinking: string | null
  body: string
}

function parseMessageContent(raw: string): ParsedMessage {
  let content = raw.trim()
  let skill: string | null = null
  let thinking: string | null = null

  // 提取 [SKILL: name] 前缀（行首）
  const skillMatch = content.match(/^\[SKILL:\s*([^\]]+)\]\s*\n?/i)
  if (skillMatch) {
    skill = skillMatch[1].trim()
    content = content.slice(skillMatch[0].length).trim()
  }

  // 提取 <think>...</think> 块（允许多行）
  const thinkMatch = content.match(/^<think>([\s\S]*?)<\/think>\s*\n?/i)
  if (thinkMatch) {
    thinking = thinkMatch[1].trim()
    content = content.slice(thinkMatch[0].length).trim()
  }

  return { skill, thinking, body: content }
}

// ────────────────────────────────────────────
// Mermaid 渲染组件
// ────────────────────────────────────────────

let mermaidCounter = 0

function MermaidBlock({ code }: { code: string }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    let cancelled = false
    const id = `mermaid-${++mermaidCounter}`
    setError(null)
    setRendered(false)

    mermaid.render(id, code)
      .then(({ svg }) => {
        if (cancelled || !containerRef.current) return
        containerRef.current.innerHTML = svg
        setRendered(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setRendered(true)
      })

    return () => { cancelled = true }
  }, [code])

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 my-2">
        <p className="text-xs text-destructive font-mono mb-1">图表渲染失败</p>
        <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap break-all">{code}</pre>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "my-2 rounded-md border border-[var(--border-subtle)] bg-white dark:bg-white/5 p-3 overflow-x-auto transition-opacity",
        rendered ? "opacity-100" : "opacity-0"
      )}
    >
      <div ref={containerRef} />
    </div>
  )
}

// ────────────────────────────────────────────
// 消息正文渲染（普通文本 + Mermaid 块混排）
// ────────────────────────────────────────────

interface BodySegment {
  type: "text" | "mermaid"
  content: string
}

function splitBodySegments(body: string): BodySegment[] {
  const segments: BodySegment[] = []
  const mermaidRe = /```mermaid\n([\s\S]*?)```/g
  let lastIdx = 0
  let match: RegExpExecArray | null

  while ((match = mermaidRe.exec(body)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: "text", content: body.slice(lastIdx, match.index) })
    }
    segments.push({ type: "mermaid", content: match[1].trim() })
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < body.length) {
    segments.push({ type: "text", content: body.slice(lastIdx) })
  }
  return segments
}

function MessageBody({
  body,
  colleagueNames,
}: {
  body: string
  colleagueNames: string[]
}): React.ReactElement {
  const segments = splitBodySegments(body)

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "mermaid") {
          return <MermaidBlock key={i} code={seg.content} />
        }
        return (
          <p
            key={i}
            className="text-[13.5px] leading-relaxed text-[var(--text-primary)] break-words whitespace-pre-wrap"
          >
            {highlightMentions(seg.content, colleagueNames)}
          </p>
        )
      })}
    </>
  )
}

// ────────────────────────────────────────────
// 思考过程折叠组件
// ────────────────────────────────────────────

function ThinkingBlock({ thinking }: { thinking: string }): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="font-medium">思考过程</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--border-subtle)]">
          <p className="text-[12px] leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap">
            {thinking}
          </p>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────
// 技能标签徽章
// ────────────────────────────────────────────

function SkillBadge({ skill }: { skill: string }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--ai)]/10 text-[var(--ai)] border border-[var(--ai)]/20 mb-1.5">
      <Wrench className="w-3 h-3" />
      {skill}
    </span>
  )
}

// ────────────────────────────────────────────
// @提及高亮
// ────────────────────────────────────────────

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

// ────────────────────────────────────────────
// System manager mock
// ────────────────────────────────────────────

const SYSTEM_MANAGER_MENTION: AiColleagueData = {
  id: "system-manager",
  name: "频道管理员",
  nickname: "频道管理员",
  role: "频道管理员",
  system_prompt: "",
  capabilities: "[]",
  status: "idle",
  current_task: null,
  model: null,
  type: "manager",
  created_at: "",
  role_id: null,
  personal_notes: null,
}

// ────────────────────────────────────────────
// 主组件
// ────────────────────────────────────────────

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
  const [hasSystemManager, setHasSystemManager] = useState(false)
  const [typingColleagues, setTypingColleagues] = useState<Map<string, string>>(new Map())
  const [replyToId, setReplyToId] = useState<string | null>(null)
  const [replyToContent, setReplyToContent] = useState<string>("")
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

  useEffect(() => {
    if (!selectedChannelId) { setHasSystemManager(false); return }
    window.electron.invoke<ChannelMemberData[]>("channel:members-list", selectedChannelId)
      .then((members) => setHasSystemManager(members.some((m) => m.colleague_id === "system-manager")))
      .catch(() => { setHasSystemManager(false) })
  }, [selectedChannelId])

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

  const mentionCandidates = hasSystemManager ? [SYSTEM_MANAGER_MENTION, ...aiColleagues] : aiColleagues
  const mentionOptions =
    mentionQuery === null
      ? []
      : mentionCandidates.filter((colleague) => {
          const query = mentionQuery.trim().toLowerCase()
          if (!query) return true
          return [colleague.name, colleague.nickname, colleague.role]
            .filter((v): v is string => Boolean(v))
            .some((v) => v.toLowerCase().includes(query))
        })
  const visibleMentionOptions = mentionOptions.slice(0, 6)

  const selectMention = useCallback(
    (colleague: AiColleagueData) => {
      const mentionName = getColleagueMentionName(colleague)
      setInputValue((current) => {
        const next = current.replace(/(^|\s)@([^\s@]*)$/, `$1@${mentionName} `)
        setTimeout(() => inputRef.current?.focus(), 0)
        return next
      })
      setMentionQuery(null)
      setSelectedMentionIndex(0)
    },
    [getColleagueMentionName]
  )

  const findMentionedColleague = useCallback(
    (content: string) => {
      const candidates = hasSystemManager ? [SYSTEM_MANAGER_MENTION, ...aiColleagues] : aiColleagues
      return (
        candidates.find((colleague) => {
          const names = [colleague.name, colleague.nickname].filter((v): v is string => Boolean(v))
          return names.some((name) => content.includes(`@${name}`))
        }) ?? null
      )
    },
    [aiColleagues, hasSystemManager]
  )

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
              .catch((e) =>
                addToast(`创建AI任务失败: ${e instanceof Error ? e.message : String(e)}`, "error")
              )
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
              .catch((e) =>
                addToast(`创建AI任务失败: ${e instanceof Error ? e.message : String(e)}`, "error")
              )
          }
        })
        .catch((e) =>
          addToast(`发送消息失败: ${e instanceof Error ? e.message : String(e)}`, "error")
        )
    },
    [
      inputValue,
      selectedChannelId,
      aiColleagues.length,
      findMentionedColleague,
      getColleagueMentionName,
      addToast,
      replyToId,
    ]
  )

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value)
      updateMentionQuery(value)
    },
    [updateMentionQuery]
  )

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (mentionQuery === null || visibleMentionOptions.length === 0) {
        if (e.key === "Escape") setMentionQuery(null)
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedMentionIndex((idx) => (idx + 1) % visibleMentionOptions.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedMentionIndex(
          (idx) => (idx - 1 + visibleMentionOptions.length) % visibleMentionOptions.length
        )
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        selectMention(visibleMentionOptions[selectedMentionIndex] ?? visibleMentionOptions[0])
      } else if (e.key === "Escape") {
        e.preventDefault()
        setMentionQuery(null)
      }
    },
    [mentionQuery, visibleMentionOptions, selectedMentionIndex, selectMention]
  )

  const selectChannel = useCallback(
    (id: string) => {
      setSelectedChannelId(id)
      setStoreChannelId(id)
      setMessages([])
      setReplyToId(null)
      setReplyToContent("")
    },
    [setStoreChannelId]
  )

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
    [selectedChannelId, loadChannels, addToast, setStoreChannelId]
  )

  const colleagueNames = [
    ...(hasSystemManager ? ["频道管理员"] : []),
    ...aiColleagues.flatMap((c) => [c.name, c.nickname].filter((v): v is string => Boolean(v))),
  ]

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
              <span className="font-semibold text-[15px] text-[var(--text-primary)]">
                {selectedChannel.name}
              </span>
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
                  {messages.map((msg) => {
                    const parsed = parseMessageContent(msg.content)
                    const isAI = msg.sender_id !== "current-user" && msg.sender_id !== "human"

                    return (
                      <div
                        key={msg.id}
                        className="flex gap-3 px-2 py-1 -mx-2 rounded-md hover:bg-[var(--bg-hover)]/50 transition-colors group"
                        onMouseEnter={() => setHoveredMessageId(msg.id)}
                        onMouseLeave={() => setHoveredMessageId(null)}
                      >
                        <AvatarGradient name={msg.sender_id} className="w-9 h-9 text-xs" />
                        <div className="min-w-0 flex-1">
                          {/* 消息头：发件人 + 时间 + 回复按钮 */}
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-[13.5px] font-semibold text-[var(--text-primary)]">
                              {msg.sender_id}
                            </span>
                            <span className="text-[11px] text-[var(--text-muted)]">
                              {new Date(msg.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
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

                          {/* 引用回复 */}
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

                          {/* AI 消息：技能标签 + 思考过程 + 正文 */}
                          {isAI ? (
                            <>
                              {parsed.skill && <SkillBadge skill={parsed.skill} />}
                              {parsed.thinking && <ThinkingBlock thinking={parsed.thinking} />}
                              <MessageBody body={parsed.body} colleagueNames={colleagueNames} />
                            </>
                          ) : (
                            /* 用户消息：直接渲染原始内容 */
                            <p className="text-[13.5px] leading-relaxed text-[var(--text-primary)] break-words whitespace-pre-wrap">
                              {highlightMentions(msg.content, colleagueNames)}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* 输入中提示 */}
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

            {/* 输入区 */}
            <form
              onSubmit={handleSend}
              className="px-4 py-3 border-t border-[var(--border-subtle)] flex flex-col gap-2 shrink-0"
            >
              {/* 引用回复卡片 */}
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
                    回复: {replyToContent}
                    {replyToContent.length >= 60 ? "..." : ""}
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

      {/* 新建频道对话框 */}
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
