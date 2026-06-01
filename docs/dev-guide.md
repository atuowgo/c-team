# c-team 开发指南

## 环境准备

### 前置条件

- Node.js 18+（安装路径：`D:\Program Files\nodejs`）
- pnpm（`npm install -g pnpm`）
- Python 3 + VS Build Tools（Windows 编译原生模块需要）

### PATH 设置（Git Bash/MSYS2）

```bash
export PATH="/d/Program Files/nodejs:/c/Users/adamcchen/AppData/Roaming/npm:$PATH"
```

> 永久修复：将 `D:\Program Files\nodejs` 和 `C:\Users\adamcchen\AppData\Roaming\npm` 加入 Windows 用户环境变量 PATH。

### 安装依赖

```bash
pnpm install
```

## 原生模块重编译

better-sqlite3 必须用 Electron 内置 Node.js 的头文件编译，否则 ABI 不匹配。

```bash
npx @electron/rebuild -m . -o better-sqlite3
```

> `pnpm rebuild` 不够——它针对系统 Node.js（ABI 141），而 Electron 40.x 内置 Node.js 需要 ABI 143。

## 启动开发

```bash
pnpm dev
```

等效于 `electron-vite dev`。Vite 开发服务器启动后会自动打开 Electron 窗口。

## 调试

### 类型检查

```bash
pnpm typecheck        # 主进程 + 渲染进程
pnpm typecheck:node   # 仅主进程
pnpm typecheck:web    # 仅渲染进程
```

### 构建

```bash
pnpm build     # 生产构建
pnpm preview   # 预览生产构建
```

### Electron DevTools

应用启动后按 `Ctrl+Shift+I` 打开 DevTools。

## 项目结构

```
c-team/
├── src/
│   ├── main/          # Electron 主进程
│   ├── preload/       # 预加载脚本
│   └── renderer/      # React 渲染进程
│       └── src/
│           ├── components/  # UI 组件
│           ├── store/       # Zustand 状态管理
│           └── App.tsx      # 应用入口
├── electron.vite.config.ts
├── package.json
└── docs/
```

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Electron 40 + electron-vite 5 |
| 前端 | React 19 + TypeScript 5.8 |
| 样式 | Tailwind CSS 4 + Radix UI |
| 状态管理 | Zustand 5 |
| 数据库 | better-sqlite3 12 |
| AI SDK | @anthropic-ai/sdk 0.100 |
| Git | @octokit/rest 22 |