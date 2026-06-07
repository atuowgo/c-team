# AI 同事属性管理 — 变更计划与验证计划

## 背景

现有 `ai_colleagues` 功能缺少每位同事的独立属性配置：系统提示词虽已存储，但无昵称字段、无模型覆盖机制；Settings UI 只读，无法创建/编辑/删除同事。

---

## 现状分析

**数据模型（`ai_colleagues` 表）**
```
id, name, role, system_prompt, capabilities, status, current_task, created_at
```
缺失：每个同事的独立模型配置，无法覆盖全局设置。

**UI 现状**
- Settings → AI 同事管理 只读，仅展示姓名/角色/状态
- 无创建/编辑/删除操作

**AI 调用现状**
- `planning-phase.ts` 和 `programming-session.ts` 均调用 `callClaude(colleague.system_prompt, ...)`，但模型始终取全局配置

---

## 变更计划

### Phase 1 — 数据层（无 UI 依赖，先做）

**P1-1** `src/main/database/migrations.ts`
- 新增 migration v4：
  ```sql
  ALTER TABLE ai_colleagues ADD COLUMN model TEXT;
  ALTER TABLE ai_colleagues ADD COLUMN nickname TEXT;
  ```

**P1-2** `src/common/ipc.ts`
- `AiColleagueData` 新增 `model: string | null`、`nickname: string | null`
- `AiColleagueCreateData` 新增 `model?: string | null`、`nickname?: string | null`

**P1-3** `src/main/ipc-handlers/index.ts`
- `ai:create` handler：`INSERT` 语句加入 `model`、`nickname` 列
- `ai:update` handler：循环中识别 `model`/`nickname` key，直接映射同名列

---

### Phase 2 — AI 调用层

**P2-1** `src/main/claude-api.ts`
- `CallOptions` 新增 `modelOverride?: string`
- `callClaude` 内：若 `options?.modelOverride` 非空，覆盖 `config.model`

**P2-2** `src/main/planning-phase.ts`
- `startPlanningPhase` 调用 `callClaude` 时加：
  ```typescript
  { ..., modelOverride: (colleague.model as string | null) || undefined }
  ```

**P2-3** `src/main/programming-session.ts`
- `startChatReply` 和 `startCodingPhase` 中所有 `callClaude` 调用同上透传

---

### Phase 3 — UI

**P3-1** `src/renderer/src/components/views/SettingsView.tsx`
- 同事 tab 改为双栏布局：左侧列表 + 右侧编辑面板
- 编辑面板字段：昵称、角色、模型（Select，含"继承全局默认"）、系统提示词（Textarea）、能力标签（Tag Input）
- 支持：新建、编辑已有、保存、删除（内联二次确认，不用 Modal）
- 删除前禁止保存，避免竞态

**UI 布局示意**
```
┌─────────────────────────────────────────────────────┐
│ AI 同事管理                    [+ 新建同事]          │
├──────────────────────────┬──────────────────────────┤
│ 工程师          空闲  ›  │  编辑同事                │
│ 运维专家        空闲  ›  │  昵称: ___________       │
│ 通用助手        空闲  ›  │  角色: ___________       │
│                           │  模型: [全局默认    ▼]  │
│  [+ 新建]                 │  系统提示词:             │
│                           │  ┌────────────────────┐ │
│                           │  │                    │ │
│                           │  └────────────────────┘ │
│                           │  能力标签: [coding × ]  │
│                           │                          │
│                           │  [保存]  [删除]          │
└──────────────────────────┴──────────────────────────┘
```

**编辑面板字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 昵称 | Input | 否 | 显示名，空则显示角色名 |
| 角色 | Input | 是 | 功能标识，如"全栈工程师" |
| 模型 | Select | 否 | 全局模型列表 + "继承全局默认" 选项 |
| 系统提示词 | Textarea | 是 | AI 行为指令 |
| 能力标签 | Tag Input | 否 | coding/debugging/deployment 等 |

---

### 文件改动清单

| 文件 | 改动类型 | 内容 |
|------|---------|------|
| `src/main/database/migrations.ts` | 新增 migration v4 | ADD COLUMN model, nickname |
| `src/common/ipc.ts` | 类型扩展 | AiColleagueData + AiColleagueCreateData 加 model/nickname |
| `src/main/claude-api.ts` | 接口扩展 | CallOptions.modelOverride，getConfig 处理覆盖逻辑 |
| `src/main/planning-phase.ts` | 调用改造 | 透传 modelOverride: colleague.model |
| `src/main/programming-session.ts` | 调用改造 | 同上 |
| `src/main/ipc-handlers/index.ts` | Handler 扩展 | ai:create/ai:update 处理新字段 |
| `src/renderer/src/components/views/SettingsView.tsx` | UI 全改 | 同事列表 + 右侧编辑面板，CRUD 完整实现 |

---

## 验证计划

### V1 — 静态检查（每个 Phase 完成后必跑）

| 检查项 | 命令 | 通过标准 |
|--------|------|----------|
| TypeScript 全量 | `pnpm typecheck` | 0 errors |
| 构建不报错 | `electron-vite build` | exit 0 |

---

### V2 — 数据层验证（Phase 1 完成后）

用 Playwright `_electron` 启动 app，直接查 DB：

| 场景 | 验证方式 | 预期 |
|------|---------|------|
| Migration v4 执行 | 启动 app 后读 `PRAGMA table_info(ai_colleagues)` | 包含 `model`、`nickname` 两列 |
| 旧数据兼容 | 查询已有同事记录 | `model = null`、`nickname = null`，其余字段完整 |
| `ai:create` 带 model | IPC 调用传 `model: "claude-haiku-4-5"` | 查 DB 该行 `model = 'claude-haiku-4-5'` |
| `ai:update` 清空 model | IPC 调用传 `{ model: null }` | 查 DB `model = null` |

---

### V3 — AI 调用层验证（Phase 2 完成后）

| 场景 | 验证方式 | 预期 |
|------|---------|------|
| `modelOverride` 存在时 | 检查 `config.model` 赋值逻辑 | 等于 `modelOverride` 值，不等于全局 model |
| `modelOverride` 为空时 | 同上 | 等于全局 `settings:get('model')` |
| `null` colleague.model 不污染 | 透传 `undefined`（非 `null`）给 `modelOverride` | `callClaude` 用全局 model |

验证方式：Playwright 脚本中通过 `win.evaluate` 调用 IPC 更新同事 model，检查 DB 值，无需真实 LLM 调用。

---

### V4 — UI 功能验证（Phase 3 完成后，Playwright E2E）

**V4-1 列表展示**
- 打开 Settings → AI 同事管理
- 断言：3 个预置同事可见，每个显示姓名 + 状态

**V4-2 编辑已有同事**
- 点击"工程师"行
- 断言：右侧面板展开，角色/系统提示词预填当前值
- 修改系统提示词为 `"测试提示词_edited"`，点保存
- 断言：toast 显示"已保存"；重新点击该行，面板中提示词为修改后值

**V4-3 模型选择持久化**
- 进入编辑面板
- 断言：模型 Select 第一项为"继承全局默认"
- 选择"Claude Haiku 4.5"，保存
- 重新打开面板，断言选中值仍为"Claude Haiku 4.5"

**V4-4 新建同事**
- 点击"+ 新建同事"
- 断言：右侧面板为空表单
- 填写角色"测试角色"、系统提示词"测试"，点保存
- 断言：左侧列表出现新条目

**V4-5 删除同事（内联确认）**
- 进入"测试角色"编辑面板，点"删除"
- 断言：出现"确认删除？[确认] [取消]"文字，不弹 Modal
- 点"取消"，断言：面板恢复正常，条目仍存在
- 再次点"删除"→"确认"
- 断言：列表中"测试角色"消失，面板关闭

**V4-6 能力标签**
- 编辑"运维专家"，断言：已有 tags 可见
- 添加 tag `new-skill`，保存；重新打开，断言该 tag 存在
- 删除 `new-skill` tag，保存；断言消失

**V4-7 数据持久化（重启验证）**
- 完成 V4-2 编辑后，关闭并重新启动 Electron app
- 断言：修改后的提示词/模型仍然生效

---

### 验证顺序与阻断规则

```
P1-1/P1-2/P1-3 → V1(typecheck) → V2(数据层)
         ↓
P2-1/P2-2/P2-3 → V1(typecheck) → V3(调用层)
         ↓
P3-1           → V1(typecheck) → V4-1~V4-7(UI E2E)
```

任一 V1 typecheck 不过 → 阻断，不进入后续阶段。V2/V3 有失败项 → 阻断 Phase 3，先修复。
