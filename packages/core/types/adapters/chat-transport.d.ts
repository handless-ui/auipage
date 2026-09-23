/**
 * ChatTransportAdapter：对接模型对话接口
 */
import type { ToolDescription } from "@auipage/types";
import type {
    ChatContentMessage,
    ContentPart,
    HistoryMessageGroup
} from "../message.js";
import type { AuiPage } from "../auipage.js";

/** run 的入参 */
export interface ChatTransportRunParams {
    /** 本轮新发送的消息（当前实现中只有一条） */
    messages: ChatContentMessage[];
    context: {
        /** 当前会话已入库的历史消息组 */
        history: HistoryMessageGroup[];
        /** AuiPage 构造时注册的工具描述 */
        tools: Array<{ description: ToolDescription }>;
    };
}

/**
 * 发起一轮对话并返回异步生成器，逐个 yield 消息片段；
 * 返回假值时 AuiPage 会直接终止本轮处理。
 */
export type ChatTransportRun = (
    params: ChatTransportRunParams
) => AsyncGenerator<ContentPart, void, void> | void | null | undefined;

/**
 * 页面 → 服务端的反向回传通道。
 * 目前仅用于前端工具结果回传：response("tool-result", { id, status, result })。
 */
export type ChatTransportResponse = (
    name: string,
    data: Record<string, unknown>
) => unknown;

export interface ChatTransportAdapterOptions {
    run?: ChatTransportRun;
    response?: ChatTransportResponse;
}

export declare class ChatTransportAdapter {
    constructor(options?: ChatTransportAdapterOptions);

    /** 实例名，AuiPage 按它去掉 Adapter 后缀后挂载；子类可覆盖 */
    name: string;

    run: ChatTransportRun;
    response: ChatTransportResponse;

    /** 被 AuiPage 挂载后写入的反向引用 */
    aui?: AuiPage;
}
