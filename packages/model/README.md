# [@auipage/model](https://github.com/handless-ui/auipage)

OpenAI 风格 `chat/completions` 的零依赖封装：请求拼装、SSE 增量解析、`tool_calls` 切片拼接、`<think>` 标签剥离，一次给你收好。

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

## 它解决什么

直接对着 `chat/completions` 写流式解析，会卡在这几件事上：

- `data:` 事件要逐条切，`[DONE]` 要单独认；
- `delta.content` 是增量，得自己累积才能拿到完整文本；
- `tool_calls` 按 `index` 分片到达，`arguments` 是半个 JSON，要拼完再 `parse`；
- DeepSeek 这类模型的 `reasoning_content` 和 `<think>` 标签要单独处理。

这些都不该由业务代码反复实现。

## 30 秒例子

```javascript
import { Model } from "@auipage/model";

const model = new Model({
    model: "qwen3.5",
    apiKey: "ollama",                              // 本地 ollama 不校验
    baseURL: "http://localhost:11434/v1"           // 请求时拼 /chat/completions
});

const { content, tool_calls } = await model.completions(
    {
        messages: [{ role: "user", content: "用一句话介绍 JavaScript" }],
        stream: true
    },
    delta => process.stdout.write(delta),          // 正文增量
    think => process.stdout.write("[思考] " + think) // 推理增量
);

console.log("\n完整文本：", content);
console.log("工具调用：", tool_calls);
```

换成 DeepSeek、OpenAI 或任何兼容服务，只改构造参数里的三个字段。

安装：

```bash
npm install --save @auipage/model
```

## 这个包不是必须的

| 你的情况 | 可以换成 | 会失去什么 |
| --- | --- | --- |
| 只接一家模型，功能简单 | 官方 SDK（`openai`、`@deepseek/sdk`） | 多一个依赖，但维护由官方负责 |
| 已经用 Vercel AI SDK | `@ai-sdk/openai` + `streamText` | 生态更全，但抽象层更厚 |
| 想完全掌控 | 原生 `fetch` + 自己解析 SSE | 上面四件脏活得自己写 |
| 只用非流式 | 原生 `fetch` 一次 POST | 没有增量回调，但代码最短 |

它适合“**想零依赖、又要一个能直接跑的 OpenAI 兼容客户端**”的场景。如果你已经在用某家的官方 SDK，没有必要为了统一而换掉。

## 它在哪一环

```
fetch ← model ← agent
```

`@auipage/agent` 在它之上做工具循环。完整签名与返回结构见 [model 参考](https://handless-ui.github.io/auipage/packages/model.html)。

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
