import { create } from "zustand"

export type ActiveView = "channel" | "board" | "employees" | "settings"

interface AppState {
  sidebarCollapsed: boolean
  rightSidebarCollapsed: boolean
  activeView: ActiveView
  selectedChannelId: string | null

  toggleSidebar: () => void
  toggleRightSidebar: () => void
  setActiveView: (view: ActiveView) => void
  setSelectedChannelId: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  rightSidebarCollapsed: false,
  activeView: "channel",
  selectedChannelId: null,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
  setActiveView: (view) => set({ activeView: view }),
  setSelectedChannelId: (id) => set({ selectedChannelId: id }),
}))
