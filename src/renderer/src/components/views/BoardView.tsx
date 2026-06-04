import { useState, useEffect, useCallback, useRef } from "react"
import {
  BoardData,
  ColumnData,
  TicketData,
  TicketResult,
  AiColleagueData,
} from "@common/ipc"
import { cn } from "@/lib/utils"
import { useToastStore } from "@/stores/toast-store"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { PlanReviewDialog } from "@/components/PlanReviewDialog"

const priorityLabel: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
}

const priorityClass: Record<string, string> = {
  low: "bg-secondary text-secondary-foreground",
  medium: "bg-blue-500 text-white",
  high: "bg-orange-500 text-white",
  urgent: "bg-destructive text-destructive-foreground",
}

const DEFAULT_COLUMNS = ["待办", "进行中", "已完成"]

export function BoardView() {
  const addToast = useToastStore((s) => s.addToast)

  // --- boards ---
  const [boards, setBoards] = useState<BoardData[]>([])
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)

  // --- columns & tickets ---
  const [columns, setColumns] = useState<ColumnData[]>([])
  const [tickets, setTickets] = useState<TicketResult[]>([])
  const [aiColleagues, setAiColleagues] = useState<AiColleagueData[]>([])
  const [loading, setLoading] = useState(false)

  // --- create board dialog ---
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const [createBoardName, setCreateBoardName] = useState("")
  const [createBoardColumnChecks, setCreateBoardColumnChecks] = useState(
    DEFAULT_COLUMNS.map((name) => ({ name, checked: true }))
  )
  const [createBoardCustomColumn, setCreateBoardCustomColumn] = useState("")

  // --- ticket create/edit dialog ---
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false)
  const [editingTicket, setEditingTicket] = useState<TicketResult | null>(null)
  const [formTitle, setFormTitle] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formPriority, setFormPriority] = useState<string>("medium")
  const [formAssignee, setFormAssignee] = useState("")

  // --- column editing ---
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnName, setEditingColumnName] = useState("")

  // --- new column ---
  const [newColumnName, setNewColumnName] = useState("")
  const [addingColumn, setAddingColumn] = useState(false)

  // --- drag state ---
  const dragTicketId = useRef<string | null>(null)

  // --- plan review state ---
  const [planTickets, setPlanTickets] = useState<Set<string>>(new Set())

  // ============================================================
  // data fetching
  // ============================================================
  const fetchBoards = useCallback(async () => {
    try {
      const list: BoardData[] = await window.electron.invoke("board:list")
      setBoards(list)
    } catch (e) {
      addToast(`加载看板失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }, [addToast])

  const fetchBoardData = useCallback(async (boardId: string) => {
    setLoading(true)
    try {
      const [cols, tix, ais] = await Promise.all([
        window.electron.invoke<ColumnData[]>("column:list", boardId),
        window.electron.invoke<TicketResult[]>("ticket:list", boardId),
        window.electron.invoke<AiColleagueData[]>("ai:list"),
      ])
      setColumns(cols)
      setTickets(tix)
      setAiColleagues(ais)
    } catch (e) {
      addToast(`加载看板数据失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  useEffect(() => {
    if (selectedBoardId) {
      fetchBoardData(selectedBoardId)
    } else {
      setColumns([])
      setTickets([])
    }
  }, [selectedBoardId, fetchBoardData])

  const refreshBoardData = useCallback(() => {
    if (selectedBoardId) fetchBoardData(selectedBoardId)
  }, [selectedBoardId, fetchBoardData])

  // Listen for plan events
  useEffect(() => {
    const unsub1 = window.electron.on("ai:plan-submitted", (...args: unknown[]) => {
      const ticketId = args[2] as string
      setPlanTickets((prev) => new Set(prev).add(ticketId))
    })
    const unsub2 = window.electron.on("ai:plan-approved", () => {
      refreshBoardData()
    })
    const unsub3 = window.electron.on("ai:plan-rejected", () => {
      refreshBoardData()
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [refreshBoardData])

  // ============================================================
  // board CRUD
  // ============================================================
  const handleCreateBoard = async () => {
    if (!createBoardName.trim()) return
    const checkedNames = createBoardColumnChecks
      .filter((c) => c.checked)
      .map((c) => c.name)
    if (checkedNames.length === 0) return
    try {
      await window.electron.invoke(
        "board:create-with-columns",
        createBoardName.trim(),
        checkedNames
      )
      setCreateBoardOpen(false)
      setCreateBoardName("")
      setCreateBoardColumnChecks(DEFAULT_COLUMNS.map((name) => ({ name, checked: true })))
      setCreateBoardCustomColumn("")
      await fetchBoards()
    } catch (e) {
      addToast(`创建看板失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleDeleteBoard = async (boardId: string) => {
    try {
      await window.electron.invoke("board:delete", boardId)
      if (selectedBoardId === boardId) setSelectedBoardId(null)
      await fetchBoards()
    } catch (e) {
      addToast(`删除看板失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleAddCustomColumnToForm = () => {
    const name = createBoardCustomColumn.trim()
    if (!name) return
    if (createBoardColumnChecks.some((c) => c.name === name)) return
    setCreateBoardColumnChecks((prev) => [...prev, { name, checked: true }])
    setCreateBoardCustomColumn("")
  }

  // ============================================================
  // column CRUD
  // ============================================================
  const handleAddColumn = async () => {
    if (!selectedBoardId || !newColumnName.trim()) return
    try {
      const position = columns.length
      await window.electron.invoke(
        "column:create",
        selectedBoardId,
        newColumnName.trim(),
        position
      )
      setNewColumnName("")
      setAddingColumn(false)
      refreshBoardData()
    } catch (e) {
      addToast(`添加列失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleDeleteColumn = async (columnId: string) => {
    try {
      await window.electron.invoke("column:delete", columnId)
      refreshBoardData()
    } catch (e) {
      addToast(`删除列失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleStartEditColumn = (column: ColumnData) => {
    setEditingColumnId(column.id)
    setEditingColumnName(column.name)
  }

  const handleSaveEditColumn = async (columnId: string) => {
    if (!editingColumnName.trim()) return
    try {
      await window.electron.invoke("column:update", columnId, {
        name: editingColumnName.trim(),
      })
      setEditingColumnId(null)
      setEditingColumnName("")
      refreshBoardData()
    } catch (e) {
      addToast(`更新列名失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  // ============================================================
  // ticket CRUD
  // ============================================================
  const resetTicketForm = () => {
    setFormTitle("")
    setFormDescription("")
    setFormPriority("medium")
    setFormAssignee("")
    setEditingTicket(null)
  }

  const openCreateTicket = () => {
    resetTicketForm()
    setTicketDialogOpen(true)
  }

  const openEditTicket = (ticket: TicketResult) => {
    setEditingTicket(ticket)
    setFormTitle(ticket.title)
    setFormDescription(ticket.description || "")
    setFormPriority(ticket.priority || "medium")
    setFormAssignee(ticket.assignee || "")
    setTicketDialogOpen(true)
  }

  const handleTicketSubmit = async () => {
    if (!formTitle.trim()) return
    if (!selectedBoardId) return

    try {
      const firstColumnId = columns.length > 0 ? columns[0].id : undefined

      if (editingTicket) {
        await window.electron.invoke("ticket:update", editingTicket.id, {
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          priority: formPriority as TicketData["priority"],
          assignee: formAssignee || undefined,
        })
      } else {
        await window.electron.invoke("ticket:create", {
          boardId: selectedBoardId,
          columnId: firstColumnId,
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          priority: formPriority as TicketData["priority"],
          assignee: formAssignee || undefined,
        })
      }

      setTicketDialogOpen(false)
      resetTicketForm()
      refreshBoardData()
    } catch (e) {
      addToast(`保存工单失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleDeleteTicket = async (id: string) => {
    try {
      await window.electron.invoke("ticket:delete", id)
      refreshBoardData()
    } catch (e) {
      addToast(`删除工单失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleAssignToAI = async (ticketId: string, colleagueId: string) => {
    if (!colleagueId) return
    try {
      await window.electron.invoke("ticket:assign", ticketId, colleagueId)
      addToast("工单已派发给 AI 同事", "success")
      refreshBoardData()
    } catch (e) {
      addToast(`派发失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  // ============================================================
  // drag and drop
  // ============================================================
  const handleDragStart = (ticketId: string) => {
    dragTicketId.current = ticketId
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (columnId: string) => {
    const ticketId = dragTicketId.current
    if (!ticketId) return
    dragTicketId.current = null
    try {
      await window.electron.invoke("ticket:update", ticketId, {
        columnId,
      })
      refreshBoardData()
    } catch (e) {
      addToast(`移动工单失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  // ============================================================
  // derived
  // ============================================================
  const selectedBoard = boards.find((b) => b.id === selectedBoardId)

  // group tickets by column; unassigned (null) go to first column
  const ticketsByColumn = (() => {
    const map: Record<string, TicketResult[]> = {}
    for (const col of columns) {
      map[col.id] = []
    }
    for (const t of tickets) {
      if (t.column_id && map[t.column_id]) {
        map[t.column_id].push(t)
      } else if (columns.length > 0) {
        map[columns[0].id].push(t)
      }
    }
    return map
  })()

  // ============================================================
  // render helpers
  // ============================================================
  const renderTicketCard = (ticket: TicketResult) => {
    let labels: string[] = []
    try {
      labels = JSON.parse(ticket.labels || "[]")
    } catch {
      /* ignore */
    }

    return (
      <Card
        key={ticket.id}
        className="cursor-pointer hover:shadow-md transition-shadow"
        draggable
        onDragStart={() => handleDragStart(ticket.id)}
        onClick={() => openEditTicket(ticket)}
      >
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm leading-snug">{ticket.title}</CardTitle>
          {ticket.description && (
            <CardDescription className="text-xs line-clamp-2 mt-0.5">
              {ticket.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-3 pt-1 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              className={cn(
                "text-xs px-1.5 py-0",
                priorityClass[ticket.priority] || priorityClass.medium
              )}
            >
              {priorityLabel[ticket.priority] || ticket.priority}
            </Badge>
            {labels.map((label, i) => (
              <Badge key={i} variant="outline" className="text-xs px-1.5 py-0">
                {label}
              </Badge>
            ))}
          </div>
          {ticket.assignee && (
            <p className="text-xs text-muted-foreground">{ticket.assignee}</p>
          )}
          {planTickets.has(ticket.id) && (
            <Badge variant="secondary" className="text-xs bg-yellow-500/20 text-yellow-600 border-yellow-500/30">
              方案待审批
            </Badge>
          )}
        </CardContent>
      </Card>
    )
  }

  const renderColumn = (column: ColumnData) => {
    const columnTickets = ticketsByColumn[column.id] || []
    const isEditing = editingColumnId === column.id

    return (
      <div
        key={column.id}
        className="min-w-[280px] max-w-[320px] flex-shrink-0 bg-muted/30 rounded-lg p-3 flex flex-col"
        onDragOver={handleDragOver}
        onDrop={() => handleDrop(column.id)}
      >
        {/* column header */}
        <div className="flex items-center justify-between mb-2">
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                className="h-7 text-sm"
                value={editingColumnName}
                onChange={(e) => setEditingColumnName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEditColumn(column.id)
                  if (e.key === "Escape") setEditingColumnId(null)
                }}
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => handleSaveEditColumn(column.id)}
              >
                保存
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="text-sm font-medium truncate cursor-pointer hover:text-primary"
                  onClick={() => handleStartEditColumn(column)}
                  title="点击编辑列名"
                >
                  {column.name}
                </span>
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {columnTickets.length}
                </Badge>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => handleStartEditColumn(column)}
                  title="编辑列名"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteColumn(column.id)}
                  title="删除列"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </Button>
              </div>
            </>
          )}
        </div>

        <Separator className="mb-2" />

        {/* tickets */}
        <div className="flex-1 space-y-2 overflow-y-auto min-h-0">
          {columnTickets.map(renderTicketCard)}
          {columnTickets.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              拖拽工单到此列
            </p>
          )}
        </div>
      </div>
    )
  }

  // ============================================================
  // main render
  // ============================================================
  return (
    <div className="flex flex-col h-full p-4 space-y-3">
      {/* ======== Board selector ======== */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 flex-shrink-0">
        {boards.map((board) => (
          <div key={board.id} className="flex items-center gap-0 flex-shrink-0">
            <Button
              variant={selectedBoardId === board.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedBoardId(board.id)}
              className="rounded-r-none"
            >
              {board.name}
            </Button>
            <Button
              variant={selectedBoardId === board.id ? "default" : "outline"}
              size="sm"
              className="rounded-l-none border-l-0 px-2"
              onClick={() => handleDeleteBoard(board.id)}
              title="删除看板"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-destructive"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCreateBoardOpen(true)}
          className="flex-shrink-0"
        >
          + 新建看板
        </Button>
        {boards.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无看板，请先创建看板</p>
        )}
      </div>

      {/* ======== Main content area ======== */}
      {selectedBoardId ? (
        loading ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-muted-foreground">加载中...</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* board toolbar */}
            <div className="flex items-center justify-between flex-shrink-0 mb-3">
              <h2 className="text-lg font-semibold">
                {selectedBoard?.name}
              </h2>
              <Button size="sm" onClick={openCreateTicket}>
                新建工单
              </Button>
            </div>

            {/* kanban columns */}
            {columns.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-center space-y-3">
                <p className="text-muted-foreground">此看板暂无列，请先创建列</p>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-40 h-8 text-sm"
                    placeholder="输入列名"
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddColumn()
                    }}
                  />
                  <Button size="sm" onClick={handleAddColumn}>
                    添加列
                  </Button>
                </div>
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <div className="flex gap-3 pb-2 h-full">
                  {columns.map(renderColumn)}

                  {/* add column */}
                  {addingColumn ? (
                    <div className="min-w-[200px] flex-shrink-0 bg-muted/30 rounded-lg p-3 space-y-2">
                      <Input
                        className="h-8 text-sm"
                        placeholder="输入列名"
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddColumn()
                          if (e.key === "Escape") {
                            setAddingColumn(false)
                            setNewColumnName("")
                          }
                        }}
                        autoFocus
                      />
                      <div className="flex items-center gap-1">
                        <Button size="sm" className="h-7 text-xs" onClick={handleAddColumn}>
                          添加
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            setAddingColumn(false)
                            setNewColumnName("")
                          }}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-w-[120px] flex-shrink-0 h-9"
                      onClick={() => setAddingColumn(true)}
                    >
                      + 添加列
                    </Button>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        )
      ) : (
        <div className="flex items-center justify-center flex-1">
          <p className="text-muted-foreground">选择一个看板以查看工单</p>
        </div>
      )}

      {/* ======== Create Board dialog ======== */}
      <Dialog open={createBoardOpen} onOpenChange={setCreateBoardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建看板</DialogTitle>
            <DialogDescription>创建看板并预设初始列</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="board-name">看板名称</Label>
              <Input
                id="board-name"
                value={createBoardName}
                onChange={(e) => setCreateBoardName(e.target.value)}
                placeholder="输入看板名称"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBoard()
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>默认列</Label>
              <div className="space-y-1.5">
                {createBoardColumnChecks.map((col, i) => (
                  <label
                    key={`${col.name}-${i}`}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={col.checked}
                      onChange={() => {
                        setCreateBoardColumnChecks((prev) =>
                          prev.map((c, j) =>
                            j === i ? { ...c, checked: !c.checked } : c
                          )
                        )
                      }}
                      className="rounded"
                    />
                    {col.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">添加自定义列</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 text-sm"
                  placeholder="输入自定义列名"
                  value={createBoardCustomColumn}
                  onChange={(e) => setCreateBoardCustomColumn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCustomColumnToForm()
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 flex-shrink-0"
                  onClick={handleAddCustomColumnToForm}
                >
                  + 添加
                </Button>
              </div>
              {createBoardColumnChecks.filter(
                (c) => !DEFAULT_COLUMNS.includes(c.name)
              ).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {createBoardColumnChecks
                    .filter((c) => !DEFAULT_COLUMNS.includes(c.name))
                    .map((c, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="text-xs cursor-pointer"
                        onClick={() => {
                          setCreateBoardColumnChecks((prev) =>
                            prev.filter((x) => x.name !== c.name)
                          )
                        }}
                      >
                        {c.name} &times;
                      </Badge>
                    ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCreateBoardOpen(false)
                  setCreateBoardName("")
                  setCreateBoardColumnChecks(
                    DEFAULT_COLUMNS.map((name) => ({ name, checked: true }))
                  )
                  setCreateBoardCustomColumn("")
                }}
              >
                取消
              </Button>
              <Button
                onClick={handleCreateBoard}
                disabled={
                  !createBoardName.trim() ||
                  !createBoardColumnChecks.some((c) => c.checked)
                }
              >
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ======== Plan Review Dialog ======== */}
      <PlanReviewDialog />

      {/* ======== Create/Edit Ticket dialog ======== */}
      <Dialog
        open={ticketDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTicketDialogOpen(false)
            resetTicketForm()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTicket ? "编辑工单" : "新建工单"}
            </DialogTitle>
            <DialogDescription>
              {editingTicket
                ? `编辑看板 "${selectedBoard?.name}" 中的工单`
                : `在看板 "${selectedBoard?.name}" 中创建新工单`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="title">标题</Label>
              <Input
                id="title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="输入工单标题"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="输入工单描述（可选）"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">优先级</Label>
              <Select value={formPriority} onValueChange={setFormPriority}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="urgent">紧急</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* assignee: select from AI colleagues */}
            <div className="space-y-2">
              <Label htmlFor="assignee">负责人 (AI 同事)</Label>
              <Select
                value={formAssignee}
                onValueChange={setFormAssignee}
              >
                <SelectTrigger id="assignee">
                  <SelectValue placeholder="选择负责人（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">无</SelectItem>
                  {aiColleagues.map((ai) => (
                    <SelectItem key={ai.id} value={ai.name}>
                      <span className="flex items-center gap-1.5">
                        {ai.name}
                        <span
                          className={cn(
                            "text-xs",
                            ai.status === "idle"
                              ? "text-green-500"
                              : ai.status === "busy"
                                ? "text-yellow-500"
                                : "text-muted-foreground"
                          )}
                        >
                          ({ai.status === "idle" ? "空闲" : ai.status === "busy" ? "忙碌" : ai.status})
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Assign to AI button (edit mode only) */}
            {editingTicket && formAssignee && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    const colleague = aiColleagues.find(
                      (a) => a.name === formAssignee
                    )
                    if (colleague) {
                      await handleAssignToAI(editingTicket.id, colleague.id)
                    }
                  }}
                >
                  派发任务给 AI
                </Button>
              </div>
            )}

            {/* delete button in edit mode */}
            {editingTicket && (
              <div className="pt-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    await handleDeleteTicket(editingTicket.id)
                    setTicketDialogOpen(false)
                    resetTicketForm()
                  }}
                >
                  删除工单
                </Button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setTicketDialogOpen(false)
                  resetTicketForm()
                }}
              >
                取消
              </Button>
              <Button
                onClick={handleTicketSubmit}
                disabled={!formTitle.trim()}
              >
                {editingTicket ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}