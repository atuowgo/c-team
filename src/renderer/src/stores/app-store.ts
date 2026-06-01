import { create } from "zustand"

export type ActiveView = "channel" | "board" | "settings"

interface AppState {
  sidebarCollapsed: boolean
  rightSidebarCollapsed: boolean
  activeView: ActiveView

  toggleSidebar: () => void
  toggleRightSidebar: () => void
  setActiveView: (view: ActiveView) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  rightSidebarCollapsed: false,
  activeView: "channel",

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
  setActiveView: (view) => set({ activeView: view }),
}))