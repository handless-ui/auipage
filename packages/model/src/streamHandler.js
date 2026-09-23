import parseReasoning from "./reasoning.js";

// 处理单批 choices 数据：累加 content、拼装 tool_calls、回调 thinkback / logback
// 返回累积的 { content, tool_calls }
export default function handleChoices(choices, { logback, thinkback }, state) {
    for (let i = 0; i < choices.length; i++) {
        const delta = choices[i].delta;

        // 推理内容
        let reasoning = delta.reasoning || delta.reasoning_content;
        if (reasoning) {
            const parsed = parseReasoning(reasoning, delta.content);
            if (typeof parsed === "object") {
                reasoning = parsed.reasoning;
                delta.content = parsed.content;
            }
            if (thinkback) thinkback(reasoning);
        }

        // 正文内容
        if (delta.content) {
            if (logback) logback(delta.content);
            state.content += delta.content;
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
