// 演示模型：不联网、不发请求，用预置脚本走完「真实」的框架链路。
// 契约与 @auipage/model 的 Model 完全一致：completions(params, logback, thinkback) → { content, tool_calls }

import { DEMO_ID } from "./providers.js";
import { retrieveAnswer, noHitAnswer } from "./retrieve.js";

const SLICE = 3;      // 每次吐几个字
const TICK = 16;      // 每片间隔毫秒

function lastUserText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const item = messages[i];
        if (item && item.role === "user") {
            if (typeof item.content === "string") return item.content;
            if (Array.isArray(item.content)) {
                return item.content.map((p) => (p && p.text) || "").join("");
            }
        }
    }
    return "";
}

function lastToolMessages(messages) {
    const list = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const item = messages[i];
        if (!item || item.role !== "tool") break;
        list.unshift(item);
    }
    return list;
}

/* ------------------------------------------------------------------ 脚本库 */

function introAnswer() {
    return [
        "auipage 是一个「智能体网页」开发框架，把一次对话拆成四段可替换的零件：",
        "",
        "- **@auipage/fetch** —— 一次请求返回两个东西：一个 Promise，和一个能一直 `on(\"data\")` 的对象；",
        "- **@auipage/model** —— 拼 `/chat/completions`、解析 SSE、把 `tool_calls` 按 `index` 归并；",
        "- **@auipage/agent** —— `maxSteps` 工具循环：模型要工具就执行、要文本就收尾；",
        "- **@auipage/core** —— `AuiPage` 管一轮对话的状态：合并带、工具卡片、停止与取消、入库。",
        "",
        "你现在看到的这个面板就是完整用了这四个包：界面只是适配器，对话状态全部由 `AuiPage` 驱动。"
    ].join("\n");
}

function toolAnswer() {
    return [
        "工具调用在 auipage 里是**两条通道**，这个面板把两条都跑了一遍：",
        "",
        "1. **后端工具**：`CreateTool.create({ description, execute })` 里带 `execute`，`await` 完直接返回结果；",
        "2. **前端工具**：不带 `execute`，`CreateTool` 抛一个 `tool-call` 事件给页面，页面执行完再用",
        "   `ChatTransport.response(\"tool-result\", { id, result, status })` 回传——`globalThis[toolId]` 就是那个等待中的 Promise。",
        "",
        "所以「模型说要用工具」和「工具在哪跑」是两件事：模型只管要，跑在哪由 `caller` 决定。",
        "你可以直接问「我现在在看哪一篇」来触发一次工具调用，卡片会出现 `pending → success`。"
    ].join("\n");
}

function corsAnswer() {
    return [
        "连不上通常不是这个面板坏了，而是**浏览器在拦跨域请求**：",
        "",
        "- Ollama 默认只允许同源，需要 `OLLAMA_ORIGINS=*` 再重启；",
        "- 官方 OpenAI 与多数国内网关默认不许浏览器直连；",
        "- 文档站如果是 `https`，直连 `http://localhost` 还会被**混合内容**拦掉。",
        "",
        "三种解法：给服务端加 CORS 头、用同源前缀做代理、或临时用 `--disable-web-security` 的独立浏览器配置。",
        "设置页里的「诊断」会直接告诉你卡在哪一层（跨域、预检、鉴权还是地址不通）。"
    ].join("\n");
}

function stopAnswer() {
    return [
        "`AuiPage` 把「停止」和「取消」当两个语义处理：",
        "",
        "- `stop()`：停止继续生成，但已经生成的内容会正常入库；",
        "- `cancel()`：取消这次对话，`status: \"cancelled\"`，是否入库交给 `MessageHistory.append` 决定。",
        "",
        "两者最后都落到 `_requestEnd` → `controller.abort()`，所以底层 HTTP 是真的断了，不是只停界面。",
        "你可以发一句长回答然后点停止，观察气泡上出现「已停止」。"
    ].join("\n");
}

function threadAnswer() {
    return [
        "会话历史分三层，都不会互相污染：",
        "",
        "- `ThreadList`：会话列表与归档；",
        "- `MessageHistory`：按轮分组的消息，入库前会用 `toHistoryMessages` 把相邻同角色焊成一条；",
        "- `AuiPage.currentMessages`：当前会话的内存副本，切会话时整体换掉。",
        "",
        "这个面板的会话是内存态（刷新会丢），持久化在 W4 阶段接上。"
    ].join("\n");
}

function fallbackAnswer() {
    return [
        "我是**本地演示模型**：回答来自预置脚本 + 本地文档检索，不联网、不调用任何真实模型。",
        "",
        "这样你能在没有任何配置的情况下，完整体验一遍「流式输出、工具卡片、停止、入库」。",
        "",
        "问文档里的实现细节时，我会先检索 23 页原文，再摘句子回答，并给出命中位置。",
        "",
        "可以试试问我（点一下会填进输入框）：",
        "",
        "- `auipage 是什么`",
        "- `工具是怎么调用的`",
        "- `我现在在看哪一篇`（会真的触发一次工具调用）",
        "- `连不上模型怎么办`"
    ].join("\n");
}

function parseToolContent(item) {
    try {
        return JSON.parse(item.content);
    } catch (e) {
        return item.content;
    }
}

function afterToolAnswer(items) {
    const names = items.map(function (item) { return item.tool_name || ""; });
    const values = items.map(parseToolContent);
    const lines = ["工具返回了，这一轮一共 " + items.length + " 次调用：", ""];

    values.forEach(function (value, i) {
        const name = names[i] || "tool";
        if (name === "page_info" && value && typeof value === "object") {
            lines.push("- **page_info**：当前页《" + (value.title || "未知") + "》，分组 " + (value.section || "未标注") + "；");
        } else if (name === "list_pages" && value && typeof value === "object") {
            lines.push("- **list_pages**：侧栏 " + (value.count || 0) + " 个链接，分组 " + ((value.groups || []).join(" / ") || "未分组") + "；");
        } else if (name === "doc_stats" && value && typeof value === "object") {
            lines.push("- **doc_stats**：索引收录 " + (value.pages || 0) + " 页 / " + (value.sections || 0) + " 节；");
        } else if (name === "demo_fail") {
            lines.push("- **demo_fail**：失败了 —— " + String(value || "未知错误").slice(0, 80) + "；");
        } else if (name === "deep_dive") {
            lines.push("- **deep_dive**：用户的选择是「" + String(value && value.topic || value || "继续") + "」；");
        } else {
            lines.push("- **" + name + "**：" + String(value).slice(0, 80) + "；");
        }
    });

    lines.push("");
    lines.push("上面的结果都经 `role: \"tool\"` 消息回灌后才生成这段回答；失败的工具不会中断循环，会被转成文本继续走。");
    return lines.join("\n");
}

/* ------------------------------------------------------------------ 意图路由 */

async function plan(messages) {
    const tools = lastToolMessages(messages);
    if (tools.length) {
        return { think: "工具结果回来了，整理一下。", text: afterToolAnswer(tools), calls: [] };
    }

    const q = lastUserText(messages);

    if (/并行|两个工具|多项工具|属于哪个分组/.test(q)) {
        return {
            think: "这个问题可以同时问页面和文档目录，一次发两个工具调用。",
            text: "我同时查一下当前页和文档目录。",
            calls: [
                { name: "page_info", args: "{}" },
                { name: "list_pages", args: "{}" }
            ]
        };
    }
    if (/哪一篇|这篇|当前|页面|我在看/.test(q)) {
        return {
            think: "这个问题需要知道用户当前页面，先调 page_info 工具。",
            text: "我先看一下你正停在哪个页面。",
            calls: [{ name: "page_info", args: "{}" }]
        };
    }
    if (/索引|收录|多少页|多少节|文档统计/.test(q)) {
        return {
            think: "问索引规模，调适配器侧工具 doc_stats。",
            text: "我读一下构建出来的索引统计。",
            calls: [{ name: "doc_stats", args: "{}" }]
        };
    }
    if (/展开|深挖|确认卡|自定义卡/.test(q)) {
        return {
            think: "需要一张自定义交互卡，调 deep_dive。",
            text: "我给你弹一张确认卡，你决定要不要继续。",
            calls: [{ name: "deep_dive", args: JSON.stringify({ topic: "当前小节" }) }]
        };
    }
    if (/工具失败|失败演示|故意失败/.test(q)) {
        return {
            think: "演示失败路径，调 demo_fail。",
            text: "这次故意让工具失败，观察错误如何回灌。",
            calls: [{ name: "demo_fail", args: "{}" }]
        };
    }
    if (/auipage\s*是什么|auipage是什么|介绍.{0,4}auipage|auipage.{0,4}框架/.test(q)) {
        return { think: "问的是产品本身，按四个包的结构讲。", text: introAnswer(), call: null };
    }
    if (/工具是怎么被调用的|工具怎么调用|tool.{0,6}调用/.test(q)) {
        return { think: "工具问题是这套框架的核心，先讲两条通道。", text: toolAnswer(), call: null };
    }
    if (/跨域|CORS|cors|连不上|报错|401|403/.test(q)) {
        return { think: "连不上绝大多数是跨域，按三层排查讲。", text: corsAnswer(), call: null };
    }
    if (/停止|取消|stop|cancel|中断/.test(q)) {
        return { think: "停止与取消的语义容易混，讲清楚两者差异。", text: stopAnswer(), call: null };
    }
    if (/会话|历史|thread|归档/.test(q)) {
        return { think: "会话分三层，按存储边界讲。", text: threadAnswer(), call: null };
    }
    const found = await retrieveAnswer(q);
    if (found.ok) {
        return { think: found.think, text: found.text, call: null };
    }
    return {
        think: "脚本没命中，文档检索也没有足够接近的段落。",
        text: q ? noHitAnswer(q, found.results) : fallbackAnswer(),
        call: null
    };
}

/* ------------------------------------------------------------------ 模型实现 */

function DemoModel() {
    this.model = "auipage-demo";
    this.id = DEMO_ID;
}

DemoModel.prototype.completions = function (params, logback, thinkback) {
    const signal = params.signal;
    const messages = params.messages || [];

    return Promise.resolve(plan(messages)).then(function (planned) {
        return new Promise(function (resolve, reject) {
        let content = "";
        let aborted = false;
        const calls = (planned.calls && planned.calls.length)
            ? planned.calls
            : (planned.call ? [planned.call] : []);

        // 步骤队列：先思考、再正文、最后（可选）抛 tool_calls
        const steps = [];
        if (planned.think) steps.push({ kind: "think", text: planned.think });
        if (planned.text) steps.push({ kind: "text", text: planned.text });
        if (calls.length) steps.push({ kind: "call" });

        let stepIndex = 0;
        let cursor = 0;

        const stop = function () {
            if (aborted) return;
            aborted = true;
            const error = new Error("已取消");
            error.name = "AbortError";
            reject(error);
        };

        if (signal) {
            if (signal.aborted) return reject(new Error("已取消"));
            signal.addEventListener("abort", stop, { once: true });
        }

        const tick = function () {
            if (aborted) return;

            const step = steps[stepIndex];
            if (!step) {
                if (!calls.length) return resolve({ content: content, tool_calls: [] });
                return resolve({
                    content: content,
                    tool_calls: calls.map(function (call, i) {
                        return {
                            id: "call_" + Date.now().toString(36) + "_" + i,
                            type: "function",
                            function: { name: call.name, arguments: call.args }
                        };
                    })
                });
            }

            if (step.kind === "call") {
                stepIndex++;
                return setTimeout(tick, TICK);
            }

            const piece = step.text.slice(cursor, cursor + SLICE);
            if (!piece) {
                stepIndex++;
                cursor = 0;
                return setTimeout(tick, TICK);
            }
            cursor += SLICE;

            if (step.kind === "think") {
                if (thinkback) thinkback(piece);
            } else {
                content += piece;
                if (logback) logback(piece);
            }
            setTimeout(tick, TICK);
        };

        setTimeout(tick, 220);
        });
    });
};

export { DemoModel };
