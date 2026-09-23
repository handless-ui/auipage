/**
 * Agent 构造器：模型对话循环 + 工具调用编排
 */
import type { ChatMessage, ModelConfig } from "@auipage/types";
import type { Model } from "@auipage/model";
import type { AgentTool } from "./tool.js";

/** 流式正文回调，参数为模型本次给出的文本（增量） */
export type Logback = (text: string) => void;

/** 流式思维链 / 推理过程回调，参数为本次增量文本 */
export type Thinkback = (text: string) => void;

export interface AgentOptions {
    /** 透传给 @auipage/model 的模型配置 */
    model: ModelConfig;
    /** 系统提示词，会作为首条 system 消息发送，默认 "" */
    systemPrompt?: string;
    /** 工具列表，默认 [] */
    tools?: AgentTool[];
    /** 是否开启流式输出，默认 false */
    stream?: boolean;
}

export declare class Agent {
    constructor(options: AgentOptions);

    /** 底层模型实例 */
    model: Model;
    tools: AgentTool[];
    systemPrompt: string;
    stream: boolean;

    /**
     * 执行对话循环：模型请求 → 工具调用 → 结果回传 → 继续请求，直至拿到最终文本。
     *
     * @param messages  本轮对话消息数组；配置了非空 systemPrompt 时会自动插到最前（原地修改）
     * @param logback   流式正文增量回调
     * @param thinkback 流式思维链增量回调
     * @returns 模型最终回复；只产出工具调用而无文本时可能为 undefined
     */
    generate(
        messages: ChatMessage[],
        logback?: Logback,
        thinkback?: Thinkback
    ): Promise<string | undefined>;
}
