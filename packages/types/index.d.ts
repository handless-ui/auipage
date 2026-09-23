/**
 * @auipage/types —— auipage 各包共享的公开类型协议入口。
 *
 * 只收录跨包消费的类型，按领域分文件维护：
 * basic（基础）、model（模型配置）、message（模型消息）、
 * tool（工具）、stream（流式事件）。
 * 单个包私有的类型不要放在这里。
 */

/* ---------- 基础类型 ---------- */
export type { JsonValue, JsonObject, MaybePromise } from "./basic.js";

/* ---------- 模型配置 ---------- */
export type { ModelConfig } from "./model.js";

/* ---------- 模型对话消息 ---------- */
export type {
    ChatRole,
    ChatMessage,
    ModelToolCall,
    ToolCallFunction
} from "./message.js";

/* ---------- 工具协议 ---------- */
export type {
    JsonSchema,
    FunctionDescriptor,
    ToolDescription,
    ToolExecutor,
    ToolResultStatus,
    ToolRenderContext,
    ToolRenderFunction,
    Tool
} from "./tool.js";

/* ---------- 流式事件 ---------- */
export type {
    TextStreamType,
    TextStreamEvent,
    ToolCallStatus,
    ToolCallSide,
    ToolCallEvent,
    ToolResultPayload,
    StreamEvent,
    MessagePart
} from "./stream.js";
