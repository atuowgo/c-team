# RULE.md — 背景说明与踩坑记录

## DeepSeek 集成修复记录（2026-06-07）

### 问题背景

用户配置 DeepSeek 模型后：发送消息无响应，@提及 AI 同事也无效。

### 根因分析

| 问题 | 根因 | 修复位置 |
|------|------|---------|
| 消息无响应 | `catch` 块中错误被静默吃掉，无通知 | `programming-session.ts` → `notifyRenderer` |
| @提及无效 | `ai-scheduler.ts` 的 `dispatchTask()` 忽略消息预设的 `colleague_id`，总选第一个空闲 AI | `ai-scheduler.ts` → 优先用 `task.colleague_id` |
| 全局默认是 Anthropic | `claude-api.ts` / `SettingsView.tsx` 默认值硬编码 Anthropic | 两处改为 `deepseek` / `deepseek-v4-flash` |

### CDP 前端验证方案

因 macOS 安全限制，Quartz `CGEventPost` 合成事件无法注入其他进程。改用 Chrome DevTools Protocol（CDP）通过 WebSocket 控制 Electron。

**连接步骤：**
1. 启动 Electron 时加 `--remote-debugging-port=9222 --remote-allow-origins='*'`
2. `curl http://localhost:9222/json` 获取 page target ID
3. `websocket.WebSocket().connect(f"ws://localhost:9222/devtools/page/{ID}")`
4. 发送 JSON-RPC 命令：`Runtime.evaluate`, `Page.captureScreenshot`, `Input.insertText`

**关键陷阱：**

- `returnByValue: true` + 返回 DOM 元素 → 得到 `null`，必须返回布尔/字符串
- `Input.insertText` 不触发 React `onChange`，React state 不更新 → 用 `nativeInputValueSetter` 技巧
- `Input.dispatchKeyEvent(Enter)` 不触发 React `onSubmit` → 用 `form.requestSubmit()`
- 源码改后若不重新 build，CDP 连到的是旧构建 → 改完必须 `electron-vite build`

### 版本信息

- Vercel AI SDK: `ai: ^6.0.197`
- `@ai-sdk/openai: ^3.0.68`（DeepSeek 通过 `createOpenAI` + `baseURL: 'https://api.deepseek.com'` 接入）
- 验证通过：17/17 前端检查项全部 PASS

## AI Skill 自动选择 + 思考过程 + Mermaid 渲染（2026-06-13）

### 功能设计

**技能自动选择**：不做独立的 skill-selection API 调用（增加延迟和成本），而是将所有技能的完整指令注入 system prompt。AI 在回复时自行判断是否需要技能，并用 `[SKILL: name]` 标注所选技能名。前端解析展示徽章。

**思考过程显示**：在 system prompt 末尾追加指令，要求 AI 在 `<think>...</think>` 标签内写推理，随后给出正式答复。前端解析标签，`ThinkingBlock` 组件折叠展示。

**消息内容格式**（存储在 DB content 字段，不做结构化存储）：
```
[SKILL: mermaid]
<think>
用户需要...，我会用 flowchart...
</think>

正式回答 + ```mermaid 代码块
```

**前端解析管道** (`parseMessageContent`)：
1. 提取行首 `[SKILL: name]` → skill 字段
2. 提取 `<think>...</think>` → thinking 字段
3. 剩余内容 → body 字段（含 mermaid 代码块）
4. `splitBodySegments` 将 body 分成 text/mermaid 段
5. mermaid 段交给 `MermaidBlock` 用 `mermaid.render()` 渲染成 SVG

### 关键坑点

| 坑 | 原因 | 解决 |
|----|------|------|
| skills IPC 处理器全部缺失 | 历史代码只实现了前端调用，未注册 main 进程 handler | 在 `ipc-handlers/index.ts` 补全四个 handler |
| adm-zip 在 ESM 打包中 `.default` 不是构造函数 | electron-vite 主进程是 CJS，动态 `import('adm-zip').default` 有风险 | 改用 `createRequire(import.meta.url)('adm-zip')` |
| mermaid 渲染 ID 冲突 | 同页面多次调用 `mermaid.render(id, ...)` 时 ID 重复报错 | 模块级全局计数器 `mermaidCounter++` |
| React 状态未因外部 IPC 调用更新 | IPC 在组件挂载后写入 DB，组件不感知 | CDP 验证时用 `Page.reload()` 重新挂载组件 |
| SkillsView 一直显示"加载中..." | `skills:list` IPC 无 handler，promise reject，无 `.catch()` 故静默失败 | 补全 handler，UI 才能正常显示 |

### 依赖版本

- `mermaid: ^11.15.0`（支持 flowchart / sequenceDiagram / classDiagram / gantt / stateDiagram / erDiagram）
- `adm-zip: ^0.5.17`（zip 技能包解压）
- `@types/adm-zip: ^0.5.8`（TypeScript 类型）
