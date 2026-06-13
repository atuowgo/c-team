# CLAUDE.md

## 规则

1. **改动代码前先征求同意**: 在对任何文件进行修改之前，必须先询问并征得我的明确同意。只有在我说"可以修改"、"直接改"、"批准"等明确指示后，才能执行修改操作。在此之前只能进行分析、研究和规划。

2. **使用 Agent/Subagent 分散上下文**: 复杂任务应使用 Agent 工具启动 subagent 来处理，避免所有分析都在主上下文中进行导致上下文窗口溢出。将独立的、可并行的工作分发到子代理中执行，保持主上下文轻量。

3. **执行总结铁律（强制）**: 每次执行任务过程中遇到的问题必须总结提炼——精炼的规则/教训直接写入 `CLAUDE.md`（如环境依赖、版本锁定的原因、关键配置陷阱等）；说明性、上下文背景性的内容写入 `RULE.md`，并在 `CLAUDE.md` 中以 `@RULE.md` 方式引用。每次执行完毕后须进行一次总结。

   **写入分类标准**：
   | 内容类型 | 写入位置 | 示例 |
   |---------|---------|------|
   | 规则/铁律（一行能说清） | CLAUDE.md | "必须锁定 electron 40.x，electron 41+ 不兼容 better-sqlite3 prebuild" |
   | 坑点/陷阱（需背景说明） | RULE.md 引用 | electron-vite v5 不支持函数式嵌套配置的原因和表现 |
   | 环境配置要点 | CLAUDE.md | "Windows 开发须先装 VS Build Tools + Python 3" |
   | 环境配置要点 | CLAUDE.md | "Windows 开发须先安装 Node.js 18+（建议 fnm/Volta 管理版本）" |
   | 构建铁律 | CLAUDE.md | "better-sqlite3 必须通过 @electron/rebuild 重新编译，pnpm rebuild 不够（ABI 不匹配 Electron 内置 Node.js）" |
   | 版本兼容性矩阵 | RULE.md 引用 | 各依赖的版本兼容性详表及踩坑记录 |

## 环境启动铁律

- **首次启动必须用国内镜像下载 Electron 二进制**：`ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/.pnpm/electron@<ver>/node_modules/electron/install.js`，默认 GitHub 源在国内超时
- **pnpm install 会跳过 Electron 下载**（ELECTRON_SKIP_BINARY_DOWNLOAD=1），安装完后需手动补下载或直接 `unzip` 缓存 zip 到 `dist/` 目录
- **path.txt 必须用 `printf` 写入**（不能用 `echo`），`echo` 会附加换行符导致 electron-vite spawn 路径带 `\n` 报错
- **better-sqlite3 必须通过 `node_modules/.bin/electron-rebuild -f -w better-sqlite3` 重新编译**，pnpm rebuild 不够（ABI 不匹配 Electron 内置 Node.js）
- **开发启动命令**：`node_modules/.bin/electron-vite dev`（不要用 pnpm dev，RTK hook 会拦截）

## CDP 前端自动化验证铁律

- **Electron CDP 启动**：必须加 `--remote-debugging-port=9222 --remote-allow-origins='*'`，缺 `--remote-allow-origins` 会报 403 Forbidden WebSocket 握手失败
- **验证前必须重新构建**：源码改动后需 `node_modules/.bin/electron-vite build --outDir out` 再重启，否则 CDP 连到的是旧构建，无法验证新功能
- **CDP 只能返回原始值，不能返回 DOM 元素**：`Runtime.evaluate` 加 `returnByValue: true` 时，返回 DOM 元素对象会得到 `null`；改用返回布尔/字符串/数字：`document.querySelector('input') !== null`
- **无 `type` 属性的 input 不匹配 `input[type=text]`**：shadcn Input 渲染时不设置 `type`，必须用 `document.querySelector('input')` 而非 `input[type=text]`
- **React 受控组件必须用 nativeInputValueSetter 触发 onChange**：`Input.insertText` 只更新 DOM 值，不更新 React state；正确做法：
  ```js
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '文本内容');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  ```
- **表单提交用 `form.requestSubmit()`**：CDP key dispatch（Enter）不触发 React onSubmit；正确：`document.querySelector('form').requestSubmit()`
- **Quartz CGEventPost 合成点击被 macOS 安全机制拦截**：无障碍授权的 app 才能用，普通脚本无效，改用 CDP WebSocket 方案

## Mermaid + 技能系统铁律

- **mermaid 必须在渲染器进程初始化**：`mermaid.initialize()` 只能调用一次（全局），放在模块顶层；每次渲染用递增 ID 避免冲突
- **adm-zip 必须加入 electron-vite external**：主进程 CJS 依赖需在 `rollupOptions.external` 中显式列出，否则打包失败
- **adm-zip 在 ESM 环境用 `createRequire` 引入**：`const _require = createRequire(import.meta.url)`，不能用动态 `import()` 的 `.default`
- **skills IPC 处理器不可缺失**：`skills:list/toggle/delete/upload` 四个处理器缺失时，SkillsView 会永远显示"加载中..."（Promise 静默 reject）
- **CDP 验证 React 状态更新**：IPC 在组件挂载后创建的数据（频道/消息），组件不会自动更新；用 `Page.reload()` 重新挂载或 CDP 直接点击刷新按钮

## SQLite 迁移铁律

- **SQLite 无法 ALTER TABLE DROP CONSTRAINT**：要删除 FK 约束，必须新建无约束表 → INSERT 数据 → DROP 旧表 → RENAME。见 Migration v8。
- **`PRAGMA foreign_keys = OFF` 必须在事务外执行**：该 PRAGMA 在事务内是 no-op；迁移时需先 `db.pragma('foreign_keys = OFF')` 再 `db.exec(m.sql)`，不能写在 SQL 字符串内。
- **system-manager 只存在于 ai_roles，不在 ai_colleagues**：`ai_task_queue.colleague_id` 若有 `REFERENCES ai_colleagues(id)` 的 FK，UPDATE SET colleague_id='system-manager' 会抛 FOREIGN KEY constraint failed，导致任务永远卡在 pending。Migration v8 已修复此约束。

@RULE.md