/**
 * 与大模型交互的对话消息（OpenAI Chat Completions 风格的线上协议）。
 *
 * 注意与“页面渲染用的消息片段”区分：本文件描述发给模型 / 模型返回的消息，
 * content 为纯文本；页面流中的富文本、工具调用片段见 stream.d.ts。
 */

/** 消息角色 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** 模型发起的一次函数调用，arguments 为 JSON 字符串，执行前需 JSON.parse */
export interface ToolCallFunction {
    /** 工具名，对应 ToolDescription.function.name */
    name: string;
    /** 模型生成的入参（JSON 字符串） */
    arguments: string;
}

/**
 * 模型响应中的工具调用。
 *
 * 流式响应按分片到达：首个分片携带 index / id / type / function.name，
 * 后续分片只追加 function.arguments；@auipage/model 会把 arguments 拼接完整。
 */
export interface ModelToolCall {
    /** 该调用在本轮响应中的序号（首片携带，拼接后保留） */
    index?: number;
    /** 调用唯一标识（首片携带）；回传工具结果时作为 tool_call_id */
    id?: string;
    /** 调用类型，目前固定为 "function" */
    type?: "function";
    function: ToolCallFunction;
}

/**
 * 对话消息。
 *
 * - assistant 发起工具调用时携带 tool_calls，content 可缺省；
 * - role 为 "tool" 时携带 tool_call_id / tool_name 与文本形式的执行结果；
 * - tool_name 为框架扩展字段，OpenAI 标准协议中没有。
 */
export interface ChatMessage {
    role: ChatRole;
    /** 文本内容；assistant 仅发起工具调用时可能缺省 */
    content?: string;
    /** assistant 决定调用的工具列表 */
    tool_calls?: ModelToolCall[];
    /** role 为 "tool" 时：对应的工具调用 id */
    tool_call_id?: string;
    /** role 为 "tool" 时：对应的工具名（框架扩展字段） */
    tool_name?: string;
}
