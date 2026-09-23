/**
 * @auipage/fetch 类型入口
 *
 * 跨端流式 fetch：内部根据运行环境自动选择浏览器 / Node 适配器。
 */
import type { FetchOptions } from "./options.js";
import type { Response } from "./response.js";

/* ---------- 请求配置 ---------- */
export type { FetchBody, FetchHeaders, FetchOptions } from "./options.js";

/* ---------- 适配器协议 ---------- */
export type {
    FetchAdapter,
    FetchAdapterHooks,
    FetchResponseMeta
} from "./adapter.js";

/* ---------- 响应与事件 ---------- */
export type { EventListener } from "./emitter.js";
export type { Response, FetchResponse, FetchResponseEvent } from "./response.js";

/**
 * 发起一次跨端请求，返回 Promise<Response>；
 * Response 通过 on("data" | "end" | "error") 消费流式数据，
 * content-type 为 text/event-stream 时 data 事件会自动提取 SSE 的 data: 载荷。
 */
export declare function fetch(options: FetchOptions): Promise<Response>;

export default fetch;
