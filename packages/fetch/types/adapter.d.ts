/**
 * 环境适配器协议：浏览器与 Node 各自实现一份
 */
import type { FetchHeaders, FetchOptions } from "./options.js";

/** 响应头到达时的元信息 */
export interface FetchResponseMeta {
    /** HTTP 状态码 */
    status?: number;
    headers?: FetchHeaders;
}

/** 适配器通过这些钩子把响应过程回传给 fetch 工厂 */
export interface FetchAdapterHooks {
    /** 响应头 / 状态码到达 */
    onResponse?: (meta: FetchResponseMeta) => void;
    /**
     * 收到一段数据：
     * 普通响应为原始字符串 chunk；SSE 响应（content-type: text/event-stream）
     * 会自动按事件分割，此处拿到的是 data: 字段提取后的载荷字符串。
     */
    onData?: (chunk: string) => void;
    /** 响应正常结束 */
    onEnd?: () => void;
    /** 请求或响应过程出错 */
    onError?: (err: unknown) => void;
}

/**
 * 适配器：接收请求配置与事件钩子，负责真正发起请求。
 * 可以同步执行，也可以返回 Promise。
 */
export type FetchAdapter = (
    options: FetchOptions,
    hooks: FetchAdapterHooks
) => void | Promise<void>;
