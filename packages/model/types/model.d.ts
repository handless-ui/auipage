/**
 * Model 构造器：对 OpenAI 风格 /chat/completions 接口的薄封装
 */
import type { ModelConfig } from "@auipage/types";
import type {
    CompletionsParams,
    CompletionsResult,
    StreamCallback
} from "./completions.js";

export declare class Model {
    constructor(fields: ModelConfig);

    /** 模型名称 */
    model: string;
    /** 模型服务 API Key */
    apiKey: string;
    /** 模型服务 baseURL */
    baseURL: string;

    /**
     * 发起一次 chat/completions 请求。
     *
     * @param params   消息、工具、是否流式
     * @param logback  流式正文增量回调
     * @param thinkback 流式思维链增量回调
     */
    completions(
        params: CompletionsParams,
        logback?: StreamCallback,
        thinkback?: StreamCallback
    ): Promise<CompletionsResult>;
}
