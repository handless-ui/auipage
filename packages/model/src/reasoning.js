// 解析 LLM 返回的推理内容（reasoning / reasoning_content）
// 将 <think>...</think> 形式的内容从 reasoning 字段中剥离出来
export default function parseReasoning(reasoning, content) {
    if (!/<\/think>/.test(reasoning)) return reasoning;

    const parts = reasoning.split("</think>");
    const thinkPart = parts[0].replace("<think>", "");
    return {
        reasoning: thinkPart,
        content: parts[1] + (content || "")
    };
}

const OPEN = "<think>";
const CLOSE = "</think>";

// 计算文本尾部与标签前缀的最长匹配长度
// 用于标签可能被截断在 chunk 边界的情况（如收到 "</thi"）
function partialTagLength(text, tag) {
    const max = Math.min(tag.length - 1, text.length);
    for (let len = max; len > 0; len--) {
        if (text.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
}

// 部分模型（如 MiniMax-M3）会把思考过程以 <think>...</think> 形式混在 content 中
// 这里把它剥离出来：思考片段归 thinkback，其余归正文
// 流式时标签可能分散在多个 chunk，依赖 state.inThink / state.thinkBuf 跨 chunk 记录状态
// 返回 { thinking, content }
export function extractThink(content, state) {
    const buf = (state.thinkBuf || "") + content;
    state.thinkBuf = "";

    // 正处于思考块内：寻找 </think>
    if (state.inThink) {
        const end = buf.indexOf(CLOSE);
        if (end === -1) {
            const hold = partialTagLength(buf, CLOSE);
            state.thinkBuf = buf.slice(buf.length - hold);
            return { thinking: buf.slice(0, buf.length - hold), content: "" };
        }
        state.inThink = false;
        const rest = extractThink(buf.slice(end + CLOSE.length), state);
        return { thinking: buf.slice(0, end) + rest.thinking, content: rest.content };
    }

    // 正常正文：寻找 <think>
    const start = buf.indexOf(OPEN);
    if (start === -1) {
        const hold = partialTagLength(buf, OPEN);
        state.thinkBuf = buf.slice(buf.length - hold);
        return { thinking: "", content: buf.slice(0, buf.length - hold) };
    }

    const end = buf.indexOf(CLOSE, start);
    if (end !== -1) {
        const rest = extractThink(buf.slice(end + CLOSE.length), state);
        return {
            thinking: buf.slice(start + OPEN.length, end) + rest.thinking,
            content: buf.slice(0, start) + rest.content
        };
    }

    // 有 <think> 无 </think>：进入思考态
    state.inThink = true;
    const body = buf.slice(start + OPEN.length);
    const hold = partialTagLength(body, CLOSE);
    state.thinkBuf = body.slice(body.length - hold);
    return { thinking: body.slice(0, body.length - hold), content: buf.slice(0, start) };
}

// 流结束时调用：冲刷 extractThink 留下的截断残留，按当前所处模式归属输出
export function flushThink(state) {
    const buf = state.thinkBuf || "";
    state.thinkBuf = "";
    return state.inThink ? { thinking: buf, content: "" } : { thinking: "", content: buf };
}
