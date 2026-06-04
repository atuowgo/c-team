import { useState, useEffect } from "react"
import type { AiColleagueData } from "@common/ipc"

export function StatusBar(): React.ReactElement {
  const [colleagues, setColleagues] = useState<AiColleagueData[]>([])
  const [taskProgress, setTaskProgress] = useState<Record<string, number>>({})
  const [message, setMessage] = useState("就绪")

  useEffect(() => {
    // Fetch colleagues
    window.electron.invoke<AiColleagueData[]>("ai:list").then(setColleagues).catch(() => {})
    const interval = setInterval(() => {
      window.electron.invoke<AiColleagueData[]>("ai:list").then(setColleagues).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const unsub1 = window.electron.on("ai:task-progress", (taskId: unknown, progress: unknown) => {
      const tid = String(taskId)
      const prog = Number(progress)
      if (prog < 0) {
        setMessage("任务失败")
      } else if (prog >= 100) {
        setMessage("任务完成")
      } else {
        setTaskProgress(prev => ({ ...prev, [tid]: prog }))
        setMessage(`任务执行中 ${prog}%`)
      }
    })
    const unsub2 = window.electron.on("ai:status-changed", () => {
      window.electron.invoke<AiColleagueData[]>("ai:list").then(setColleagues).catch(() => {})
    })
    return () => { unsub1(); unsub2() }
  }, [])

  const onlineCount = colleagues.filter(c => c.status === "online" || c.status === "busy").length
  const busyCount = colleagues.filter(c => c.status === "busy").length

  return (
    <div className="h-7 border-t border-border bg-muted/30 flex items-center px-3 text-xs text-muted-foreground gap-4 shrink-0">
      <span>{message}</span>
      <span>AI 同事: {onlineCount}/{colleagues.length} 在线</span>
      {busyCount > 0 && <span>{busyCount} 忙碌</span>}
      {Object.entries(taskProgress).filter(([, p]) => p > 0 && p < 100).map(([tid, p]) => (
        <span key={tid}>{tid.slice(0,8)} {p}%</span>
      ))}
      <span className="ml-auto">C-Team v0.1.0</span>
    </div>
  )
}