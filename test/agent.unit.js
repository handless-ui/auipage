import { Agent, CreateTool } from "@auipage/agent";
import callFuns from "@auipage/agent/src/callFuns.js";
import runConversation from "@auipage/agent/src/runConversation.js";

export default function ({ describe, it, expect }) {

    // ----------------------- callFuns -----------------------
    describe("callFuns", () => {
        it("命中同步 execute：返回该值", () => {
            const ctx = {
                tools: [{
                    description: { function: { name: "echo" } },
                    execute: (args) => "out:" + args.x
                }]
            };
            return callFuns(ctx, [{
                function: { name: "echo", arguments: JSON.stringify({ x: 1 }) }
            }]).then((arr) => {
                expect(arr).toEqual(["out:1"]);
            });
        });

        it("命中异步 execute：await 出值", () => {
            const ctx = {
                tools: [{
                    description: { function: { name: "echo" } },
                    execute: async (args) => "async:" + args.x
                }]
            };
            return callFuns(ctx, [{
                function: { name: "echo", arguments: JSON.stringify({ x: 2 }) }
            }]).then((arr) => {
                expect(arr).toEqual(["async:2"]);
            });
        });

        it("未命中工具：该槽为 '工具X不存在'", () => {
            const ctx = { tools: [] };
            return callFuns(ctx, [{
                function: { name: "missing", arguments: "{}" }
            }]).then((arr) => {
                expect(arr).toEqual(["工具missing不存在"]);
            });
        });

        it("arguments JSON 非法：该槽为 '参数解析失败:...'", () => {
            const ctx = {
                tools: [{
                    description: { function: { name: "f" } },
                    execute: () => "ok"
                }]
            };
            return callFuns(ctx, [{
                function: { name: "f", arguments: "{not-json" }
            }]).then((arr) => {
                expect(arr.length).toBe(1);
                expect(String(arr[0])).toContain("参数解析失败:");
            });
        });

        it("execute reject：该槽为 '运行出错:...', 其它槽正常返回", () => {
            const ctx = {
                tools: [
                    { description: { function: { name: "bad" } }, execute: async () => { throw new Error("boom"); } },
                    { description: { function: { name: "good" } }, execute: async () => "ok" },
                ]
            };
            return callFuns(ctx, [
                { function: { name: "bad", arguments: "{}" } },
                { function: { name: "good", arguments: "{}" } },
            ]).then((arr) => {
                expect(arr.length).toBe(2);
                // 用 String().includes 替代 toContain，避免 @oipage/testjs 对字符串-对象边界判断不一致
                expect(String(arr[0]).includes("运行出错:")).toBe(true);
                expect(arr[1]).toBe("ok");
            });
        });

        it("返回数组长度等于 tool_calls.length", () => {
            const ctx = { tools: [] };
            return callFuns(ctx, [
                { function: { name: "a", arguments: "{}" } },
                { function: { name: "b", arguments: "{}" } },
                { function: { name: "c", arguments: "{}" } },
            ]).then((arr) => {
                expect(arr.length).toBe(3);
            });
        });
    });

    // ----------------------- runConversation -----------------------
    describe("runConversation", () => {
        function fakeAgent({ responses, tools = [] }) {
            let i = 0;
            return {
                stream: false,
                tools,
                model: {
                    completions: async () => responses[i++]
                }
            };
        }

        it("无 tool_calls：返回 content, messages 增加 assistant", () => {
            const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
            const ctx = fakeAgent({
                responses: [{ content: "hello", tool_calls: undefined }]
            });

            return runConversation(ctx, messages).then((finalContent) => {
                expect(finalContent).toBe("hello");
                expect(messages).toEqual([
                    { role: "user", content: [{ type: "text", text: "hi" }] },
                    { role: "assistant", content: "hello" }
                ]);
            });
        });

        it("有 tool_calls：执行工具→追加 tool 消息→继续循环", () => {
            const messages = [{ role: "user", content: [{ type: "text", text: "weather?" }] }];
            const toolResult = "sunny";
            const ctx = fakeAgent({
                responses: [
                    {
                        content: null,
                        tool_calls: [{ id: "t1", function: { name: "w", arguments: "{}" } }]
                    },
                    { content: "It's sunny.", tool_calls: undefined }
                ],
                tools: [{ description: { function: { name: "w" } }, execute: async () => toolResult }]
            });

            return runConversation(ctx, messages).then((finalContent) => {
                expect(finalContent).toBe("It's sunny.");
                // 4 条：user / assistant(tool_calls) / tool / assistant(content)
                expect(messages.length).toBe(4);
                expect(messages[1].role).toBe("assistant");
                expect(messages[2].role).toBe("tool");
                expect(messages[2].tool_call_id).toBe("t1");
                expect(messages[2].tool_name).toBe("w");
                expect(messages[2].content).toBe("sunny");
                expect(messages[3].role).toBe("assistant");
                expect(messages[3].content).toBe("It's sunny.");
            });
        });

        it("tool 消息 content：非字符串值会被 JSON.stringify", () => {
            const messages = [];
            const ctx = fakeAgent({
                responses: [
                    { content: null, tool_calls: [{ id: "t1", function: { name: "w", arguments: "{}" } }] },
                    { content: "done", tool_calls: undefined }
                ],
                tools: [{ description: { function: { name: "w" } }, execute: async () => ({ a: 1 }) }]
            });

            return runConversation(ctx, messages).then(() => {
                const toolMsg = messages.find(m => m.role === "tool");
                expect(toolMsg.content).toBe(JSON.stringify({ a: 1 }));
            });
        });

        it("logback / thinkback 透传给 model.completions", () => {
            const messages = [];
            const completions = async (_params, logback, thinkback) => {
                logback && logback("LOG");
                thinkback && thinkback("THINK");
                return { content: "ok", tool_calls: undefined };
            };
            const ctx = { stream: false, tools: [], model: { completions } };

            const logs = [], thinks = [];
            return runConversation(ctx, messages,
                (t) => logs.push(t),
                (t) => thinks.push(t)
            ).then((c) => {
                expect(c).toBe("ok");
                expect(logs).toEqual(["LOG"]);
                expect(thinks).toEqual(["THINK"]);
            });
        });
    });

    // ----------------------- Agent.generate -----------------------
    describe("Agent.generate", () => {
        function makeAgent() {
            return new Agent({
                model: { baseURL: "http://x", apiKey: "", model: "m" },
                stream: false,
                tools: []
            });
        }

        it("不传 systemPrompt：messages 不被 unshift", () => {
            const agent = makeAgent();
            // 拦截 model 替换为假实现
            agent.model = {
                completions: async () => ({ content: "ok", tool_calls: undefined })
            };

            const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
            return agent.generate(messages).then((content) => {
                expect(content).toBe("ok");
                // user + assistant(content)=2
                expect(messages.length).toBe(2);
                expect(messages[0].role).toBe("user");
                expect(messages[1].role).toBe("assistant");
            });
        });

        it("传 systemPrompt：首条被替换为 system", () => {
            const agent = new Agent({
                model: { baseURL: "http://x", apiKey: "", model: "m" },
                systemPrompt: "you are helpful",
                stream: false,
                tools: []
            });
            agent.model = {
                completions: async () => ({ content: "ok", tool_calls: undefined })
            };

            const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
            return agent.generate(messages).then(() => {
                // systemPrompt 通过 messages.unshift({role:"system", ...}) 插入到第一条
                // 之后 runConversation 把 assistant(content) 追加到末尾
                expect(messages[0].role).toBe("system");
                expect(messages[0].content).toBe("you are helpful");
                expect(messages.length).toBe(3);   // system + user + assistant
                expect(messages[1].role).toBe("user");
                expect(messages[2].role).toBe("assistant");
            });
        });
    });

    // ----------------------- CreateTool -----------------------
    describe("CreateTool.create(backend)", () => {
        it("execute resolve：ms.send 收到 pending → success+result", () => {
            const sent = [];
            const ms = { send: (info) => sent.push(info) };
            const ct = new CreateTool(ms);
            const t = ct.create({
                description: { function: { name: "echo" } },
                execute: async (args) => "out:" + args.x
            });

            return t.execute({ x: 1 }).then((res) => {
                expect(res).toBe("out:1");
                // 注意：createTool.js 两次 send 共用 toolInfo 引用，
                // 第二次 send(initOption({status,result}, toolInfo)) 会把 status 合并进同一对象，
                // 所以 sent[0] === sent[1] 且最终 status 为 "success"。
                expect(sent.length).toBe(2);
                expect(sent[0]).toBe(sent[1]);        // 同一引用被原地更新
                expect(sent[0].name).toBe("echo");
                expect(sent[0].caller).toBe("backend");
                expect(sent[0].status).toBe("success");
                expect(sent[0].result).toBe("out:1");
            });
        });

        it("execute reject：ms.send 收到 pending → error+result(err)", () => {
            const sent = [];
            const ms = { send: (info) => sent.push(info) };
            const ct = new CreateTool(ms);
            const t = ct.create({
                description: { function: { name: "boom" } },
                execute: async () => { throw new Error("kapow"); }
            });

            return t.execute({}).then((res) => {
                // expect.toBeInstanceOf 在 @oipage/testjs 上不存在，改用 instanceof 手动断言
                expect(res instanceof Error).toBe(true);
                expect(res.message).toBe("kapow");
                // 同上：toolInfo 引用被原地更新
                expect(sent[0]).toBe(sent[1]);
                expect(sent[0].status).toBe("error");
                expect(sent[0].result).toBe(res);
            });
        });
    });

    describe("CreateTool.create(frontend)", () => {
        it("不传 execute：ms.send pending → globalThis[id] 注入结果 → resolve", () => {
            const sent = [];
            const ms = { send: (info) => sent.push(info) };
            const ct = new CreateTool(ms);
            const t = ct.create({
                description: { function: { name: "askUser" } }
            });

            const p = t.execute({ q: "are you sure?" });

            // 异步让 createTool 内部 _resolve = resolve; 完成赋值
            return Promise.resolve().then(() => {
                expect(sent.length).toBe(1);
                // status 字段当前为 pending（这一步尚未被 initOption 修改）
                expect(sent[0].status).toBe("pending");
                expect(sent[0].caller).toBe("frontend");
                expect(sent[0].name).toBe("askUser");
                expect(sent[0].id).toBeDefined();

                const id = sent[0].id;
                expect(typeof globalThis[id]).toBe("function");

                // 模拟 UI 回调
                globalThis[id]("USER_OK");

                return p.then((r) => {
                    expect(r).toBe("USER_OK");
                    expect(globalThis[id]).toBeUndefined(); // 已被 delete
                });
            });
        });
    });

};