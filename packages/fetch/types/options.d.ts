/**
 * fetch 请求配置
 */

/** 请求头：浏览器 Headers 对象或普通键值对 */
export type FetchHeaders = Headers | Record<string, string>;

/** 请求体（普通对象会自动 JSON 序列化） */
export type FetchBody =
    | string
    | ArrayBufferView
    | Record<string, unknown>
    | null;

export interface FetchOptions {
    /** 请求地址（必填） */
    url: string;
    /** 请求方法，默认 "GET" */
    method?: string;
    /** 请求头，默认 {} */
    headers?: FetchHeaders;
    /** 请求体 */
    body?: FetchBody;
    /** 超时毫秒数；到点自动中断请求并以 error 事件返回，0 / 缺省表示不限制 */
    timeout?: number;
    /** 外部取消信号；abort 后以 error 事件返回 */
    signal?: AbortSignal | null;
}
