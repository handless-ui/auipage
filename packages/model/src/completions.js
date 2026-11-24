import { fetch } from "@auipage/fetch/src/index.js";
import parseString from "./parseString.js";
import handleChoices, { flushThinkBuffer } from "./streamHandler.js";

// 统一把各种错误形态收敛成 Error，保证 Promise 一定 settle
function toError(value, fallback) {
    if (value instanceof Error) return value;
    if (value && typeof value.message === "string") return new Error(value.message);
    try {
        return new Error(String(value));
    } catch (e) {
        return new Error(fallback || "模型请求失败");
    }
}

// HTTP 错误：尽量带出响应体里的 error.message，方便定位
function errorFromHttp(meta, body) {
    const status = meta && meta.status;
    let detail = "";

    if (body) {
        try {
            const parsed = JSON.parse(body);
            const raw = parsed && parsed.error;
            detail = (raw && (raw.message || raw)) || "";
        } catch (e) {
            detail = String(body).slice(0, 200);
        }
        if (detail && typeof detail !== "string") detail = JSON.stringify(detail);
    }

    return new Error("模型服务返回 HTTP " + status + (detail ? "：" + detail : ""));
}

export default function completions(params, logback, thinkback) {
    return new Promise((resolve, reject) => {

        const state = { content: "", tool_calls: [] };
        const callbacks = { logback, thinkback };

        let buffer = "";
        let httpError = null;
        let streamError = null;
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };
        const fail = value => finish(reject, toError(value, "模型请求失败"));

        fetch({
            url: `${this.baseURL.replace(/\/+$/, "")}/chat/completions`,
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: this.model,
                messages: params.messages,
                tools: params.tools ? params.tools.map(tool => tool.description) : [],
                stream: params.stream,
            }),
            timeout: params.timeout,
            signal: params.signal
        }).then(res => {

            // 非 2xx：非流式等错误体读完再判，流式直接中断
            res.on("http-error", meta => {
                httpError = meta;
                if (params.stream) fail(errorFromHttp(meta));
            });

            // 数据流
            res.on("data", chunk => {
                if (settled) return;
                if (!params.stream) {
                    buffer += chunk;
                    return;
                }
                let parsed;
                try {
                    parsed = parseString(chunk.toString());
                } catch (e) {
                    streamError = e;
                    fail(e);
                    return;
                }
                try {
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    for (const item of items) handleChoices(item.choices, callbacks, state);
                } catch (e) {
                    fail(e);
                }
            });

            // 结束
            res.on("end", () => {
                if (!params.stream) {
                    if (httpError) {
                        fail(errorFromHttp(httpError, buffer));
                        return;
                    }
                    try {
                        const parsed = parseString(buffer);
                        const choices = parsed && parsed.choices;
                        if (!choices || !choices[0] || !choices[0].message) {
                            throw new Error("模型响应缺少 choices[0].message");
                        }
                        handleChoices([{ delta: choices[0].message }], callbacks, state);
                    } catch (e) {
                        fail(e);
                        return;
                    }
                } else if (streamError) {
                    fail(streamError);
                    return;
                } else if (httpError) {
                    fail(errorFromHttp(httpError));
                    return;
                }

                // 冲刷 <think> 标签截断残留
                flushThinkBuffer(state, callbacks);
                finish(resolve, { content: state.content, tool_calls: state.tool_calls });
            });

            res.on("error", err => fail(err));
        }).catch(err => fail(err));

    });
}
