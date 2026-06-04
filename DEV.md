# DEV.md - 开发指南

## 启动

```bash
pnpm run dev          # 启动 electron-vite 开发服务器（含热更新）
```

## 类型检查

```bash
pnpm run typecheck:node    # 仅 Node 端（主进程 + preload）
pnpm run typecheck:web     # 仅 Web 端（渲染进程）
pnpm run typecheck         # 全部
```

## 构建

```bash
pnpm run build        # 生产构建
pnpm run preview      # 预览生产构建
```