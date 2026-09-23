/**
 * chat/completions 请求与响应类型
 */
import type {
    ChatMessage,
    ModelToolCall,
    ToolDescription
} from "@auipage/types";

/** completions 入参（对应底层请求体中本包负责拼装的部分） */
export interface CompletionsParams {
    messages: ChatMessage[];
    /** 工具列表，每项携带一个标准 description，发请求时自动取 .description */
    tools?: Array<{ description: ToolDescription }>;
    /** 是否流式请求，默认 false */
    stream?: boolean;
}

/**
 * 流式回调：每收到一个增量分片调用一次，参数是本次增量文本
 * （不是累计文本，拼接由调用方完成）。
 */
export type StreamCallback = (delta: string) => void;

/** completions 最终结果 */
export interface CompletionsResult {
    /** 完整的正文内容 */
    content: string;
    /** 模型产生的工具调用（流式分片已自动拼装） */
    tool_calls: ModelToolCall[];
}
