# 系统设计：AI 同事功能增强

**日期**：2026-06-07  
**依据**：`docs/plans/2026-06-07-ai-colleague-enhanced-design.md`  
**状态**：待实现

---

## 一、模块关系图

```
Renderer                      Main Process
──────────────────────────────────────────────────────
ChannelView.tsx
  ├─ 发消息（reply_to_id）  →  ipc-handlers/index.ts
  ├─ 监听 ai:typing-*       ←  programming-session.ts
  ├─ 渲染树状引用             ←  messages.parent_id
  └─ 展示 typing 动画

SettingsView.tsx
  └─ 编辑频道管理员配置     →  ipc-handlers/index.ts

                              database/migrations.ts   ← v5 新增 5 张表/字段
                              memory-manager.ts         ← 新增模块
                              ├─ assembleContext()
                              ├─ queueMemoryJob()
                              └─ processMemoryJobs()
                              ai-scheduler.ts           ← 路由到管理员逻辑
                              programming-session.ts    ← typing 事件 + memory job
```

---

## 二、数据层变更（Migration v5）

```sql
-- 2-1: 复用 messages.parent_id 作为引用回复字段（已存在，无需新增列）
-- 约定：parent_id 非空时表示该消息是对 parent_id 消息的引用回复

-- 2-2: 频道管理员映射表
CREATE TABLE IF NOT EXISTS channel_managers (
  channel_id   TEXT PRIMARY KEY,
  colleague_id TEXT NOT NULL,
  FOREIGN KEY (channel_id)   REFERENCES channels(id)      ON DELETE CASCADE,
  FOREIGN KEY (colleague_id) REFERENCES ai_colleagues(id) ON DELETE CASCADE
);

-- 2-3: 频道整体摘要
CREATE TABLE IF NOT EXISTS channel_memories (
  channel_id TEXT PRIMARY KEY,
  summary    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2-4: 话题快照（parent_id = NULL 的消息为根消息，即 topic_id）
CREATE TABLE IF NOT EXISTS topic_summaries (
  topic_id      TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2-5: 同事个人笔记
CREATE TABLE IF NOT EXISTS colleague_notes (
  colleague_id TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (colleague_id, channel_id)
);

-- 2-6: 记忆更新队列
CREATE TABLE IF NOT EXISTS memory_jobs (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,   -- 'channel_summary' | 'topic_snapshot' | 'colleague_notes'
  payload    TEXT NOT NULL,   -- JSON
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 关于 messages.parent_id 复用

`parent_id` 已在 schema 和 `MessageData` 类型中存在，当前全部为 `null`。直接复用：
- `parent_id = null`：普通顶层消息（可作为 topic 根消息）
- `parent_id = <msgId>`：对该消息的引用回复

无需 migration 新增列，仅需在写入和查询时使用该字段。

---

## 三、IPC 合约变更

### 3-1 新增请求型 IPC（ipc.ts IpcEvents）

```ts
// 频道管理员
'channel:manager-get': (channelId: string) => AiColleagueData | null
'channel:manager-set': (channelId: string, colleagueId: string) => { success: boolean }

// 消息：扩展 message:send，新增可选 parentId 参数
'message:send': (channelId: string, content: string, senderId: string, parentId?: string | null) => MessageData
```

### 3-2 新增推送型 IPC（ipc.ts IpcRendererEvents）

```ts
// 正在输入状态
'ai:typing-start': (colleagueId: string, collegueDisplayName: string) => void
'ai:typing-stop':  (colleagueId: string) => void

// 新消息（AI 回复后推送给 renderer 刷新）
'message:new': (message: MessageData) => void
```

### 3-3 MessageData 扩展

```ts
export interface MessageData {
  id: string
  channel_id: string
  sender_id: string
  content: string
  parent_id: string | null     // 复用为 reply_to_id
  context_ref: string | null
  created_at: string
}
```

---

## 四、新增模块：memory-manager.ts

**路径**：`src/main/memory-manager.ts`

### 导出接口

```ts
// 组装 AI 回复所需上下文（按 cache 优先级排列，返回 messages 数组）
export function assembleContext(
  colleagueId: string,
  channelId: string,
  currentTopicId: string | null
): { role: 'user' | 'assistant'; content: string }[]

// 同步写入 memory_jobs 队列（AI 回复完成后立即调用，不阻塞）
export function queueMemoryJob(
  type: 'channel_summary' | 'topic_snapshot' | 'colleague_notes',
  payload: { channelId: string; topicId?: string; colleagueId?: string; aiResponse?: string }
): void

// 处理 pending 中的 memory_jobs（app 启动时 + 每次 AI 回复后异步调用）
export async function processMemoryJobs(): Promise<void>
```

### 上下文组装逻辑（assembleContext 内部）

```
1. 读取 colleague_notes (colleagueId, channelId)
2. 读取 channel_memories (channelId)
3. 读取其他活跃话题的 topic_summaries（排除 currentTopicId，非实时快照）
4. 读取 currentTopicId 下的完整消息列表

拼接顺序（稳定性从高到低）:
  系统提示词（由调用方传入，不在此处理）
  └─ colleague_notes.notes            ← 极少变化
  └─ channel_memories.summary         ← 按话题关闭触发，较稳定
  └─ other topics summaries（快照）   ← N条消息更新一次
  └─ current topic full messages      ← 每条消息都变，不缓存
```

### 记忆更新触发规则（processMemoryJobs 内部）

| job.type | 触发条件 | 操作 |
|---------|---------|------|
| `topic_snapshot` | 话题每 10 条新消息 | 重新生成 topic_summaries 快照 |
| `channel_summary` | 话题超过 30 分钟无新消息 | 将话题摘要追加进 channel_memories |
| `colleague_notes` | AI 每次回复后 | AI 自判断是否有值得记录的信息 |

---

## 五、各模块改动细节

### 5-1 database/migrations.ts

新增 version 5，包含上述 5 张新表的 CREATE 语句。

### 5-2 ipc-handlers/index.ts

**新增 handler：**
- `channel:manager-get`：`SELECT colleague_id FROM channel_managers WHERE channel_id = ?`，再 JOIN ai_colleagues
- `channel:manager-set`：UPSERT channel_managers
- `channel:create`：创建频道时，若全局默认管理员同事存在，自动插入 channel_managers 记录

**修改 handler：**
- `message:send`：接收第四个参数 `parentId?: string | null`，写入 `messages.parent_id`

### 5-3 programming-session.ts（startChatReply 函数）

```
改动点：
1. callClaude 前：notifyRenderer('ai:typing-start', colleagueId, displayName)
2. callClaude 后（成功或失败）：notifyRenderer('ai:typing-stop', colleagueId)
3. 消息写入 DB 后：
   a. notifyRenderer('message:new', newMessage)   ← 推送新消息给 renderer
   b. queueMemoryJob('colleague_notes', { channelId, colleagueId, aiResponse: response })
   c. queueMemoryJob('topic_snapshot',  { channelId, topicId: rootMessageId })
4. AI 回复时，检测话题根消息 ID（parent_id 链条的顶端），传入 assembleContext 组装上下文
5. processMemoryJobs() 异步执行（不 await，不阻塞回复流程）
```

**上下文组装替换：**

原来直接传 `message` 字符串给 `callClaude`；改为先调用 `assembleContext`，将返回的 messages 数组传给 `callClaude`（需同步修改 claude-api.ts 支持 messages 数组入参）。

### 5-4 ai-scheduler.ts

**新增逻辑：unaddressed 消息路由到管理员**

```
当前行为：event_type='chat_message' 且无 colleague_id → 分配给任意空闲同事
新行为：  event_type='chat_message' 且无 colleague_id → 查 channel_managers，分配给该频道管理员
          若管理员正在处理中（status='busy'）→ 排队等待（不改变，保持原有队列逻辑）
```

### 5-5 ChannelView.tsx

**新增状态：**
```ts
const [typingColleagues, setTypingColleagues] = useState<Map<string, string>>(new Map())
// key = colleagueId, value = displayName
```

**新增监听：**
```ts
window.electron.ipcRenderer.on('ai:typing-start', (id, name) => ...)
window.electron.ipcRenderer.on('ai:typing-stop',  (id) => ...)
window.electron.ipcRenderer.on('message:new', (msg) => setMessages(prev => [...prev, msg]))
```

**消息树渲染：**
```
消息列表按 created_at 排序后，构建 parent→children Map
根消息（parent_id=null）渲染在主列
子消息在父消息下方缩进渲染，带引用卡片
缩进最多 3 层（超出合并为同一层）
```

**发消息时：**
```ts
// 用户点击"回复"按钮后，记录 replyToId
window.electron.ipcRenderer.invoke('message:send', channelId, content, 'user', replyToId ?? null)
```

**管理员展示：**
```ts
// 同事列表顶部固定展示当前频道管理员，带皇冠 icon
// 从 channel:manager-get 获取
```

**状态文案调整：**
```ts
// 原: status === 'idle' ? '空闲' : '忙碌'
// 新: status === 'idle' ? '可接任务' : '处理中'
// 颜色: idle → green-500, busy → yellow-500
```

---

## 六、claude-api.ts 接口扩展

为支持多轮消息数组（memory context）传入：

```ts
export async function callClaude(
  systemPrompt: string,
  userMessageOrMessages: string | { role: 'user' | 'assistant'; content: string }[],
  options?: { modelOverride?: string }
): Promise<string>
```

内部判断：若传入 string，包装为 `[{ role: 'user', content }]`；否则直接使用数组。

---

## 七、实现阶段与依赖顺序

| 阶段 | 功能 | 依赖 | 预估复杂度 |
|-----|------|------|---------|
| P1 | Migration v5（建表） | — | 低 |
| P2 | 正在输入状态 | P1 | 低 |
| P3 | 同事状态文案 | — | 极低 |
| P4 | 引用回复（parent_id） | P1 | 中 |
| P5 | 频道管理员 | P1 | 中 |
| P6 | 记忆系统 | P1、P4、P5 | 高 |

P1–P3 可并行实现，P4–P5 可并行，P6 最后。

---

## 八、关键决策记录

| 决策 | 方案 | 理由 |
|-----|------|------|
| 引用回复字段 | 复用 `messages.parent_id` | 字段已存在，类型兼容，免去 migration 新增列 |
| 频道管理员存储 | 独立 `channel_managers` 表 | ai_colleagues 不感知频道，职责分离；便于一键切换管理员 |
| 其他话题上下文 | 定时快照（非实时） | 避免每条新消息破坏 prompt cache 前缀，降低 API 费用 |
| 记忆可靠性 | memory_jobs 队列 + 启动补跑 | app 关闭不丢失更新意图；原始消息已落库，摘要是派生物 |
| 上下文传参 | messages 数组 | 支持多轮历史，与 Vercel AI SDK 接口一致 |
