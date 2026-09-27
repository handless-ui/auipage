# [@auipage/core](https://github.com/handless-ui/auipage/packages/core/README.md)

auipage 的核心层：业务侧实现 Adapter 对接模型与存储，UI 侧实现 Runtime 负责渲染，`AuiPage` 把两者串起来，统一处理会话列表、消息历史、流式对话和历史入库。不耦合任何模型服务与 UI 框架。

<p>
    <a href="https://zxl20070701.github.io/toolbox/#/npm-download?packages=@auipage/core&interval=7">
        <img src="https://img.shields.io/npm/dm/@auipage/core.svg" alt="downloads">
    </a>
    <a href="https://www.npmjs.com/package/@auipage/core">
        <img src="https://img.shields.io/npm/v/@auipage/core.svg" alt="npm">
    </a>
    <a href="https://github.com/handless-ui/auipage" target='_blank'>
        <img alt="GitHub repo stars" src="https://img.shields.io/github/stars/handless-ui/auipage?style=social">
    </a>
</p>

<img src="https://nodei.co/npm/@auipage/core.png?downloads=true&amp;downloadRank=true&amp;stars=true" alt="NPM">

## 安装

```
npm install --save @auipage/core
```

通常配合 `@auipage/agent`（对话循环）、`@auipage/model`（模型请求）一起使用。

## 导出

| 导出名 | 类型 | 作用 |
| --- | --- | --- |
| `AuiPage` | 构造器 | 框架核心，管理 adapter / runtime、消息与会话状态 |
| `ChatTransportAdapter` | 适配器基类 | 对接模型对话接口，流式产出消息片段 |
| `MessageHistoryAdapter` | 适配器基类 | 历史消息的加载与追加 |
| `ThreadListAdapter` | 适配器基类 | 会话列表的增删改查 |
| `ThreadListRuntime` | 运行时基类 | 会话列表的 UI 渲染钩子 |
| `ChatContentRuntime` | 运行时基类 | 对话内容的 UI 渲染钩子 |
| `defineTool` | 函数 | 定义前端工具（`description` / `execute` / `render`） |
| `generator` | 函数 | 把回调式异步流转成 `AsyncGenerator` |
| `MessageStream` | 构造器 | 消息流封装（`send` / `end`），服务端配合 `CreateTool` 推送 SSE |

## 文档

- [快速上手](./docs/quick-start.md)：完整可运行示例与整体流程
- [AuiPage](./docs/auipage.md)：构造参数、实例属性与方法、消息结构
- [Adapter](./docs/adapters.md)：三个适配器的接口与实现示例
- [Runtime](./docs/runtimes.md)：两个运行时的渲染钩子约定
- [defineTool](./docs/define-tool.md)：前端工具定义
- [generator](./docs/generator.md)：回调式流到 `AsyncGenerator` 的转换

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
