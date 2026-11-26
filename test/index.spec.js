// 端到端联调：需要本地 ollama（默认 qwen3.5）
// 设置 AUIPAGE_OLLAMA=1 才执行，否则直接跳过，避免无模型的机器上误报
import { Model } from "@auipage/model";
import { Agent } from "@auipage/agent";

const BASE_URL = process.env.AUIPAGE_OLLAMA_BASEURL || "http://localhost:11434/v1";
const MODEL = process.env.AUIPAGE_OLLAMA_MODEL || "qwen3.5";

function withTimeout(promise, ms = 150000, label = "spec") {
    return Promise.race([
        promise,
        new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error(label + " 超时（" + ms + "ms）")), ms);
        })
    ]);
}

function newModel(model = MODEL) {
    return new Model({ baseURL: BASE_URL, apiKey: "", model });
}

const cases = [];

cases.push(() => withTimeout(
    newModel().completions({
        messages: [{ role: "user", content: "只回复：OK" }]
    })
).then((result) => {
    if (typeof result.content !== "string" || result.content.trim() === "") {
        throw new Error("非流式响应缺少 content");
    }
    console.log("  ✓ 非流式 completions：", result.content.slice(0, 40));
}));

cases.push(() => {
    const logs = [];
    return withTimeout(newModel().completions({
        messages: [{ role: "user", content: "只回复：123" }],
        stream: true
    }, (text) => logs.push(text))).then((result) => {
        if (typeof result.content !== "string" || result.content.trim() === "") {
            throw new Error("流式响应缺少 content");
        }
        if (logs.length === 0) throw new Error("流式响应没有触发 logback");
        console.log("  ✓ 流式 completions：", logs.length, "个分片");
    });
});

cases.push(() => withTimeout(
    new Agent({
        model: { baseURL: BASE_URL, apiKey: "", model: MODEL },
        stream: true
    }).generate([{ role: "user", content: "只回复：收到" }])
).then((content) => {
    if (typeof content !== "string") throw new Error("Agent.generate 未返回文本");
    console.log("  ✓ Agent.generate：", content.slice(0, 40));
}));

cases.push(() => withTimeout(
    newModel("model-not-exists").completions({
        messages: [{ role: "user", content: "hi" }]
    }), 60000, "未知模型"
).then(
    () => { throw new Error("未知模型应 reject"); },
    (err) => {
        if (!(err instanceof Error) || !err.message.includes("HTTP")) {
            throw new Error("未知模型错误缺少 HTTP 状态：" + err);
        }
        console.log("  ✓ 4xx 拒绝：", err.message.slice(0, 60));
    }
));

if (process.env.AUIPAGE_OLLAMA !== "1") {
    console.log("跳过 spec：未设置 AUIPAGE_OLLAMA=1");
} else {
    (async () => {
        for (const run of cases) await run();
        console.log("\n🎉 spec 全部通过");
    })().catch((err) => {
        console.error("\n❌ spec 失败：", err && err.message ? err.message : err);
        process.exit(1);
    });
}
