# [auipage](https://github.com/handless-ui/auipage)

智能体网页应用开发框架：用「适配器 + 运行时」把大模型对话、流式输出、工具调用、会话与历史管理串成一条链路。业务侧只负责对接模型与存储、实现 UI 渲染，不用处理流式拼接和前后端工具桥接。

<p>
    <a href="https://github.com/handless-ui/auipage/issues">
        <img src="https://img.shields.io/github/issues/handless-ui/auipage" alt="issue">
    </a>
    <a href="https://github.com/handless-ui/auipage" target='_blank'>
        <img alt="GitHub repo stars" src="https://img.shields.io/github/stars/handless-ui/auipage?style=social">
    </a>
    <a href="https://github.com/handless-ui/auipage">
        <img src="https://img.shields.io/github/forks/handless-ui/auipage" alt="forks">
    </a>
     <a href="https://gitee.com/handless-ui/auipage" target='_blank'>
        <img alt="Gitee repo stars" src="https://gitee.com/handless-ui/auipage/badge/star.svg">
    </a>
    <a href="https://gitee.com/handless-ui/auipage">
        <img src="https://gitee.com/handless-ui/auipage/badge/fork.svg" alt="forks">
    </a>
</p>

## 包结构

monorepo 组织在 [packages/](./packages) 下，依赖自底向上：

| 包 | 作用 | 文档 |
| --- | --- | --- |
| [@auipage/types](./packages/types) | 跨包共用的类型协议（模型配置、消息、工具、流式事件） | [README](./packages/types/README.md) |
| [@auipage/fetch](./packages/fetch) | 跨端流式 fetch（浏览器 / Node 自动适配，内置 SSE 解析） | [README](./packages/fetch/README.md) |
| [@auipage/model](./packages/model) | OpenAI 风格 `chat/completions` 封装，支持流式与工具调用 | [README](./packages/model/README.md) |
| [@auipage/agent](./packages/agent) | 对话循环：工具调用编排、思维链回调、`CreateTool` 前后端桥接 | [README](./packages/agent/README.md) |
| [@auipage/core](./packages/core) | 核心层：`AuiPage` + 三个 Adapter + 两个 Runtime | [README](./packages/core/README.md) |

依赖方向：`types` ← `fetch` ← `model` ← `agent`；`core` 依赖 `types`，通过适配器与 `agent` 协作。

## 示例应用

根目录 [src/](./src) 是一个可运行的最小示例：

- [src/apis/](./src/apis)：服务端接口，[chat.js](./src/apis/chat.js) 用 `Agent` + `CreateTool` 驱动 SSE 对话
- [src/adapter/](./src/adapter)：三个适配器的实现
- [src/runtime/](./src/runtime)：会话列表与对话内容的 DOM 渲染
- [src/tools/](./src/tools)：后端工具 `readPlain` 与前端工具 `showPlain` 的对照

```bash
pnpm i
npm run dev
```

访问 http://127.0.0.1:20000/

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
