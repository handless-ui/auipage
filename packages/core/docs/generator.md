# generator

把回调式（`onData` / `onEnd` / `onError`）异步流转成 `AsyncGenerator`，常用来实现 `ChatTransportAdapter.run`。函数本身不含任何 auipage 业务概念，其他场景也能用。

## 签名

```typescript
generator(
    rawFun: (
        next:  (value: any) => void,  // 推送一个值，可多次调用，按顺序消费
        done:  () => void,            // 结束
        error: (err: any) => void     // 报错，消费者侧会抛出
    ) => void
): AsyncGenerator<any>
```

`rawFun` 会被立即执行。`done()` / `error()` 之后再调 `next()` 会被忽略。

## 示例：接入 @auipage/agent

Agent 的流式更新走 `logback` / `thinkback` 回调，用 `generator` 包一层即可产出 `AuiPage` 需要的消息片段（回调给出的就是增量文本，直接 `next`）：

```javascript
import { generator, ChatTransportAdapter } from "@auipage/core";
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

## 示例：任意回调式 API

```javascript
import { generator } from "@auipage/core";

const stream = generator((next, done, error) => {
    emitter.on("data", next);
    emitter.on("end", done);
    emitter.on("error", error);
});

for await (const chunk of stream) {
    console.log(chunk);
}
```

消费者提前 `break` 不会通知生产者；底层连接需要手动关闭。
