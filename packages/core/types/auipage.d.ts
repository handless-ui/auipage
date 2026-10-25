/**
 * AuiPage：框架核心，串联 Adapter（业务侧）与 Runtime（UI 侧），
 * 维护会话、消息历史、流式对话与工具调用状态。
 */
import type { ToolDescription, ToolExecutor } from "@auipage/types";
import type {
    ChatContentMessage,
    HistoryMessageGroup
} from "./message.js";
import type { Tool, ToolRender } from "./tool.js";
import type { ChatTransportAdapter } from "./adapters/chat-transport.js";
import type { MessageHistoryAdapter } from "./adapters/message-history.js";
import type { ThreadListAdapter } from "./adapters/thread-list.js";
import type { ThreadListRuntime } from "./runtimes/thread-list.js";
import type { ChatContentRuntime } from "./runtimes/chat-content.js";

/** 三个适配器的挂载集合（key 与实例 name 去掉 Adapter 后缀一致） */
export interface AuiPageAdapterSet {
    ChatTransport: ChatTransportAdapter;
    MessageHistory: MessageHistoryAdapter;
    ThreadList: ThreadListAdapter;
}

/** 两个运行时的挂载集合（key 与实例 name 去掉 Runtime 后缀一致） */
export interface AuiPageRuntimeSet {
    ThreadList: ThreadListRuntime;
    ChatContent: ChatContentRuntime;
}

export interface AuiPageOptions {
    adapter: AuiPageAdapterSet;
    runtime: AuiPageRuntimeSet;
    /** 页面侧工具列表；可选，不使用工具时省略 */
    tools?: Tool[];
}

/** 任务生命周期事件名 */
export type AuiLifecycleEvent = "task:start" | "task:end";

/** 任务结束状态 */
export type AuiTaskStatus = "complete" | "error";

/** task:start 回调载荷 */
export interface TaskLifecyclePayload {
    /** 本次 sendMessage 自增生成的唯一任务 id */
    taskId: string;
    /** 任务发起时所处的会话 ID；新建会话场景下为 undefined */
    threadId: string | undefined;
    /** 本次发送的原始页面消息 */
    message: ChatContentMessage;
}

/** task:end 回调载荷；在 TaskLifecyclePayload 基础上附带 status */
export interface TaskEndPayload extends TaskLifecyclePayload {
    status: AuiTaskStatus;
}

/** 生命周期事件 handler 签名 */
export type TaskStartHandler = (payload: TaskLifecyclePayload) => void;
export type TaskEndHandler = (payload: TaskEndPayload) => void;

export declare class AuiPage {
    constructor(options: AuiPageOptions);

    /** 按 name 映射后的适配器集合 */
    adapter: AuiPageAdapterSet;
    /** 按 name 映射后的运行时集合 */
    runtime: AuiPageRuntimeSet;

    /** 工具名 → 页面执行函数 */
    tools_execute: Record<string, ToolExecutor>;
    /** 工具名 → UI 交互函数（可能为 undefined） */
    tools_render: Record<string, ToolRender | undefined>;
    /** 透传给 ChatTransport.run 的 context.tools */
    tools_description: Array<{ description: ToolDescription }>;

    /** 当前是否处于对话执行中；执行中拒绝重复发送、忽略会话切换 */
    isExecuting: boolean;
    /** 当前激活的会话 ID；undefined 表示“新建会话”状态 */
    currentThreadId: string | undefined;
    /** 当前会话已加载的历史消息组 */
    currentMessages: HistoryMessageGroup[];

    /**
     * 发送一条消息并驱动完整的流式对话流程；
     * 上一轮执行中时以 "当前正在执行中" reject，全部完成（含落库）后 resolve；
     * 流式过程出错时以原始 error reject（同时触发 task:end { status: "error" }）。
     */
    sendMessage(message: ChatContentMessage): Promise<void>;

    /**
     * 订阅任务生命周期事件。同名事件可注册多个 handler，触发时按注册顺序串行调用，
     * handler 内部抛错被吞掉，不会影响 sendMessage 主流程。链式返回 AuiPage。
     */
    on(event: "task:start", handler: TaskStartHandler): this;
    on(event: "task:end", handler: TaskEndHandler): this;

    /** 取消事件订阅；handler 未注册过则 no-op。链式返回 AuiPage */
    off(event: AuiLifecycleEvent, handler: Function): this;

    /**
     * 切换到指定会话；threadId 为 undefined 表示进入新建会话状态。
     * 对话执行中调用会被忽略（noLoad 内部调用除外）。
     * @param noLoad 内部参数：true 时跳过历史重载（新建会话后使用）
     */
    activeThread(threadId: string | undefined, noLoad?: boolean): void;

    /** 删除会话；删除的是当前会话时自动进入新建会话状态 */
    deleteThread(threadId: string): void;
    /** 归档会话；归档的是当前会话时自动进入新建会话状态 */
    archiveThread(threadId: string): void;
    /** 取消归档（不自动切换会话） */
    unarchiveThread(threadId: string): void;
    /** 进入新建会话状态，等价于 activeThread(undefined) */
    newThread(): void;
}
