import callFuns from "./callFuns.js";

/**
 * 把一次工具调用的执行结果转成 tool 消息。
 */
function toToolMessage(call, value) {
    return {
        role: "tool",
        tool_call_id: call.id,
        tool_name: call.function.name,
        content: typeof value === "string" ? value : (JSON.stringify(value) + "")
    };
}

/**
 * 把模型响应按 role 追加到 messages，返回是否还有工具调用需要下一轮处理。
 */
function appendAssistantMessage(messages, result) {
    if (result.content) {
        messages.push({ role: "assistant", content: result.content });
    }
    if (result.tool_calls && result.tool_calls.length > 0) {
        messages.push({ role: "assistant", tool_calls: result.tool_calls });
        return true;
    }
    return false;
}

/**
 * 执行模型对话循环：
 * 1. 调用模型获取响应
 * 2. 若返回工具调用，依次执行工具并将结果追加到 messages，继续循环
 * 3. 否则将最终内容 resolve 给调用方
 */
export default async function runConversation(_this, messages, logback, thinkback) {

    while (true) {
        const result = await _this.model.completions({
            messages,
            tools: _this.tools,
            stream: _this.stream,
        }, logback, thinkback);

        const hasToolCalls = appendAssistantMessage(messages, result);

        if (!hasToolCalls) {
            return result.content;
        }

        const toolResults = await callFuns(_this, result.tool_calls);

        result.tool_calls.forEach((call, i) => {
            messages.push(toToolMessage(call, toolResults[i]));
        });
    }
}