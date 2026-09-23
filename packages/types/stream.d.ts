/**
 * 对话流式事件协议。
 *
 * 服务端（如 @auipage/agent 的 CreateTool）通过 SSE 下发事件，
 * 页面端（@auipage/core 的 AuiPage）消费事件；ChatTransportAdapter 产出的
 * 也是同一套片段结构。
 */

import type { ToolResultStatus } from "./tool.js";

/** 工具调用状态：开始 / 成功 / 失败 */
export type ToolCallStatus = "pending" | "success" | "error";

/** 工具执行位置：页面端执行 / 服务端执行 */
export type ToolCallSide = "frontend" | "backend";

/**
 * 文本类事件类型。
 * text / thinking 一般由服务端下发，loading 通常由页面本地产生（如“思考中”占位）；
 * 同类型连续事件会被页面按增量拼接。
 */
export type TextStreamType = "text" | "thinking" | "loading";

/** 文本类事件，text 为本次增量文本（不是累计全文） */
export interface TextStreamEvent {
    type: TextStreamType;
    text: string;
}

/**
 * 工具调用事件，字段随调用进度逐步补齐。
 *
 * - pending：调用开始。前端工具由页面执行并回传结果，后端工具等待后续事件；
 * - success / error：调用结束，携带 result（异常时 result 为错误对象）。
 */
export interface ToolCallEvent {
    type: "tool-call";
    status: ToolCallStatus;
    /** 单次工具调用的唯一标识，回传结果时需原样带回 */
    id: string;
    /** 工具名，对应 ToolDescription.function.name */
    name: string;
    /** 在页面端还是服务端执行 */
    caller: ToolCallSide;
    /** 模型解析出的入参 */
    args: Record<string, unknown>;
    /** success / error 时携带的执行结果，pending 时缺省 */
    result?: unknown;
}

/** 对话流中可能出现的全部事件类型 */
export type StreamEvent = TextStreamEvent | ToolCallEvent;

/**
 * 前端工具执行完成后，页面回传给服务端的载荷
 * （ChatTransportAdapter.response("tool-result", payload) 的第二参）。
 * 服务端据此唤醒挂起的工具调用。
 */
export interface ToolResultPayload {
    /** 对应 pending 事件中的 id */
    id: string;
    status: ToolResultStatus;
    /** 回传给模型的结果；有 render 时为 render 的返回值 */
    result: unknown;
}

/**
 * 消息片段的宽松基类型，用于适配器自定义扩展。
 *
 * 标准片段请直接使用 TextStreamEvent / ToolCallEvent；自定义片段至少携带 type，
 * AuiPage 无法识别的类型会被忽略。
 */
export interface MessagePart {
    type: string;
    text?: string;
    [key: string]: unknown;
}
