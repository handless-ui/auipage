# [@auipage/types](https://github.com/handless-ui/auipage/packages/types/README.md)

auipage 各包共用的 TypeScript 类型协议，零运行时代码、零依赖。只放跨包消费的类型，单包私有的类型放在各自包内。

<p>
    <a href="https://zxl20070701.github.io/toolbox/#/npm-download?packages=@auipage/types&interval=7">
        <img src="https://img.shields.io/npm/dm/@auipage/types.svg" alt="downloads">
    </a>
    <a href="https://www.npmjs.com/package/@auipage/types">
        <img src="https://img.shields.io/npm/v/@auipage/types.svg" alt="npm">
    </a>
    <a href="https://github.com/handless-ui/auipage" target='_blank'>
        <img alt="GitHub repo stars" src="https://img.shields.io/github/stars/handless-ui/auipage?style=social">
    </a>
</p>

<img src="https://nodei.co/npm/@auipage/types.png?downloads=true&amp;downloadRank=true&amp;stars=true" alt="NPM">

## 安装

```
npm install --save @auipage/types
```

一般不需要单独安装，它是其他 `@auipage/*` 包的依赖。

## 类型分组

按协议层次分为五组：

| 来源文件 | 导出类型 | 说明 |
| --- | --- | --- |
| `basic.d.ts` | `JsonValue` `JsonObject` `MaybePromise` | JSON 值与同步/异步联合类型 |
| `model.d.ts` | `ModelConfig` | 模型配置（`model` / `apiKey` / `baseURL`） |
| `message.d.ts` | `ChatRole` `ChatMessage` `ModelToolCall` `ToolCallFunction` | 发给模型 / 模型返回的对话消息（OpenAI 风格） |
| `tool.d.ts` | `JsonSchema` `FunctionDescriptor` `ToolDescription` `ToolExecutor` `ToolResultStatus` `ToolRenderContext` `ToolRenderFunction` `Tool` | 工具描述、执行/渲染函数与工具对象 |
| `stream.d.ts` | `TextStreamType` `TextStreamEvent` `ToolCallStatus` `ToolCallSide` `ToolCallEvent` `ToolResultPayload` `StreamEvent` `MessagePart` | 流式文本/工具事件、工具结果回传载荷、自定义片段基类型 |

使用时注意两层消息的区别：`message.d.ts` 描述模型线上消息（`content` 为文本）；页面流中渲染的富文本与工具片段是 `stream.d.ts` 中的事件类型。

```typescript
import type { ChatMessage, StreamEvent, Tool, ToolResultPayload } from "@auipage/types";
```

## 版权

MIT License

Copyright (c) [zxl20070701](https://zxl20070701.github.io/notebook/home.html) 走一步，再走一步
