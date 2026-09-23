/**
 * fetch 返回的流式响应对象，基于事件机制承载响应过程
 */
import type { Emitter } from "./emitter.js";
import type { FetchHeaders } from "./options.js";

/** Response 支持的内置事件 */
export type FetchResponseEvent = "data" | "end" | "error";

export declare class Response extends Emitter {
    /** HTTP 状态码，响应头到达前为 0 */
    status: number;
    /** 响应头，默认为空对象 */
    headers: FetchHeaders;
    /** 状态码是否位于 2xx */
    ok: boolean;

    /** 监听数据 chunk（SSE 模式下为 data: 提取后的载荷） */
    on(event: "data", listener: (chunk: string) => void): this;
    /** 监听正常结束 */
    on(event: "end", listener: () => void): this;
    /** 监听错误 */
    on(event: "error", listener: (err: unknown) => void): this;
    /** 其它自定义事件的兜底重载 */
    on(event: string, listener: (...args: unknown[]) => void): this;

    off(event: FetchResponseEvent | string, listener: (...args: unknown[]) => void): this;
}

/** 对外使用的响应类型 */
export type FetchResponse = Response;
