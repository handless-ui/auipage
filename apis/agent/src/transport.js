// ChatTransportAdapter 的真实实现：
// run() 把 Agent 的流（logback / thinkback / CreateTool 事件）转成 AuiPage 认的 generator；
// response() 把页面工具的返回值回传给 CreateTool 等待中的 Promise（globalThis[toolId]）。
import { Agent, CreateTool } from "@auipage/agent";
import { ChatTransportAdapter, MessageStream, toModelMessages } from "@auipage/core";

const SYSTEM_PROMPT = [
    "你是 auipage 文档站的助手，只回答与这套框架、这份文档相关的问题。",
    "回答用中文，简洁、具体，能引用篇目时用「第 N 篇」的写法。",
    "需要文档内容时调用工具，不要凭印象编造篇目或代码。",
    "如果你其实是演示模型，不要假装能联网或能执行命令。"
].join("\n");

export function createTransport(options) {
    const getProvider = options.getProvider;

    const adapter = new ChatTransportAdapter({
        run: function (request) {
            const provider = getProvider();
            if (!provider) throw new Error("还没有可用的模型配置");

            const context = (request && request.context) || {};
            const messages = (request && request.messages) || [];
            const signal = context.signal;

            // 队列通道：Agent 的回调与工具事件都往这里写，generator 逐条取给 AuiPage
            const queue = [];
            let wake = null;
            let finished = false;
            let failure = null;

            const notify = function () {
                const resume = wake;
                wake = null;
                if (resume) resume();
            };
            const push = function (value) {
                queue.push(value);
                notify();
            };

            const stream = new MessageStream(
                function (info) { push(Object.assign({ type: "tool-call" }, info)); },
                function () { /* 这里没有 SSE 结束语义，留给 generator 收尾 */ }
            );
            const bridge = new CreateTool(stream);

            // Agent 侧只给 description（= 前端工具），真正执行在 AuiPage
            const tools = options.tools.map(function (tool) {
                return bridge.create({ description: tool.description });
            });

            const agent = new Agent({
                model: provider.model,
                tools: tools,
                systemPrompt: SYSTEM_PROMPT,
                stream: true,
                maxSteps: 3,
                signal: signal
            });
            // Agent 内部会 new Model(option.model)，这里换成工厂产物（真实 Model 或演示 Model）
            agent.model = options.createModel(provider);

            const input = toModelMessages([].concat(context.history || [], messages));

            push({ type: "loading", text: "" });

            agent.generate(
                input,
                function (text) { push({ type: "text", text: text }); },
                function (text) { push({ type: "thinking", text: text }); }
            ).then(function () {
                finished = true;
                notify();
            }, function (error) {
                failure = error;
                finished = true;
                notify();
            });

            return (async function* () {
                while (true) {
                    if (queue.length) {
                        yield queue.shift();
                        continue;
                    }
                    if (finished) {
                        if (failure) throw failure;
                        return;
                    }
                    await new Promise(function (resolve) { wake = resolve; });
                }
            })();
        },

        response: function (type, payload) {
            if (type !== "tool-result" || !payload) return;
            const waiter = globalThis[payload.id];
            if (typeof waiter !== "function") return;
            waiter(payload.result, payload.status);
        }
    });

    return adapter;
}
