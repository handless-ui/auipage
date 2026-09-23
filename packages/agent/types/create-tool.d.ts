/**
 * CreateTool：前后端工具桥接器
 *
 * 运行在服务端的 Agent 通过消息流把工具调用状态推送给页面，
 * 页面执行完“前端工具”后再把结果回传，唤醒挂起的调用。
 */
import type {
    StreamEvent,
    ToolDescription,
    ToolExecutor
} from "@auipage/types";
import type { AgentTool } from "./tool.js";

/** 消息流发送端（结构与 @auipage/core 的 MessageStream 兼容） */
export interface MessageSender {
    send(event: StreamEvent): void;
}

/** ct.create 的入参：execute 缺省即“前端工具”，调用会挂起等待页面回传 */
export interface CreateToolInput {
    description: ToolDescription;
    /** 后端工具：在 Agent 所在服务端执行；缺省则为前端工具 */
    execute?: ToolExecutor;
}

export declare class CreateTool {
    constructor(ms: MessageSender);

    /** 构造时传入的消息流发送端 */
    ms: MessageSender;

    /**
     * 包装一个工具为标准 AgentTool：
     * - 有 execute：执行前后通过消息流推送 pending / success / error；
     * - 无 execute：只推送 pending，随后挂起，等待 globalThis[id](result) 唤醒。
     */
    create(input: CreateToolInput): AgentTool;
}
