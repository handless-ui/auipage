/**
 * ThreadListAdapter：会话列表的增删改查
 */
import type { MaybePromise } from "@auipage/types";
import type { HistoryMessageGroup } from "../message.js";
import type { Thread } from "../thread.js";
import type { AuiPage } from "../auipage.js";

/** 获取会话列表 */
export type ThreadListList = () => MaybePromise<Thread[]>;

/**
 * 创建新会话，入参为首轮消息组；
 * 返回假值时 AuiPage 中止本轮后续处理（不渲染会话、不写历史）。
 */
export type ThreadListNew = (
    firstMessage: HistoryMessageGroup
) => MaybePromise<Thread | void | null | undefined>;

/** 以会话 ID 为入参的操作：删除 / 归档 / 取消归档 */
export type ThreadIdHandler = (threadId: string) => MaybePromise<void>;

export interface ThreadListAdapterOptions {
    list?: ThreadListList;
    new?: ThreadListNew;
    delete?: ThreadIdHandler;
    archive?: ThreadIdHandler;
    unarchive?: ThreadIdHandler;
}

export declare class ThreadListAdapter {
    constructor(options?: ThreadListAdapterOptions);

    /** 实例名，AuiPage 按它去掉 Adapter 后缀后挂载；子类可覆盖 */
    name: string;

    list: ThreadListList;
    new: ThreadListNew;
    delete: ThreadIdHandler;
    archive: ThreadIdHandler;
    unarchive: ThreadIdHandler;

    /** 被 AuiPage 挂载后写入的反向引用 */
    aui?: AuiPage;
}
