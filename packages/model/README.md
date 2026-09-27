# [@auipage/model](https://github.com/handless-ui/auipage/packages/model/README.md)

OpenAI 风格 `chat/completions` 的流式封装：负责请求拼装、SSE 增量解析、工具调用切片拼接，兼容同协议的其他模型服务（DeepSeek 等）。

<p>
    <a href="https://zxl20070701.github.io/toolbox/#/npm-download?packages=@auipage/model&interval=7">
        <img src="https://img.shields.io/npm/dm/@auipage/model.svg" alt="downloads">
    </a>
    <a href="https://www.npmjs.com/package/@auipage/model">
        <img src="https://img.shields.io/npm/v/@auipage/model.svg" alt="npm">
    </a>
    <a href="https://github.com/handless-ui/auipage" target='_blank'>
        <img alt="GitHub repo stars" src="https://img.shields.io/github/stars/handless-ui/auipage?style=social">
    </a>
</p>

<img src="https://nodei.co/npm/@auipage/model.png?downloads=true&amp;downloadRank=true&amp;stars=true" alt="NPM">

## 安装

```
npm install --save @auipage/model
```

## 创建实例

```javascript
import { Model } from "@auipage/model";

const model = new Model({
    model: "deepseek-chat",                    // 模型名
    apiKey: "your-api-key",
    baseURL: "https://api.deepseek.com/v1"     // 请求时拼接 /chat/completions
});
```

## completions

```typescript
model.completions(
    {
        messages: ChatMessage[],   // OpenAI 格式消息
        tools?: Tool[],            // 可选，默认 []；自动取每项的 description 作为 tools 提交
        stream?: boolean           // 默认 false
    },
    logback?,    // (delta: string) => void，正文增量回调
    thinkback?   // (reasoning: string) => void，推理过程回调
): Promise<{ content: string, tool_calls: ModelToolCall[] }>
```

- `thinkback` 接收 `delta.reasoning` / `delta.reasoning_content`；正文中的 `<think>...</think>` 标签会被剥除，剩余内容并入 `content`。
- `stream: false` 时两个回调仍会调用，只是在响应结束后各触发一次。
- 返回的 `tool_calls` 已按 `id` 切片、拼好 `function.arguments`。

## 示例

```javascript
model.completions({
    messages: [
        { role: "system", content: "你是一个助手。" },
        { role: "user", content: "查一下南京今天的天气" }
    ],
    tools: [
        {
            description: {
                type: "function",
                function: {
                    name: "getWeather",
                    description: "查询指定城市的天气",
                    parameters: {
                        type: "object",
                        properties: { city: { type: "string" } },
                        required: ["city"]
                    }
                }
            }
        }
    ],
    stream: true
}, (chunk) => {
    process.stdout.write(chunk);       // 正文增量
}, (reasoning) => {
    console.log("[think]", reasoning); // 推理增量
}).then(({ content, tool_calls }) => {
    console.log(content, tool_calls);
});
```

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
