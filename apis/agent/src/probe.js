// 连接诊断：直接对 baseURL 发一次最小的 chat/completions，把失败翻译成用户能懂的结论
export function probe(provider, timeout) {
    if (!provider) return Promise.resolve({ level: "error", message: "没有可用的模型配置" });
    if (provider.protocol === "demo") {
        return Promise.resolve({ level: "ok", message: "演示模型无需联网，立即可用" });
    }

    const base = String(provider.baseURL || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) {
        return Promise.resolve({ level: "error", message: "地址需要以 http:// 或 https:// 开头：" + base });
    }
    if (typeof fetch !== "function") {
        return Promise.resolve({ level: "error", message: "当前环境没有 fetch" });
    }

    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const limit = Math.min(Number(timeout || 8000), 15000);
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, limit);

    return fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + (provider.apiKey || "none")
        },
        body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "ping" }],
            stream: false,
            max_tokens: 1
        }),
        signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
        clearTimeout(timer);
        if (res.ok) return { level: "ok", message: "连接成功，可以用这个地址对话" };
        if (res.status === 401 || res.status === 403) {
            return { level: "warn", message: "能连上，但密钥被拒（HTTP " + res.status + "）：检查 API Key" };
        }
        if (res.status === 404) {
            return { level: "warn", message: "地址通了，但找不到接口或模型（HTTP 404）：确认 baseURL 是否带 /v1、模型名是否存在" };
        }
        return { level: "warn", message: "地址可达，但返回 HTTP " + res.status + "，检查服务日志" };
    }, function (error) {
        clearTimeout(timer);
        if (error && error.name === "AbortError") {
            return { level: "warn", message: "等了 " + Math.round(limit / 1000) + " 秒没有响应：服务没启动，或地址不可达" };
        }
        return {
            level: "error",
            message: "请求被浏览器拦住了：多半是该地址没开跨域（CORS）。本机 Ollama 可用 OLLAMA_ORIGINS=* 重启，或用 --disable-web-security 启动的浏览器访问"
        };
    });
}
