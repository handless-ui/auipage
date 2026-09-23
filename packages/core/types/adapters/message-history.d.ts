/**
 * MessageHistoryAdapter：历史消息的加载与追加
 */
import type { MaybePromise } from "@auipage/types";
import type { HistoryMessageGroup } from "../message.js";
import type { AuiPage } from "../auipage.js";

/** 加载指定会话的历史消息组；返回假值时 AuiPage 跳过历史加载 */
export type MessageHistoryLoad = (
    threadId: string
) => MaybePromise<HistoryMessageGroup[] | void | null | undefined>;

/** 把一轮消息组追加到指定会话 */
export type MessageHistoryAppend = (
    threadId: string,
    message: HistoryMessageGroup
) => MaybePromise<void>;

export interface MessageHistoryAdapterOptions {
    load?: MessageHistoryLoad;
    append?: MessageHistoryAppend;
}

export declare class MessageHistoryAdapter {
    constructor(options?: MessageHistoryAdapterOptions);

    /** 实例名，AuiPage 按它去掉 Adapter 后缀后挂载；子类可覆盖 */
    name: string;

    load: MessageHistoryLoad;
    append: MessageHistoryAppend;

    /** 被 AuiPage 挂载后写入的反向引用 */
    aui?: AuiPage;
}
