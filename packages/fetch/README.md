# [@auipage/fetch](https://github.com/handless-ui/auipage)

同一份流式请求代码，浏览器和 Node 都能跑：浏览器走原生 `fetch` + `ReadableStream`，Node 走 `http` / `https`，SSE 响应自动按事件切分。没有运行时依赖。

<p>
    <a href="https://zxl20070701.github.io/toolbox/#/npm-download?packages=@auipage/fetch&interval=7">
        <img src="https://img.shields.io/npm/dm/@auipage/fetch.svg" alt="downloads">
    </a>
    <a href="https://www.npmjs.com/package/@auipage/fetch">
        <img src="https://img.shields.io/npm/v/@auipage/fetch.svg" alt="npm">
    </a>
    <a href="https://github.com/handless-ui/auipage" target='_blank'>
        <img alt="GitHub repo stars" src="https://img.shields.io/github/stars/handless-ui/auipage?style=social">
    </a>
</p>

## 它解决什么

流式请求本身不难，难的是三端一致：

- 浏览器有 `fetch` 和 `ReadableStream`，Node 没有，得换 `http.request`；
- SSE 的事件边界会跨 chunk，`data:` 前缀要自己剥，`\r\n\r\n` 也得兼容；
- 回调式 API 和 `AsyncGenerator` 之间要来回包一层。

不做这些，你的每个流式接口都得写两套读取逻辑，再各自踩一遍切包问题。

## 30 秒例子

```javascript
import { fetch } from "@auipage/fetch";

const res = await fetch({
    url: "https://example.com/api/chat",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello" })   // 原样发送，不会自动 stringify
});

res.on("data", payload => {
    // SSE 响应时，payload 是已经剥掉 "data: " 的字符串
    console.log(payload);
});

res.on("end", () => console.log("done"));
res.on("error", err => console.error(err));

console.log(res.status, res.ok, res.headers);
```

非 2xx 不会进 `catch`，用 `res.status` / `res.ok` 判断——和原生 `fetch` 的习惯一致。

安装：

```bash
npm install --save @auipage/fetch
```

## 这个包不是必须的

| 你的情况 | 可以换成 | 会失去什么 |
| --- | --- | --- |
| 只在浏览器里跑 | 原生 `fetch` + `response.body.getReader()` | 要自己写 SSE 切包与 `\r\n` 兼容 |
| 只在 Node 里跑 | `undici` / `axios` / 原生 `http` | 仍要自己处理事件边界 |
| 用官方 SDK | `openai`、`@deepseek/sdk` 等 | 流式解析被 SDK 接管，但多一个依赖、少一层掌控 |
| 只要一次性请求 | 原生 `fetch` 就够了 | 没有流式能力 |

它的价值只在“**同一份读取代码要跑在两端**”时体现。单端项目，原生方案完全够用。

## 它在哪一环

```
fetch ← model ← agent
```

`@auipage/model` 用它发 `chat/completions` 请求。完整接口见 [fetch 参考](https://handless-ui.github.io/auipage/packages/fetch.html)。

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
