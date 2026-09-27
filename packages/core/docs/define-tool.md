# defineTool

定义页面侧（前端）工具的小工厂，等价于手写 `{ description: { type: "function", function: {...} }, execute, render }`，只是省掉嵌套包装。

## 签名

```typescript
defineTool(options: {
    name: string,        // 工具名，模型据此调用，同批工具内唯一
    description: string, // 给模型看的功能说明
    parameters: object,  // JSON Schema
    execute?: (args: object) => any | Promise<any>,
    render?:  (data: { args: object, result: any, status: string }) => any | Promise<any>
}): Tool
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` / `description` / `parameters` | 是 | 组装进 `description.function` |
| `execute(args)` | 否 | 页面侧执行，抛错会被捕获并记为 `status: "error"` |
| `render(data)` | 否 | `execute` 完成后的 UI 交互（弹窗确认、表单补充等），返回值才是回传给模型的最终结果 |

## 注册后的流转

工具经 `new AuiPage({ tools })` 注册（`tools` 可选，无工具时省略即可）：

1. `description` 收入 `tools_description`，随 `context.tools` 发给服务端；
2. 流中出现 `caller: "frontend"` 的 `tool-call` 时，页面执行 `execute`；
3. 有 `render` 时，`execute` 结果先交给它做 UI 交互，其返回值经 `ChatTransport.response("tool-result", ...)` 回传服务端。

完整时序见 [AuiPage 工具调用流程](./auipage.md#工具调用流程tool-call)，渲染约定见 [Runtime](./runtimes.md#append-与工具节点tool-call)。

## 示例

```javascript
import { defineTool } from "@auipage/core";

export default defineTool({
    name: "showPlain",
    description: "显示文本文件中的内容",
    parameters: {
        type: "object",
        properties: {
            content: { type: "string", description: "需要显示的文本内容" }
        },
        required: ["content"]
    },
    async execute(args) {
        return args.content;        // 拿到原始结果
    },
    async render({ result }) {
        alert(result);              // 在 UI 上展示
        return "显示成功";           // 这才是回传给模型的结果
    }
});
```

## 与 @auipage/agent 的关系

模型看到的工具集合由服务端 Agent 组装：页面把 `context.tools` 发给服务端，服务端用 `CreateTool` 包装这些描述（无 `execute` → `caller: "frontend"`，调用时挂起并经 SSE 推 `pending` 给页面）；页面执行完再把结果 POST 回去唤醒调用。自带 `execute` 的工具在服务端执行，标记为 `caller: "backend"`，页面只渲染状态。协议细节见 `@auipage/agent` README 的「前后端工具桥接」。

注意：省略 `execute` 只在 `CreateTool` 桥接场景下合法；直接本地跑 Agent 时，无 `execute` 的工具执行会报错。
