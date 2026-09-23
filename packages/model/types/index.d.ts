/**
 * @auipage/model 类型入口
 *
 * 对 OpenAI 风格 chat/completions 的跨端请求封装，支持流式输出与工具调用。
 */

export { Model } from "./model.js";

export type {
    CompletionsParams,
    CompletionsResult,
    StreamCallback
} from "./completions.js";
