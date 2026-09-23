/**
 * ThreadListRuntime：会话列表（侧边栏）的渲染钩子
 */
import type { Thread } from "../thread.js";
import type { AuiPage } from "../auipage.js";

/** 首次渲染整个会话列表 */
export type ThreadInitHandler = (threads: Thread[]) => void;
/** 切换激活会话；threadId 为 undefined 表示“新建会话”状态 */
export type ThreadActiveHandler = (threadId: string | undefined) => void;
/** 追加一个新会话节点 */
export type ThreadAppendHandler = (thread: Thread) => void;
/** 以会话 ID 为入参的渲染操作：删除 / 归档 / 取消归档 */
export type ThreadIdUIHandler = (threadId: string) => void;

export interface ThreadListRuntimeOptions {
    init?: ThreadInitHandler;
    active?: ThreadActiveHandler;
    append?: ThreadAppendHandler;
    delete?: ThreadIdUIHandler;
    archive?: ThreadIdUIHandler;
    unarchive?: ThreadIdUIHandler;
}

export declare class ThreadListRuntime {
    constructor(options?: ThreadListRuntimeOptions);

    /** 实例名，AuiPage 按它去掉 Runtime 后缀后挂载；子类可覆盖 */
    name: string;

    init: ThreadInitHandler;
    active: ThreadActiveHandler;
    append: ThreadAppendHandler;
    delete: ThreadIdUIHandler;
    archive: ThreadIdUIHandler;
    unarchive: ThreadIdUIHandler;

    /** 被 AuiPage 挂载后写入的反向引用 */
    aui?: AuiPage;
}
