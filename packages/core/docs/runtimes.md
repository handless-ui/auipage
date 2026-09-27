# Runtime

Runtime 负责 UI 侧：框架不绑定任何 UI 库，只在固定时机调用回调，方法缺省为空函数。挂载规则与 Adapter 相同：框架按实例的 `name` 属性去掉 `Runtime` 后缀挂载，基类已内置默认 `name`，子类可覆盖。回调里可通过 `this.aui`（或实例的 `aui`）访问页面，如 `threadListUI.aui.activeThread(id)`。

## ThreadListRuntime

会话列表（侧边栏）的渲染，共 6 个回调：

```typescript
new ThreadListRuntime({
    init:      (threads: Thread[]) => void,
    active:    (threadId: string | undefined) => void,
    append:    (thread: Thread) => void,
    delete:    (threadId: string) => void,
    archive:   (threadId: string) => void,
    unarchive: (threadId: string) => void
});
```

| 回调 | 时机 |
| --- | --- |
| `init` | `AuiPage` 构造后，传入 `ThreadList.list()` 的结果 |
| `active` | 切换会话；`undefined` 表示新建会话 |
| `append` | 首轮对话创建新会话后 |
| `delete` / `archive` / `unarchive` | 对应 adapter 方法成功后 |

原生 DOM 示例：

```javascript
const listEl = document.querySelector("#thread-list");
const nodes = new Map(); // threadId -> element

const threadListUI = new ThreadListRuntime({
    init: (threads) => {
        listEl.innerHTML = "";
        threads.forEach(renderOne);
    },
    active: (threadId) => {
        for (const [id, node] of nodes) {
            node.classList.toggle("active", id === threadId);
        }
    },
    append: renderOne,
    delete: (threadId) => {
        nodes.get(threadId)?.remove();
        nodes.delete(threadId);
    },
    archive:   (id) => nodes.get(id)?.classList.add("archived"),
    unarchive: (id) => nodes.get(id)?.classList.remove("archived")
});

function renderOne(thread) {
    const el = document.createElement("div");
    el.textContent = thread.title || thread.threadId;
    el.onclick = () => threadListUI.aui.activeThread(thread.threadId);
    listEl.appendChild(el);
    nodes.set(thread.threadId, el);
}
```

## ChatContentRuntime

对话内容的渲染，只有两个回调，但 `append` 的语义需要特别注意：

```typescript
new ChatContentRuntime({
    init:   (messages: ChatMessage[]) => void,   // 已拍平的消息片段数组
    append: (role: string, part: MessagePart) =>
        ((text: string) => void) | ((data: ToolCallPart) => any) | void
});
```

`init` 在切换会话时触发（新建会话时传 `[]`），业务侧需重建整个对话区域。

### append 的流式约定

- 用户消息的每个 content 片段、模型流中每个新分段的开始，各调用一次 `append`。
- 文本类片段（`text / thinking / loading`）：`append` 返回一个更新函数，后续增量通过它推送；返回 `undefined` 表示只建节点、不追加。同类型连续片段不会再次调用 `append`。

### append 与工具节点（tool-call）

`tool-call` 的 `pending` 片段没有 `text`，此时 `append` 的返回值是该工具的**结束回调**，按 `id` 缓存：

- **后端工具**：流中到来 `success / error` 时调用一次，入参为携带 `result` 的完整片段。
- **前端工具（无 `render`）**：页面执行完 `execute` 后调用一次。
- **前端工具（有 `render`）**：调用两次——第一次入参含 `render`，运行时在此执行 UI 交互并把返回值作为界面结果；第二次用界面结果做最终渲染。回传给模型的是 `render` 的返回值，`execute` 结果只作为它的入参和历史记录。

原生 DOM 示例：

```javascript
const chatEl = document.querySelector("#chat-content");

const chatUI = new ChatContentRuntime({
    init: (messages) => {
        chatEl.innerHTML = "";
        messages.forEach(({ role, content }) =>
            content.forEach(part => renderPart(role, part))
        );
    },
    append: (role, part) => {
        const node = renderPart(role, part);
        if (part.type === "text" || part.type === "thinking" || part.type === "loading") {
            // 返回更新函数：后续增量只更新这一个节点
            return (text) => {
                node.textContent += text;
                chatEl.scrollTop = chatEl.scrollHeight;
            };
        }
        // tool-call 等特殊片段：返回结束回调，或不返回
    }
});

function renderPart(role, part) {
    const el = document.createElement("div");
    el.className = `msg ${role} ${part.type}`;
    el.textContent = part.text || "";
    chatEl.appendChild(el);
    return el;
}
```

工具结束回调按 `id` 缓存到该工具 `success / error` 为止；文本更新函数只在当前分段内有效，不要跨分段复用。
