# 快速上手

## 安装

```
npm install --save @auipage/core
```

只依赖 `oipage` 和 `@auipage/types`，不耦合具体模型或后端。

## 框架的分工

- **Adapter**：对接外部世界——模型调用、历史读写、会话列表增删改查。数据存哪、用什么协议，框架不管。
- **Runtime**：把数据画到 UI 上。框架只在合适时机调用钩子，渲染由业务侧完成。
- **AuiPage**：串起两者，维护 `currentThreadId`、`currentMessages`，处理流式拼接、新会话创建和历史入库。

## 最小示例

纯 JS，可直接拷贝运行，把 `ChatTransportAdapter.run` 换成你自己的流式接口即可：

```javascript
import {
    AuiPage,
    ChatTransportAdapter,
    MessageHistoryAdapter,
    ThreadListAdapter,
    ThreadListRuntime,
    ChatContentRuntime
} from "@auipage/core";

// ---------- 模拟数据 ----------
let threads = [{ threadId: "t1", title: "上一段对话" }];
let messagesOfT1 = [
    { role: "user",      content: [{ type: "text", text: "你是谁？" }] },
    { role: "assistant", content: [{ type: "text", text: "我是 auipage demo。" }] }
];

// ---------- Adapter ----------
const threadList = new ThreadListAdapter({
    list:      async () => threads,
    new:       async (firstMessage) => {
        // firstMessage 是历史消息组 { messages: ChatMessage[] }，不是单条消息
        const t = { threadId: "t" + Date.now(), title: firstMessage.messages[0].content[0].text.slice(0, 20) };
        threads.push(t);
        return t;
    },
    delete:    async (threadId) => { threads = threads.filter(t => t.threadId !== threadId); },
    archive:   async () => {},
    unarchive: async () => {}
});

const messageHistory = new MessageHistoryAdapter({
    load:   async (threadId) => threadId === "t1" ? [{ messages: messagesOfT1 }] : [],
    append: async () => {}
});

const chatTransport = new ChatTransportAdapter({
    async *run({ messages }) {
        const reply = "你好！我是 auipage demo。";
        for (const ch of reply) yield { type: "text", text: ch };
    }
});

// ---------- Runtime ----------
const threadListUI = new ThreadListRuntime({
    init:      (list) => console.log("[ThreadList] init", list),
    active:    (id)   => console.log("[ThreadList] active", id),
    append:    (t)    => console.log("[ThreadList] append", t),
    delete:    (id)   => console.log("[ThreadList] delete", id),
    archive:   (id)   => console.log("[ThreadList] archive", id),
    unarchive: (id)   => console.log("[ThreadList] unarchive", id)
});

const chatUI = new ChatContentRuntime({
    init: (messages) => console.log("[ChatContent] init", messages),
    append: (role, part) => {
        console.log("[ChatContent] append", role, part);
        if (part.type === "text") {
            let buf = part.text;
            return (text) => {
                buf += text;
                console.log("[ChatContent] stream update:", buf);
            };
        }
    }
});

// ---------- 组装 ----------
// tools 可选，没有工具时省略即可
const page = new AuiPage({
    adapter: {
        ChatTransport:  chatTransport,
        MessageHistory: messageHistory,
        ThreadList:     threadList
    },
    runtime: {
        ThreadList:  threadListUI,
        ChatContent: chatUI
    },
    tools: []
});

// ---------- 发消息 ----------
// 返回 Promise；上一轮还没结束时调用会 reject("当前正在执行中")
page.sendMessage({
    role: "user",
    content: [{ type: "text", text: "你好" }]
}).catch(err => console.log(err));
```

## 一轮对话的流程

1. `new AuiPage()` 时调用 `ThreadList.list()`，结果交给 `ThreadList.init` 渲染。
2. `sendMessage` 先把用户消息逐段交给 `ChatContent.append`，再调 `ChatTransport.run()` 拿到流。
3. 流里的 `text / thinking / loading` 增量拼接到当前消息；`tool-call` 按[前端执行 / 后端等待](./auipage.md#工具调用流程tool-call)的规则处理。
4. 流结束后合并消息；当前没有会话时调 `ThreadList.new()` 创建（返回假值则中止本轮），并触发 `ThreadList.append`。
5. 消息写入 `currentMessages`，调 `MessageHistory.append()` 落库，Promise resolve；执行中重复发消息会被拒绝。
6. 对话执行中 `activeThread` 切换会话会被忽略；`deleteThread` / `archiveThread` 等操作透传到 adapter 与 runtime。

## 下一步

- [auipage.md](./auipage.md)：`AuiPage` 的方法与消息结构
- [adapters.md](./adapters.md) / [runtimes.md](./runtimes.md)：接口与示例
- [define-tool.md](./define-tool.md) / [generator.md](./generator.md)：工具定义与流转换
