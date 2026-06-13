---
name: mermaid
description: 使用 Mermaid 语法绘制流程图、时序图、甘特图、类图、状态图等各种图表，帮助可视化展示系统架构、业务流程和数据关系
---

## Mermaid 画图技能

当用户需要图表、流程图、架构图、关系图时，使用 Mermaid 语法输出。

### 输出格式（必须严格遵守）

使用 Markdown 代码块，语言标识必须是 `mermaid`：

\`\`\`mermaid
[Mermaid 图表代码]
\`\`\`

### 支持的图表类型

**流程图 (flowchart)**
\`\`\`mermaid
flowchart TD
    A[开始] --> B{判断}
    B -- 是 --> C[处理]
    B -- 否 --> D[跳过]
    C --> E[结束]
    D --> E
\`\`\`

**时序图 (sequenceDiagram)**
\`\`\`mermaid
sequenceDiagram
    participant 用户
    participant 前端
    participant 后端
    用户->>前端: 发送请求
    前端->>后端: API 调用
    后端-->>前端: 返回数据
    前端-->>用户: 展示结果
\`\`\`

**类图 (classDiagram)**
\`\`\`mermaid
classDiagram
    class Animal {
        +String name
        +speak() void
    }
    class Dog {
        +fetch() void
    }
    Animal <|-- Dog
\`\`\`

**甘特图 (gantt)**
\`\`\`mermaid
gantt
    title 项目计划
    dateFormat  YYYY-MM-DD
    section 阶段一
    需求分析    :a1, 2024-01-01, 7d
    设计        :a2, after a1, 5d
    section 阶段二
    开发        :a3, after a2, 14d
    测试        :a4, after a3, 7d
\`\`\`

**状态图 (stateDiagram)**
\`\`\`mermaid
stateDiagram-v2
    [*] --> 待处理
    待处理 --> 进行中 : 开始处理
    进行中 --> 已完成 : 完成
    进行中 --> 失败 : 出错
    已完成 --> [*]
    失败 --> 待处理 : 重试
\`\`\`

**ER 图 (erDiagram)**
\`\`\`mermaid
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    USER {
        string id
        string name
        string email
    }
    ORDER {
        string id
        date created_at
    }
\`\`\`

### 注意事项

1. 始终在代码块前后用文字说明图表的含义
2. 节点文字保持简洁，避免特殊字符（`"`, `[`, `]` 等需转义）
3. 中文节点文字需用引号包裹，例如 `A["用户登录"]`
4. 复杂图表分多个小图展示，比单个大图更清晰
