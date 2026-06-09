import { AppShell } from "@/components/app-shell"
import { useAppStore } from "@/stores/app-store"
import { ChannelView } from "@/components/views/ChannelView"
import { BoardView } from "@/components/views/BoardView"
import { EmployeeView } from "@/components/views/EmployeeView"
import { SkillsView } from "@/components/views/SkillsView"
import { SettingsView } from "@/components/views/SettingsView"
import { StatusBar } from "@/components/StatusBar"
import { Toaster } from "@/components/ui/toaster"

function MainContent(): React.ReactElement {
  const activeView = useAppStore((s) => s.activeView)

  switch (activeView) {
    case "channel":
      return <ChannelView />
    case "board":
      return <BoardView />
    case "employees":
      return <EmployeeView />
    case "skills":
      return <SkillsView />
    case "settings":
      return <SettingsView />
  }
}

export default function App(): React.ReactElement {
  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0">
        <MainContent />
        <StatusBar />
      </div>
      <Toaster />
    </AppShell>
  )
}
