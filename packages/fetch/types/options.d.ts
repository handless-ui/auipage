/**
 * fetch 请求配置
 */

/** 请求头：浏览器 Headers 对象或普通键值对 */
export type FetchHeaders = Headers | Record<string, string>;

/** 请求体（字符串最常用；对象通常由调用方自行 JSON.stringify） */
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
}
