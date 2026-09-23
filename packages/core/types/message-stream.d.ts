/**
 * MessageStream：消息流的简单封装
 *
 * 常用于服务端（配合 @auipage/agent 的 CreateTool）向页面推送 SSE 事件。
 */
import type { StreamEvent } from "@auipage/types";

/** 发送一条流式事件 */
export type MessageSendHandler = (data: StreamEvent) => void;
/** 结束本次消息流 */
export type MessageEndHandler = () => void;

export declare class MessageStream {
    /**
     * @param send 发送回调，缺省为空函数
     * @param end  结束回调，缺省为空函数
     */
    constructor(send?: MessageSendHandler, end?: MessageEndHandler);

    send: MessageSendHandler;
    end: MessageEndHandler;
}
