# [@auipage/core](https://github.com/handless-ui/auipage)

核心层：业务侧实现 Adapter 对接模型与存储，UI 侧实现 Runtime 负责渲染，`AuiPage` 把两者串起来，统一处理会话列表、消息历史、流式对话与入库。不依赖任何模型服务，也不依赖任何 UI 框架。

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

## 它解决什么

一个聊天页面真正难维护的，是状态而不是样式：

- 流式片段到达时，要找到对应节点、增量追加，不能重绘整段；
- 切换会话要清空、要重载历史，执行中还不能切；
- 首轮对话结束才创建会话，创建失败要中止整轮；
- 工具卡片有 `pending / success / error` 三个状态，前端工具还要等页面回传结果。

这些状态散在每个组件里，就会和 UI 框架绑死。`AuiPage` 把它们收成一套流程，UI 只负责“把状态画出来”。

## 30 秒例子

纯 console，不碰 DOM，先看清流程（可 `node demo.js` 直接跑）：

```javascript
import {
    AuiPage,
    ChatTransportAdapter,
    MessageHistoryAdapter,
    ThreadListAdapter,
    ThreadListRuntime,
    ChatContentRuntime
} from "@auipage/core";

const page = new AuiPage({
    adapter: {
        ChatTransport: new ChatTransportAdapter({
            async *run({ messages }) {
                for (const ch of "你好，我是 auipage。") {
                    yield { type: "text", text: ch };   // 增量片段
                }
            }
        }),
        MessageHistory: new MessageHistoryAdapter({
            load: async () => [],
            append: async () => {}
        }),
        ThreadList: new ThreadListAdapter({
            list: async () => [],
            new: async () => ({ threadId: "t1", title: "新会话" })
        })
    },
    runtime: {
        ThreadList: new ThreadListRuntime({
            init: threads => console.log("会话列表：", threads)
        }),
        ChatContent: new ChatContentRuntime({
            append: (role, part) => {
                if (part.type === "text") {
                    let buf = part.text;
                    return text => console.log(buf += text);   // 后续增量
                }
            }
        })
    }
});

await page.sendMessage({
    role: "user",
    content: [{ type: "text", text: "你好" }]
});
```

把 `ChatTransport.run` 换成 `@auipage/agent` 的调用，把两个 Runtime 换成真实 DOM 或 React/Vue，流程一行不用改。

安装：

```bash
npm install --save @auipage/core
```

## 导出

| 导出 | 作用 |
| --- | --- |
| `AuiPage` | 框架核心：装配 adapter / runtime，维护消息与会话状态 |
| `ChatTransportAdapter` / `MessageHistoryAdapter` / `ThreadListAdapter` | 三个数据接缝 |
| `ChatContentRuntime` / `ThreadListRuntime` | 两个界面接缝 |
| `defineTool` | 定义页面侧工具（`name` / `description` / `parameters` / `execute` / `render`） |
| `generator` | 回调式异步流 → `AsyncGenerator` |
| `MessageStream` | 服务端消息流封装（`send` / `end`），配合 `CreateTool` 推 SSE |

## 这个包不是必须的

| 你的情况 | 可以换成 | 会失去什么 |
| --- | --- | --- |
| 只做一个 React 聊天页 | `assistant-ui`、Vercel AI SDK 的 `useChat` | 上手更快，但状态与组件绑定，换框架要重写 |
| 不需要会话列表和历史 | 自己写一个消息数组 + 渲染循环 | 代码更短，但流式拼接、工具状态要自己管 |
| 已有内部聊天框架 | 直接复用，只在服务端接 `@auipage/model` | 少一层适配，但没有跨端复用 |
| UI 极简、只要文本 | 自己写 `AsyncGenerator` + `requestAnimationFrame` | 没有会话/历史/工具的统一流程 |

`@auipage/core` 的价值在“**流程控制只写一份，渲染随便换**”。如果只有一个页面、一个框架、且不打算复用到别处，现成的聊天 UI 库更省事。

## 它在哪一环

```
fetch ← model ← agent

core（与 agent 并列，不依赖其他 auipage 包）
```

`core` 与 `agent` 不是父子关系：通常用 `ChatTransportAdapter` 在内部调 `agent.generate()`，但换成任何数据源都可以。React / Vue 用户直接用 [@auipage/react](https://github.com/handless-ui/auipage-react) / [@auipage/vue](https://github.com/handless-ui/auipage-vue) 的 Runtime 实现。

完整接口分四页：[core 概览](https://handless-ui.github.io/auipage/packages/core.html)、[AuiPage](https://handless-ui.github.io/auipage/packages/core-auipage.html)、
[Adapter 与 Runtime](https://handless-ui.github.io/auipage/packages/core-ports.html)、[defineTool 与 generator](https://handless-ui.github.io/auipage/packages/core-utils.html)。

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
