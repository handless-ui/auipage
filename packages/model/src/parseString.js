// 字符串转 JSON，适配 LLM 返回的各种流式格式：
// 单条 JSON（含 pretty-printed 的多行）、带 "data: " 前缀的 SSE、多条 SSE 事件、NDJSON
function stripDataPrefix(text) {
    return text.replace(/^data:\s*/, "");
}

function tryParse(text) {
    try {
        return { value: JSON.parse(text) };
    } catch (e) {
        return null;
    }
}

function parseOne(text, origin) {
    const parsed = tryParse(stripDataPrefix(text.trim()));
    if (!parsed) throw new SyntaxError("模型返回无法解析：" + String(origin).slice(0, 120));
    return parsed.value;
}

// 错误响应体（{"error":{...}}）直接抛出，交给调用方转成 reject
function checkError(result) {
    if (Array.isArray(result)) {
        for (const item of result) {
            if (item && item.error) throw item.error;
        }
        return result;
    }
    if (result && result.error) throw result.error;
    return result;
}

export default function (value) {
    let text = String(value == null ? "" : value).trim();

    // 结束标记：可能单独出现，也可能紧跟在最后一条事件后面
    text = text.replace(/data:\s*\[DONE\]$/, "").trim();
    if (text === "" || text === "[DONE]") return [];

    // 单条：带 data: 前缀或裸 JSON
    let single = tryParse(stripDataPrefix(text)) || tryParse(text);
    if (single) return checkError(single.value);

    // 多条 SSE 事件，以 "\n\ndata: " 分隔
    const parts = text.split(/\r?\n\r?\ndata: /);
    if (parts.length > 1) return checkError(parts.map(part => parseOne(part, text)));

    // NDJSON：逐行 JSON（跳过空行和 ":" 注释行）
    const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith(":"));
    if (lines.length > 1) return checkError(lines.map(line => parseOne(line, text)));

    throw new SyntaxError("模型返回无法解析：" + text.slice(0, 120));
}
