# Adapter

Adapter 负责数据侧：调用模型、读写历史、管理会话列表。框架只规定接口，方法缺省时为空函数。可以直接 `new XxxAdapter({ ... })` 传入实现，也可以写子类——框架按实例的 `name` 属性（基类已内置，默认为构造器名）去掉 `Adapter` 后缀后挂载，子类可覆盖 `name` 改变挂载位置；实例上的 `aui` 反向指向所属 `AuiPage`。

## ChatTransportAdapter

对接模型对话接口，`sendMessage` 时调用一次。

```typescript
new ChatTransportAdapter({
    // 返回异步生成器，逐个 yield 消息片段；返回假值则本轮中止
    run: (params: {
        messages: ChatMessage[],   // 本轮新消息（当前只有一条）
        context: {
            history: HistoryMessageGroup[],       // 已入库的历史消息组
            tools: Array<{ description: object }> // 注册的工具描述
        }
    }) => AsyncGenerator<MessagePart> | void,

    // 页面 → 服务端回传通道，目前只回传前端工具结果
    response: (name: "tool-result", data: { id: string, status: string, result: any }) => any
});
```

yield 的片段分两类：

```typescript
{ type: "text" | "thinking" | "loading", text: string }  // text 为增量，框架负责拼接
{ type: "tool-call", status, id, name, caller, args, result? }
```

工具片段的处理规则见 [AuiPage 工具调用流程](./auipage.md#工具调用流程tool-call)。`response` 的典型实现是把前端工具结果 POST 回服务端，唤醒挂起的调用。

示例（配合 `@auipage/agent`，用 `generator` 把回调包装成生成器）：

```javascript
import { ChatTransportAdapter, generator } from "@auipage/core";
import { Agent } from "@auipage/agent";

const agent = new Agent({
    model: { model: "gpt-4o-mini", apiKey: "sk-...", baseURL: "https://api.openai.com/v1" },
    stream: true
});

const chatTransport = new ChatTransportAdapter({
    run: ({ messages, context }) => generator((next, done, error) => {
        const fullMessages = [
            ...context.history.flatMap(g => g.messages),
            ...messages
        ];
        agent.generate(fullMessages,
            (text)  => next({ type: "text", text }),
            (think) => next({ type: "thinking", text: think })
        ).then(done, error);
    })
});
```

## MessageHistoryAdapter

```typescript
new MessageHistoryAdapter({
    load:   (threadId: string) => HistoryMessageGroup[] | Promise<...> | void,
    append: (threadId: string, group: HistoryMessageGroup) => any
});
```

`load` 返回假值时跳过历史加载；`append` 不实现则消息只留在内存。

localStorage 示例：

```javascript
const messageHistory = new MessageHistoryAdapter({
    load: (threadId) => {
        const raw = localStorage.getItem("history:" + threadId);
        return raw ? JSON.parse(raw) : [];
    },
    append: (threadId, group) => {
        const key = "history:" + threadId;
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        list.push(group);
        localStorage.setItem(key, JSON.stringify(list));
    }
});
```

## ThreadListAdapter

```typescript
new ThreadListAdapter({
    list:      () => Thread[] | Promise<Thread[]>,
    new:       (firstMessage: HistoryMessageGroup) => Thread | undefined | Promise<...>,
    delete:    (threadId: string) => any,
    archive:   (threadId: string) => any,
    unarchive: (threadId: string) => any
});
```

`new` 返回假值会中止本轮对话（不渲染会话、不写历史）；正常返回的对象至少含 `threadId`。

REST 示例：

```javascript
const threadList = new ThreadListAdapter({
    list:      () => fetch("/api/threads").then(r => r.json()),
    new:       (firstMessage) => fetch("/api/threads", {
                   method: "POST",
                   headers: { "Content-Type": "application/json" },
                   body: JSON.stringify(firstMessage)
               }).then(r => r.json()),
    delete:    (threadId) => fetch(`/api/threads/${threadId}`, { method: "DELETE" }),
    archive:   (threadId) => fetch(`/api/threads/${threadId}/archive`, { method: "POST" }),
    unarchive: (threadId) => fetch(`/api/threads/${threadId}/unarchive`, { method: "POST" })
});
```
