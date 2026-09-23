/**
 * ChatContentRuntime：对话内容的渲染钩子
 */
import type {
    ChatContentMessage,
    ContentPart,
    ToolCallContentPart
} from "../message.js";
import type { AuiPage } from "../auipage.js";

/** 初始化 / 重建整个对话区域 */
export type ChatInitHandler = (messages: ChatContentMessage[]) => void;

/**
 * 文本分段的流式更新函数：
 * append 创建文本节点时返回它，后续增量分片不再调用 append，而是调用它。
 */
export type TextStreamUpdater = (deltaText: string) => void;

/**
 * 工具节点的“结束回调”：
 * tool-call 的 pending 片段调用 append 时返回它并按 id 缓存，
 * 在工具 success / error（或前端工具 render 交互）时被调用。
 *
 * 带 render 的前端工具会调用两次：
 *   1. 入参携带 render，其返回值（可 Promise）作为 UI 交互结果；
 *   2. 入参携带 UI 交互结果，用于最终渲染。
 */
export type ToolEndCallback = (data: ToolCallContentPart) => unknown;

/** append 的合法返回值：文本更新函数 / 工具结束回调 / 不返回 */
export type ChatAppendReturn =
    | TextStreamUpdater
    | ToolEndCallback
    | void
    | undefined;

/**
 * 渲染一个消息片段：
 * - 用户消息：每个片段调用一次，返回值被忽略；
 * - 文本类流式片段：分段开始时调用，返回更新函数接收后续增量；
 * - tool-call 的 pending：调用一次创建工具节点，返回结束回调。
 */
export type ChatAppendHandler = (
    role: string,
    part: ContentPart
) => ChatAppendReturn;

export interface ChatContentRuntimeOptions {
    init?: ChatInitHandler;
    append?: ChatAppendHandler;
}

export declare class ChatContentRuntime {
    constructor(options?: ChatContentRuntimeOptions);

    /** 实例名，AuiPage 按它去掉 Runtime 后缀后挂载；子类可覆盖 */
    name: string;

    init: ChatInitHandler;
    append: ChatAppendHandler;

    /** 被 AuiPage 挂载后写入的反向引用 */
    aui?: AuiPage;
}
