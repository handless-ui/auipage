# AuiPage

`AuiPage` 是 `@auipage/core` 的入口类，把 Adapter（数据侧）和 Runtime（UI 侧）粘合起来，维护当前会话、消息历史与流式对话状态。

## 构造

```javascript
import { AuiPage } from "@auipage/core";

const page = new AuiPage({
    adapter: {
        ChatTransport:  chatTransport,    // ChatTransportAdapter 实例
        MessageHistory: messageHistory,   // MessageHistoryAdapter 实例
        ThreadList:     threadList        // ThreadListAdapter 实例
    },
    runtime: {
        ThreadList:  threadListUI,        // ThreadListRuntime 实例
        ChatContent: chatUI               // ChatContentRuntime 实例
    },
    tools: []                             // 可选：页面侧工具列表，没有工具时可省略
});
```

实例按 `name` 属性去后缀挂载：基类构造时内置 `name`，如 `ChatTransportAdapter` → `page.adapter.ChatTransport`，`ThreadListRuntime` → `page.runtime.ThreadList`。自定义子类可通过覆盖 `name` 改变挂载位置。挂载后每个实例上会写入 `aui` 反向指向页面实例。

构造后立即调用 `adapter.ThreadList.list()`，结果传给 `runtime.ThreadList.init()` 完成首次渲染。

## 实例属性

| 属性 | 说明 |
| --- | --- |
| `adapter` | 按 `name` 映射后的适配器集合 |
| `runtime` | 按 `name` 映射后的运行时集合 |
| `tools_execute` | 工具名 → `execute` |
| `tools_render` | 工具名 → `render`（可能为 `undefined`） |
| `tools_description` | `[{ description }]`，作为 `context.tools` 传给 `ChatTransport.run` |
| `isExecuting` | 当前是否处于对话执行中；执行中重复发消息会被拒绝、切换会话会被忽略 |
| `currentThreadId` | 当前会话 ID，`undefined` 表示新建会话状态 |
| `currentMessages` | 当前会话的历史消息组（`HistoryMessageGroup[]`） |

## sendMessage(message)

方法返回 `Promise<void>`：上一轮对话尚未结束时调用，会以 `"当前正在执行中"` reject；本轮全部走完（含历史落库）后 resolve。流程如下：

1. 把 `message.content` 逐段交给 `runtime.ChatContent.append` 渲染；
2. 调用 `adapter.ChatTransport.run({ messages: [message], context: { history, tools } })`，返回值需为 `AsyncGenerator`，假值则直接中止；
3. 逐个消费流片段：`text / thinking / loading` 做增量拼接，`tool-call` 走工具流程，未知类型忽略；
4. 流结束后合并相邻同角色片段；没有当前会话时调 `adapter.ThreadList.new()`（返回假值则中止本轮），再 `runtime.ThreadList.append` 并激活新会话；
5. 消息追加到 `currentMessages`，调 `adapter.MessageHistory.append()` 落库。

#### 工具调用流程（tool-call）

流片段形如 `{ id, name, caller, args, status, result? }`：

- **pending**：先调 `runtime.ChatContent.append("assistant", part)` 创建工具节点，返回值按 `id` 缓存为结束回调。
- **前端工具**（`caller: "frontend"`）：页面侧执行 `tools_execute[name](args)`（抛错记为 `error`）：
  - 无 `render`：用 `{ ...part, result, status }` 调结束回调，并经 `adapter.ChatTransport.response("tool-result", { id, status, result })` 回传服务端；
  - 有 `render`：结束回调会被调两次——第一次传 `{ ...part, result, status, render }`，由运行时执行 UI 交互并返回界面结果 `result_ui`；第二次传 `{ ...part, result: result_ui, status: status_ui }` 做最终渲染。回传给模型的是 `result_ui`，历史中同时保留 `result` 与 `ui: { status, result }`。
- **后端工具**（`caller: "backend"`）：页面不执行，等流中后续的 `success / error` 片段（携带 `result`）到达后调结束回调，无需回传。

```javascript
page.sendMessage({
    role: "user",
    content: [{ type: "text", text: "你好" }]
}).catch(err => {
    // err === "当前正在执行中"：上一轮对话还没结束
});
```

## 其他方法

| 方法 | 行为 |
| --- | --- |
| `activeThread(threadId, noLoad?)` | 切换会话：更新高亮，`threadId` 为 `undefined` 时清空消息；否则调 `MessageHistory.load()` 加载历史并 `ChatContent.init()`。对话执行中调用会被直接忽略。`noLoad` 为内部参数（新建会话后跳过重载），业务侧不用传 |
| `newThread()` | 等价于 `activeThread(undefined)` |
| `deleteThread(threadId)` | 调 adapter 删除后同步 UI；删除的是当前会话则进入新建状态 |
| `archiveThread(threadId)` | 同上，走归档；归档当前会话也进入新建状态 |
| `unarchiveThread(threadId)` | 取消归档，只同步 UI，不自动切换会话 |

## 任务生命周期事件

`AuiPage` 暴露两个任务级生命周期事件，用于在 `sendMessage` 驱动的整轮对话内挂副作用（例如"新任务来了清掉旧的推荐问""自然完成才追加新推荐问"）。

### 事件名

| 事件 | 触发时机 |
| --- | --- |
| `task:start` | `sendMessage` 通过"执行中"校验后立即触发 |
| `task:end` | 本轮对话结束时触发，包括：自然走完、流式过程出错 |

### 订阅与解绑

```javascript
const off = page.on("task:end", (payload) => {
    if (payload.status === "complete") showRecommendedQuestions();
});

// 不再需要时
page.off("task:end", off);
```

- 同名事件可注册多个 handler，按注册顺序串行触发；
- handler 内部抛错被吞掉，不会影响 `sendMessage` 的主流程与 Promise 状态；
- `on / off` 均链式返回 `AuiPage` 实例。

### 回调载荷

```typescript
type TaskLifecyclePayload = {
    taskId: string;              // 本次 sendMessage 自增生成的唯一 id
    threadId: string | undefined; // 任务发起时所处的会话 id，新建会话场景为 undefined
    message: ChatContentMessage; // 本次发送的原始页面消息
};

// task:end 在上面基础上多一个 status
type TaskEndPayload = TaskLifecyclePayload & {
    status: "complete" | "error";
};
```

| `status` | 含义 | 是否入库 |
| --- | --- | --- |
| `complete` | 流自然走完 | 是 |
| `error` | 流式过程抛错 | 否 |

### 推荐问场景示例

```javascript
// 新任务一来就清掉旧的推荐问
page.on("task:start", () => removeRecommendedQuestions());

// 只有自然完成才追加推荐问；error 不追加
page.on("task:end", ({ status, threadId }) => {
    if (status === "complete") {
        fetchRecommendedQuestions(threadId).then(render);
    }
});
```

## 消息结构

```typescript
// 文本类片段，text 必须是增量文本，拼接由 AuiPage 完成
type TextPart = {
    type: "text" | "thinking" | "loading",
    text: string
};

// 工具调用片段，字段随调用进度逐步补齐
type ToolCallPart = {
    type: "tool-call",
    id: string,
    name: string,
    caller: "frontend" | "backend",
    args: object,
    status: "pending" | "success" | "error",
    result?: any,
    render?: Function
};

// 页面侧消息（与发给模型的 ChatMessage 区分：role 放宽为 string，content 是富片段数组）
type ChatContentMessage = {
    role: string,
    content: ContentPart[]
};

// MessageHistory.load() 的返回单元，通常含一轮 user + assistant
type HistoryMessageGroup = {
    messages: ChatContentMessage[]
};

// ThreadList.new() 返回的会话对象，至少含 threadId
type Thread = {
    threadId: string,
    title?: string
};
```

工具调用落库时片段固定为 `{ type: "tool-call", name, args, result, status }`；带 `render` 的前端工具额外含 `ui: { status, result }`。

相关：[Adapter](./adapters.md) · [Runtime](./runtimes.md) · [defineTool](./define-tool.md) · [generator](./generator.md) · [快速上手](./quick-start.md)
