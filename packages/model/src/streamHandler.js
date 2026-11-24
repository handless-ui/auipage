import parseReasoning, { extractThink, flushThink } from "./reasoning.js";

// 新调用的槽位：保留原始字段形状，只保证 function.arguments 是字符串
function normalizeCall(toolCall) {
    const fn = toolCall.function || {};
    return {
        ...toolCall,
        function: {
            ...fn,
            arguments: typeof fn.arguments === "string" ? fn.arguments : ""
        }
    };
}

// 续片：按 index 优先归并，否则追加到最后一个槽位
function mergeToolCall(state, toolCall) {
    if (!state._toolSlots) state._toolSlots = new Map();

    const calls = state.tool_calls;
    const index = typeof toolCall.index === "number" ? toolCall.index : null;
    const hasId = typeof toolCall.id === "string" && toolCall.id !== "";

    // 带 id 视为新调用；同 id 重复下发时复用已有槽位
    if (hasId) {
        const exist = calls.find(call => call.id === toolCall.id);
        if (exist) {
            appendArguments(exist, toolCall);
            return;
        }
        const slot = normalizeCall(toolCall);
        calls.push(slot);
        if (index !== null) state._toolSlots.set(index, slot);
        return;
    }

    let slot = index !== null ? state._toolSlots.get(index) : null;
    if (!slot && calls.length) slot = calls[calls.length - 1];

    // 首片就没有 id：建占位槽位，后续分片补齐参数
    if (!slot) {
        slot = normalizeCall(toolCall);
        calls.push(slot);
        if (index !== null) state._toolSlots.set(index, slot);
        return;
    }

    appendArguments(slot, toolCall);
}

function appendArguments(slot, toolCall) {
    const fn = toolCall.function || {};
    if (fn.name && !slot.function.name) slot.function.name = fn.name;
    if (typeof fn.arguments === "string") slot.function.arguments += fn.arguments;
}

// 处理单批 choices 数据：累加 content、拼装 tool_calls、回调 thinkback / logback
export default function handleChoices(choices, { logback, thinkback }, state) {
    if (!Array.isArray(choices)) return;

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

        // 工具调用分片
        if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
                mergeToolCall(state, toolCall);
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
