// 页面消息（富片段）→ 模型线上消息（纯文本 + tool_calls / tool 结果）

// 入参既可以是历史消息组数组，也可以是纯消息数组
// #doc:flat
function flatten(input) {
    const list = [];
    for (const item of input || []) {
        if (!item) continue;
        if (Array.isArray(item.messages)) list.push(...item.messages);
        else list.push(item);
    }
    return list;
}
// #end

// 只拼接 text 片段；thinking / loading 与自定义片段不进模型上下文
function textOf(parts) {
    let text = "";
    for (const part of parts) {
        if (!part || part.type !== "text" || typeof part.text !== "string") continue;
        text += part.text;
    }
    return text;
}

function contentOf(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return String(value);
    try {
        const text = JSON.stringify(value);
        return typeof text === "string" ? text : "";
    } catch (e) {
        return String(value);
    }
}

/**
 * 把页面侧的历史消息转换为模型可用的 ChatMessage 数组。
 *
 * @param {Array} input 历史消息组数组（HistoryMessageGroup[]）或消息数组（ChatContentMessage[]）
 * @returns {Array} 可直接作为 completions.messages 的数组
 */
export default function toModelMessages(input) {
    const messages = flatten(input);
    const result = [];
    let seq = 0;

    for (const message of messages) {
        const parts = Array.isArray(message.content) ? message.content : [];
        const text = typeof message.content === "string" ? message.content : textOf(parts);

        // #doc:calls
        // 只保留已结束的工具调用，避免模型收到没有结果的 tool_call
        const calls = parts.filter(part => part
            && part.type === "tool-call"
            && typeof part.name === "string"
            && (part.status === "success" || part.status === "error"));

        if (calls.length === 0) {
            if (text) result.push({ role: message.role, content: text });
            continue;
        }

        // 历史片段可能没有 id，这里补一个稳定 id，让 tool 消息能对应上
        const tool_calls = calls.map(call => ({
            id: call.id || ("call_" + (++seq)),
            type: "function",
            function: {
                name: call.name,
                arguments: JSON.stringify(call.args || {})
            }
        }));

        result.push({ role: "assistant", content: text || void 0, tool_calls });

        calls.forEach((call, i) => {
            const payload = call.ui && call.ui.status ? call.ui.result : call.result;
            result.push({
                role: "tool",
                tool_call_id: tool_calls[i].id,
                tool_name: call.name,
                content: contentOf(payload)
            });
        });
        // #end
    }

    return result;
}
