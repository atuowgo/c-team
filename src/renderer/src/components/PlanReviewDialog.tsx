import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { useToastStore } from "@/stores/toast-store"

interface PlanData {
  taskId: string
  ticketId: string
  content: string
}

export function PlanReviewDialog() {
  const addToast = useToastStore((s) => s.addToast)
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [loading, setLoading] = useState(false)

  const handlePlanSubmitted = useCallback((...args: unknown[]) => {
    const taskId = args[0] as string
    const ticketId = args[1] as string
    const planContent = args[2] as string
    setPlan({ taskId, ticketId, content: planContent })
    setOpen(true)
    setRejecting(false)
    setFeedback("")
  }, [])

  const handlePlanApproved = useCallback(() => {
    setOpen(false)
    setPlan(null)
    addToast("方案已批准，AI 开始编码", "success")
  }, [addToast])

  const handlePlanRejected = useCallback(() => {
    setOpen(false)
    setPlan(null)
    addToast("方案已退回，AI 正在重新生成方案", "info")
  }, [addToast])

  useEffect(() => {
    const unsub1 = window.electron.on("ai:plan-submitted", handlePlanSubmitted)
    const unsub2 = window.electron.on("ai:plan-approved", handlePlanApproved)
    const unsub3 = window.electron.on("ai:plan-rejected", handlePlanRejected)

    return () => {
      unsub1()
      unsub2()
      unsub3()
    }
  }, [handlePlanSubmitted, handlePlanApproved, handlePlanRejected])

  const handleApprove = async () => {
    if (!plan) return
    setLoading(true)
    try {
      await window.electron.invoke("plan:approve", plan.taskId)
      setOpen(false)
      setPlan(null)
    } catch (e) {
      addToast(`批准失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!plan || !feedback.trim()) return
    setLoading(true)
    try {
      await window.electron.invoke("plan:reject", plan.taskId, feedback.trim())
      setOpen(false)
      setPlan(null)
      setFeedback("")
      setRejecting(false)
    } catch (e) {
      addToast(`退回失败: ${e instanceof Error ? e.message : String(e)}`, "error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            AI 执行方案
            <Badge variant="secondary" className="text-xs">待审批</Badge>
          </DialogTitle>
          <DialogDescription>
            AI 同事已提交工单执行方案，请审核后批准或要求修改
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 max-h-[50vh] border rounded-md p-4 bg-muted/30">
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
            {plan?.content || "加载中..."}
          </pre>
        </ScrollArea>

        {rejecting && (
          <div className="space-y-2 pt-2">
            <label className="text-sm font-medium">修改意见</label>
            <Textarea
              placeholder="请描述需要修改的地方..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
            />
          </div>
        )}

        <DialogFooter className="flex items-center gap-2 pt-4">
          {!rejecting ? (
            <>
              <Button
                variant="outline"
                onClick={() => setRejecting(true)}
                disabled={loading}
              >
                要求修改
              </Button>
              <Button onClick={handleApprove} disabled={loading}>
                批准方案
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => { setRejecting(false); setFeedback("") }}
                disabled={loading}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={loading || !feedback.trim()}
              >
                提交反馈
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}