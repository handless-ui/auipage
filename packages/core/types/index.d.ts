/**
 * @auipage/core 类型入口
 *
 * “适配器 + 运行时”机制的核心抽象层：
 * 业务侧实现 Adapter 对接模型/存储，UI 侧实现 Runtime 负责渲染，
 * AuiPage 串联两者，统一处理会话、历史、流式对话与前后端工具调用。
 */

/* ---------- 核心类 ---------- */
export {
    AuiPage,
    type AuiPageOptions,
    type AuiPageAdapterSet,
    type AuiPageRuntimeSet
} from "./auipage.js";

/* ---------- 适配器 ---------- */
export {
    ChatTransportAdapter,
    type ChatTransportAdapterOptions,
    type ChatTransportRun,
    type ChatTransportRunParams,
    type ChatTransportResponse
} from "./adapters/chat-transport.js";
export {
    MessageHistoryAdapter,
    type MessageHistoryAdapterOptions,
    type MessageHistoryLoad,
    type MessageHistoryAppend
} from "./adapters/message-history.js";
export {
    ThreadListAdapter,
    type ThreadListAdapterOptions,
    type ThreadListList,
    type ThreadListNew,
    type ThreadIdHandler
} from "./adapters/thread-list.js";

/* ---------- 运行时 ---------- */
export {
    ThreadListRuntime,
    type ThreadListRuntimeOptions,
    type ThreadInitHandler,
    type ThreadActiveHandler,
    type ThreadAppendHandler,
    type ThreadIdUIHandler
} from "./runtimes/thread-list.js";
export {
    ChatContentRuntime,
    type ChatContentRuntimeOptions,
    type ChatInitHandler,
    type ChatAppendHandler,
    type ChatAppendReturn,
    type TextStreamUpdater,
    type ToolEndCallback
} from "./runtimes/chat-content.js";

/* ---------- 工具 ---------- */
export type {
    Tool,
    ToolRender,
    ToolRenderData,
    DefineToolOptions
} from "./tool.js";
export { default as defineTool } from "./define-tool.js";

/* ---------- 消息与会话 ---------- */
export type {
    TextContentType,
    TextContentPart,
    ToolCallContentPart,
    ContentPart,
    ChatContentMessage,
    HistoryMessageGroup
} from "./message.js";
export type { Thread } from "./thread.js";

/* ---------- 流工具 ---------- */
export {
    default as generator,
    type StreamProducer,
    type StreamNext,
    type StreamDone,
    type StreamError
} from "./generator.js";
export {
    MessageStream,
    type MessageSendHandler,
    type MessageEndHandler
} from "./message-stream.js";
