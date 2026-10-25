import parseReasoning, { extractThink, flushThink } from "./reasoning.js";

// 处理单批 choices 数据：累加 content、拼装 tool_calls、回调 thinkback / logback
// 返回累积的 { content, tool_calls }
export default function handleChoices(choices, { logback, thinkback }, state) {
    for (let i = 0; i < choices.length; i++) {
        const delta = choices[i].delta;

        // 推理内容（reasoning / reasoning_content 字段）
        let reasoning = delta.reasoning || delta.reasoning_content;
        if (reasoning) {
            const parsed = parseReasoning(reasoning, delta.content);
            if (typeof parsed === "object") {
                reasoning = parsed.reasoning;
                delta.content = parsed.content;
            }
            if (thinkback) thinkback(reasoning);
        }

        // 正文内容：剥离混在 content 中的 <think>...</think> 思考片段
        if (delta.content) {
            const extracted = extractThink(delta.content, state);
            if (extracted.thinking && thinkback) thinkback(extracted.thinking);
            if (extracted.content) {
                if (logback) logback(extracted.content);
                state.content += extracted.content;
            }
        }

        // 工具调用
        if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
                if (toolCall.id) {
                    state.tool_calls.push(toolCall);
                } else {
                    state.tool_calls[state.tool_calls.length - 1].function.arguments += toolCall.function.arguments;
                }
            }
        }
    }
}

// 流结束时调用：把 <think> 标签截断残留冲刷到对应回调
export function flushThinkBuffer(state, { logback, thinkback }) {
    const flushed = flushThink(state);
    if (flushed.thinking && thinkback) thinkback(flushed.thinking);
    if (flushed.content) {
        if (logback) logback(flushed.content);
        state.content += flushed.content;
    }
}
