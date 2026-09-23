# [@auipage/agent](https://github.com/handless-ui/auipage/packages/agent/README.md)

智能体对话循环：在 `@auipage/model` 之上处理多轮工具调用（模型要调工具 → 执行 → 结果回灌模型 → 继续生成），并提供 `CreateTool` 把服务端工具调用桥接到浏览器页面执行。

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

<img src="https://nodei.co/npm/@auipage/agent.png?downloads=true&amp;downloadRank=true&amp;stars=true" alt="NPM">

## 安装

```
npm install --save @auipage/agent
```

## 基本用法

```javascript
import { Agent } from "@auipage/agent";

const agent = new Agent({
    model: {
        model: "gpt-4o-mini",
        apiKey: "your-api-key",
        baseURL: "https://api.openai.com/v1"
    },
    systemPrompt: "你是一个简洁、乐于助人的助手。"
});

const answer = await agent.generate([
    { role: "user", content: "用一句话介绍 JavaScript" }
]);
```

`generate(messages, logback?, thinkback?)`：

- `messages` 为消息数组；构造时配置了非空 `systemPrompt` 才会插到队首作为 `system` 消息（会原地修改传入的数组）。
- `logback(delta)`：流式正文增量回调。
- `thinkback(reasoning)`：推理过程增量回调。
- 返回 `Promise<string | undefined>`；模型整轮只产出工具调用、没有正文时为 `undefined`。

## 注册工具

工具是 `{ description, execute }` 对象：`description` 遵循模型的 tools 描述规范，`execute(args)` 在服务端执行，可同步可返回 `Promise`，模型返回的参数会解析后传入。

```javascript
const getWeather = {
    description: {
        type: "function",
        function: {
            name: "getWeather",
            description: "查询指定城市的天气",
            parameters: {
                type: "object",
                properties: {
                    city: { type: "string", description: "城市名称，例如：南京" }
                },
                required: ["city"]
            }
        }
    },
    execute({ city }) {
        return `${city} 今天晴，25°C`;   // 也可以 return fetch(...).then(...)
    }
};

const agent = new Agent({
    model: { /* 同上 */ },
    systemPrompt: "你可以使用 getWeather 查询天气。",
    tools: [getWeather]
});

const answer = await agent.generate([
    { role: "user", content: "南京今天天气怎么样？" }
]);
```

模型决定调用工具时，Agent 按名找到工具执行，把结果作为 `tool` 消息回灌模型继续生成，直到拿到最终回复。

## 前后端工具桥接（CreateTool）

Agent 跑在服务端、部分工具需要浏览器执行时，用 `CreateTool` 包装。它接收一个有 `send(data)` 方法的消息流（如 `@auipage/core` 的 `MessageStream`），在工具执行节点把事件推给页面，并支持页面把结果回传唤醒挂起的调用。

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
        // 后端工具：带 execute，在服务端执行
        ct.create({
            description: { /* ... name: "readPlain" */ },
            execute({ filepath }) {
                return readFile(filepath);
            }
        }),
        // 前端工具：不带 execute，调用挂起，等页面回传结果
        ct.create({
            description: { /* ... name: "showPlain" */ }
        })
    ]
});
```

`ct.create(tool)` 返回标准的 `{ description, execute }`，按是否传 `execute` 分两类：

- **后端工具**（`caller: "backend"`）：执行前推 `pending`，结束后在同一事件上补 `success` / `error` 和 `result`。

  ```javascript
  { type: "tool-call", status: "pending",  id, name, caller: "backend", args }
  { type: "tool-call", status: "success",  id, name, caller: "backend", args, result }
  ```

- **前端工具**（`caller: "frontend"`）：只推 `pending`，本次调用返回一个 Promise 挂起。页面处理完后把 `{ id, result }` 发回服务端，由服务端调用 `globalThis[id](result)` 唤醒，对话才继续：

  ```javascript
  if (globalThis[data.id]) {
      globalThis[data.id](data.result);
      delete globalThis[data.id];
  }
  ```

不走 `CreateTool` 时请直接传带 `execute` 的普通工具；没有 `execute` 的工具只在桥接场景下合法，否则执行会报错。

## 配置

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | `{ model, apiKey, baseURL }` | 是 | 透传给 `@auipage/model` |
| `systemPrompt` | `string` | 否 | 系统提示词，默认空字符串 |
| `stream` | `boolean` | 否 | 默认 `false` |
| `tools` | `AgentTool[]` | 否 | 工具列表，默认 `[]`；直接给 Agent 的工具必须带 `execute`，省略 `execute` 只在 `CreateTool` 桥接场景合法 |

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
