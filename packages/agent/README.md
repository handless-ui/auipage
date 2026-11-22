# [@auipage/agent](https://github.com/handless-ui/auipage)

智能体对话循环：模型要调工具 → 执行 → 结果回灌 → 继续生成，直到拿到最终回复。可选地把工具调用桥接到浏览器，让页面来执行。

<p>
    <a href="https://zxl20070701.github.io/toolbox/#/npm-download?packages=@auipage/agent&interval=7">
        <img src="https://img.shields.io/npm/dm/@auipage/agent.svg" alt="downloads">
    </a>
    <a href="https://www.npmjs.com/package/@auipage/agent">
        <img src="https://img.shields.io/npm/v/@auipage/agent.svg" alt="npm">
    </a>
    <a href="https://github.com/handless-ui/auipage" target='_blank'>
        <img alt="GitHub repo stars" src="https://img.shields.io/github/stars/handless-ui/auipage?style=social">
    </a>
</p>

## 它解决什么

单轮对话只是“发一条消息、收一段文本”。一旦模型会用工具，循环就变复杂了：

- 模型返回 `tool_calls` 后，要按名字找到工具、执行、把结果作为 `tool` 消息塞回消息列表；
- 一轮可能调多次工具，也可能调完还要继续调，循环什么时候停要判断对；
- 工具在服务端执行还是浏览器执行，两套路径要分开；
- 浏览器执行的工具，结果还得推回服务端，唤醒挂起的那次调用。

`@auipage/agent` 把循环和桥接都收进一个 `generate()`，你只需要描述工具。

## 30 秒例子

```javascript
import { Agent } from "@auipage/agent";

const getWeather = {
    description: {
        type: "function",
        function: {
            name: "getWeather",
            description: "查询指定城市的天气",
            parameters: {
                type: "object",
                properties: { city: { type: "string", description: "城市名称，例如：南京" } },
                required: ["city"]
            }
        }
    },
    execute({ city }) {
        return `${city} 今天晴，25°C`;   // 也可以 return fetch(...)
    }
};

const agent = new Agent({
    model: { model: "qwen3.5", apiKey: "ollama", baseURL: "http://localhost:11434/v1" },
    systemPrompt: "你可以使用 getWeather 查询天气。",
    tools: [getWeather]
});

const answer = await agent.generate([
    { role: "user", content: "南京今天天气怎么样？" }
]);

console.log(answer);   // 模型拿到工具结果后给出的最终回复
```

`generate(messages, logback?, thinkback?)`：

- `messages` 是 OpenAI 格式消息数组；构造时配了非空 `systemPrompt` 才会插到队首（**会原地修改数组**）；
- `logback(delta)` 收正文增量，`thinkback(reasoning)` 收推理增量；
- 返回 `Promise<string | undefined>`；整轮只有工具调用、没有正文时为 `undefined`。

安装：

```bash
npm install --save @auipage/agent
```

## 前后端工具桥接

工具需要浏览器执行时（比如展示文件、弹窗确认），用 `CreateTool` 包装一个有 `send()` 的消息流：

```javascript
import { Agent, CreateTool } from "@auipage/agent";
import { MessageStream } from "@auipage/core";

const ms = new MessageStream(
    data => res.write("data: " + JSON.stringify(data) + "\n\n"),
    () => res.end()
);
const ct = new CreateTool(ms);

const agent = new Agent({
    model: { /* 同上 */ },
    tools: [
        ct.create(readPlain),    // 带 execute：服务端执行
        ct.create(showPlain)     // 不带 execute：下发浏览器执行
    ]
});
```

- **后端工具**：推 `pending`，同一事件上补 `success` / `error` 和 `result`；
- **前端工具**：只推 `pending`，本次调用挂起；页面执行完把 `{ id, result }` POST 回来，服务端 `globalThis[id](result)` 唤醒，对话继续。

页面侧用 `@auipage/core` 的 `defineTool` 注册同名工具即可，详见 [defineTool 参考](https://handless-ui.github.io/auipage/packages/core-utils.html)。

## 这个包不是必须的

| 你的情况 | 可以换成 | 会失去什么 |
| --- | --- | --- |
| 工具都在服务端 | 官方 Agents SDK、LangChain、Vercel AI SDK | 生态更大，但抽象更重、依赖更多 |
| 只有一两个工具 | 自己写 `while` 循环（约 20 行） | 要自己处理 `tool_calls` 回灌和终止条件 |
| 不需要工具 | 直接用 `@auipage/model` 或官方 SDK | 少一层封装，代码更短 |
| 工具要在浏览器执行 | 自己做 SSE 推事件 + 结果回传 | 等价于重写 `CreateTool`，容易漏掉挂起与唤醒 |

它最独特的价值是 **`CreateTool` 的前后端桥接**：同一份工具描述，服务端和浏览器各执行各的部分。如果你的工具全在服务端，别的 Agent 框架同样好用。

## 配置

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | `{ model, apiKey, baseURL }` | 是 | 透传给 `@auipage/model` |
| `systemPrompt` | `string` | 否 | 默认空字符串 |
| `stream` | `boolean` | 否 | 默认 `false` |
| `tools` | `AgentTool[]` | 否 | 默认 `[]`；直接给 Agent 的工具必须带 `execute`，省略只在 `CreateTool` 场景合法 |

## 它在哪一环

```
fetch ← model ← agent
```

`@auipage/core` 的 `ChatTransportAdapter` 通常在里面调它。完整事件协议见 [agent 参考](https://handless-ui.github.io/auipage/packages/agent.html)。

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
