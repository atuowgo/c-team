// IPC event types shared between main and renderer processes

// --- Data types ---

export interface ChannelData {
  id: string
  name: string
  type: string
  created_at: string
  updated_at: string
}

export interface MessageData {
  id: string
  channel_id: string
  sender_id: string
  content: string
  parent_id: string | null
  context_ref: string | null
  created_at: string
}

export interface BoardData {
  id: string
  name: string
  channel_id: string | null
  created_at: string
}

export interface ColumnData {
  id: string
  board_id: string
  name: string
  position: number
  created_at: string
}

export interface TicketData {
  boardId?: string
  columnId?: string
  title: string
  description?: string
  assignee?: string
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  status?: string
  labels?: string[]
}

export interface TicketResult {
  id: string
  board_id: string
  column_id: string | null
  title: string
  description: string
  assignee: string | null
  priority: string
  labels: string
  pr_url: string | null
  created_at: string
  updated_at: string
}

export interface AiColleagueData {
  id: string
  name: string
  role: string
  system_prompt: string
  capabilities: string
  status: string
  current_task: string | null
  created_at: string
}

export interface AiColleagueCreateData {
  name: string
  role: string
  system_prompt: string
  capabilities?: string[]
}

export interface AiTaskData {
  colleague_id?: string
  event_type: string
  payload: Record<string, unknown>
  priority?: number
}

export interface AiTaskResult {
  id: string
  colleague_id: string | null
  event_type: string
  payload: string
  priority: number
  status: string
  result: string | null
  created_at: string
  completed_at: string | null
}

// --- IPC event signatures ---

export interface IpcEvents {
  // Channels
  'channel:list': () => ChannelData[]
  'channel:create': (name: string) => ChannelData
  'channel:delete': (id: string) => { success: boolean }

  // Messages
  'message:list': (channelId: string) => MessageData[]
  'message:send': (channelId: string, content: string, senderId: string) => MessageData
  'message:delete': (id: string) => { success: boolean }

  // Boards
  'board:list': () => BoardData[]
  'board:create': (name: string) => BoardData
  'board:create-with-columns': (name: string, columnNames: string[]) => { board: BoardData; columns: ColumnData[] }
  'board:delete': (id: string) => { success: boolean }

  // Columns
  'column:list': (boardId: string) => ColumnData[]
  'column:create': (boardId: string, name: string, position?: number) => ColumnData
  'column:update': (id: string, data: { name?: string; position?: number }) => ColumnData
  'column:delete': (id: string) => { success: boolean }

  // Tickets
  'ticket:list': (boardId: string) => TicketResult[]
  'ticket:create': (data: TicketData) => TicketResult
  'ticket:update': (id: string, data: Partial<TicketData>) => TicketResult
  'ticket:delete': (id: string) => { success: boolean }
  'ticket:assign': (id: string, colleagueId: string) => TicketResult

  // AI Colleagues
  'ai:list': () => AiColleagueData[]
  'ai:create': (data: AiColleagueCreateData) => AiColleagueData
  'ai:update': (id: string, data: Partial<AiColleagueCreateData>) => AiColleagueData
  'ai:delete': (id: string) => { success: boolean }
  'ai:status': (id: string) => AiColleagueData | null

  // AI Task Queue
  'ai:task-list': (filters?: { colleagueId?: string; status?: string }) => AiTaskResult[]
  'ai:task-create': (data: AiTaskData) => AiTaskResult
  'ai:task-update': (id: string, data: Partial<AiTaskData & { status?: string; result?: string }>) => AiTaskResult
  'ai:task-delete': (id: string) => { success: boolean }

  // Settings
  'settings:get': (key: string) => unknown
  'settings:set': (key: string, value: unknown) => void
}

export interface IpcRendererEvents {
  'system:notification': (message: string) => void
  'ai:status-changed': (colleagueId: string, status: string) => void
  'ai:task-progress': (taskId: string, progress: number) => void
  'ai:task-assigned': (taskId: string, colleagueId: string) => void
  'ai:task-completed': (taskId: string, result: string) => void
}