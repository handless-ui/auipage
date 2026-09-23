/**
 * 页面侧的消息 / 内容片段类型（UI 渲染与历史入库使用）
 */
import type { ToolCallSide, ToolCallStatus } from "@auipage/types";
import type { ToolRender } from "./tool.js";

/** 文本类片段类型：正文 / 思维链 / 加载提示 */
export type TextContentType = "text" | "thinking" | "loading";

/** 文本类内容片段，同类型连续片段按增量拼接 */
export interface TextContentPart {
    type: TextContentType;
    /** 本次增量文本 */
    text: string;
}

/**
 * 工具调用内容片段。
 *
 * - 流中 pending 时携带 id / name / caller / args；
 * - success / error 时补齐 result / status；
 * - 带 render 的前端工具，运行时回调中还会带 render，落库时另存 ui 字段。
 */
export interface ToolCallContentPart {
    type: "tool-call";
    /** 单次工具调用唯一标识（落库片段可能缺省） */
    id?: string;
    name: string;
    caller?: ToolCallSide;
    args?: Record<string, unknown>;
    status?: ToolCallStatus;
    result?: unknown;
    /** 仅在带 render 的前端工具、通知运行时做 UI 交互时存在 */
    render?: ToolRender;
    /** 带 render 的前端工具落库时，记录 UI 交互环节的状态与结果 */
    ui?: {
        status: ToolCallStatus;
        result: unknown;
    };
}

/** 页面消费的全部内容片段；允许业务侧扩展自定义片段 */
export type ContentPart =
    | TextContentPart
    | ToolCallContentPart
    | { type: string; [key: string]: unknown };

/** 一条页面消息（与发给模型的线上消息区分：content 是富片段数组） */
export interface ChatContentMessage {
    role: string;
    content: ContentPart[];
}

/**
 * 历史消息组：一轮入站/出站消息的集合，
 * MessageHistory.load 返回其数组，append 每次写入一组。
 */
export interface HistoryMessageGroup {
    messages: ChatContentMessage[];
}
