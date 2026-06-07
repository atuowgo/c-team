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
