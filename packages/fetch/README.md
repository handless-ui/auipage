# [@auipage/fetch](https://github.com/handless-ui/auipage/packages/fetch/README.md)

跨端流式 fetch：Node 下走 `http`/`https`，浏览器下走原生 `fetch` + `ReadableStream`，自动适配；SSE 响应自动按事件缓冲解析。

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

<img src="https://nodei.co/npm/@auipage/fetch.png?downloads=true&amp;downloadRank=true&amp;stars=true" alt="NPM">

## 安装

```
npm install --save @auipage/fetch
```

## 用法

```javascript
import fetch from "@auipage/fetch";

fetch({
    url: "https://example.com/api/chat",
    method: "POST",            // 默认 GET
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello" }) // 原样发送，不会自动 stringify
})
.then(res => {
    res.on("data", chunk => console.log(chunk));
    res.on("end", () => console.log("done"));
    res.on("error", err => console.error(err));
})
.catch(err => {
    // 参数校验失败、请求初始化失败
    console.error(err);
});
```

`res` 上还可以读取 `res.status`、`res.ok`（2xx 为 true）、`res.headers`。

## 事件

| 事件 | 触发时机 | 回调参数 |
| --- | --- | --- |
| `data` | 收到一段数据；SSE 模式下为每个完整事件的 `data:` 字段内容 | `(payload: string)` |
| `end` | 响应体读取完毕 | `()` |
| `error` | 网络或读取出错 | `(err: Error)` |

## SSE 模式

响应头 `Content-Type` 含 `text/event-stream` 时自动开启，无需配置：

- 内部按空行（`\n\n`，也兼容 CRLF 的 `\r\n\r\n`）缓冲切分事件，跨 chunk 的事件会自动拼接；
- `data` 回调拿到的是去掉 `data: ` 前缀的**字符串**，不会自动 `JSON.parse`；
- 非 SSE 响应行为不变，`data` 收到的是原始 chunk。

## 注意

- 非 2xx 状态码不会进 `catch`，用 `res.status` / `res.ok` 判断。
- 暂不支持超时与取消。

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
