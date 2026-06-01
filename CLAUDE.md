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