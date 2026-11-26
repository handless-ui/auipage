import { Agent, CreateTool } from "@auipage/agent";
import callFuns from "@auipage/agent/src/callFuns.js";
import { withTimeout } from "./helper.js";

export default function ({ describe, it, expect }) {

    function makeAgent(extra = {}) {
        const agent = new Agent({
            model: { baseURL: "http://x", apiKey: "", model: "m" },
            stream: false,
            tools: [],
            ...extra
        });
        agent.model = { completions: async () => ({ content: "ok", tool_calls: undefined }) };
        return agent;
    }

    // ----------------------- systemPrompt 去重 -----------------------
    describe("Agent systemPrompt", () => {
        it("复用同一 messages 数组时 system 只出现一次", () => {
            const agent = makeAgent({ systemPrompt: "S" });
            const messages = [{ role: "user", content: "hi" }];

            return withTimeout(
                agent.generate(messages).then(() => agent.generate(messages))
            ).then(() => {
                expect(messages.filter((m) => m.role === "system").length).toBe(1);
                expect(messages[0].content).toBe("S");
            });
        });

        it("首条是不同内容的 system 时仍会插入自己的 system", () => {
            const agent = makeAgent({ systemPrompt: "S" });
            const messages = [{ role: "system", content: "别的" }, { role: "user", content: "hi" }];

            return withTimeout(agent.generate(messages)).then(() => {
                expect(messages.length >= 2).toBe(true);
                expect(messages[0].content).toBe("S");
            });
        });

        it("messages 非数组时不崩", () => {
            const agent = makeAgent({ systemPrompt: "S" });
            return withTimeout(agent.generate(undefined)).then((content) => {
                expect(content).toBe("ok");
            });
        });
    });

    // ----------------------- maxSteps -----------------------
    describe("Agent maxSteps", () => {
        it("默认 0（不限制）", () => {
            expect(makeAgent().maxSteps).toBe(0);
        });

        it("达到上限后以 error reject，模型调用次数受控", () => {
            const agent = makeAgent({ maxSteps: 1 });
            let calls = 0;

            agent.model = {
                completions: async () => {
                    calls++;
                    return {
                        content: null,
                        tool_calls: [{ id: "t1", function: { name: "nope", arguments: "{}" } }]
                    };
                }
            };

            return withTimeout(agent.generate([])).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(calls).toBe(1);
                    expect(String(err.message)).toContain("maxSteps");
                }
            );
        });
    });

    // ----------------------- callFuns 边界 -----------------------
    describe("callFuns 边界", () => {
        it("arguments 为空字符串 → 按 {} 调用 execute", () => {
            const ctx = {
                tools: [{
                    description: { function: { name: "f" } },
                    execute: (args) => JSON.stringify(args)
                }]
            };
            return callFuns(ctx, [{ function: { name: "f", arguments: "" } }]).then((arr) => {
                expect(arr).toEqual(["{}"]);
            });
        });

        it("arguments 缺失 → 按 {} 调用 execute", () => {
            const ctx = {
                tools: [{
                    description: { function: { name: "f" } },
                    execute: (args) => JSON.stringify(args)
                }]
            };
            return callFuns(ctx, [{ function: { name: "f" } }]).then((arr) => {
                expect(arr).toEqual(["{}"]);
            });
        });

        it("工具缺少 execute → 该槽提示缺少 execute", () => {
            const ctx = { tools: [{ description: { function: { name: "f" } } }] };
            return callFuns(ctx, [{ function: { name: "f", arguments: "{}" } }]).then((arr) => {
                expect(arr).toEqual(["工具f缺少 execute"]);
            });
        });

        it("execute 返回 thenable（非原生 Promise）也能出值", () => {
            const ctx = {
                tools: [{
                    description: { function: { name: "t" } },
                    execute: () => ({ then: (ok) => ok("T") })
                }]
            };
            return callFuns(ctx, [{ function: { name: "t", arguments: "{}" } }]).then((arr) => {
                expect(arr).toEqual(["T"]);
            });
        });

        it("execute 同步抛错 → '运行出错:...'，不整轮中断", () => {
            const ctx = {
                tools: [{
                    description: { function: { name: "s" } },
                    execute: () => { throw new Error("sync-boom"); }
                }]
            };
            return callFuns(ctx, [{ function: { name: "s", arguments: "{}" } }]).then((arr) => {
                expect(String(arr[0]).includes("运行出错:")).toBe(true);
            });
        });
    });

    // ----------------------- CreateTool 前端工具 -----------------------
    describe("CreateTool 前端工具边界", () => {
        it("页面同步回传结果时不崩（Promise 先建后发）", () => {
            const sent = [];
            const ms = {
                send: (info) => {
                    sent.push(info);
                    if (typeof globalThis[info.id] === "function") globalThis[info.id]("SYNC");
                }
            };
            const ct = new CreateTool(ms);
            const t = ct.create({ description: { function: { name: "ask" } } });

            return withTimeout(t.execute({})).then((result) => {
                expect(result).toBe("SYNC");
                expect(globalThis[sent[0].id]).toBeUndefined();
            });
        });

        it("回传 status=error 时 reject，交给 callFuns 转文本", () => {
            const sent = [];
            const ms = {
                send: (info) => {
                    sent.push(info);
                    if (info.status === "pending") globalThis[info.id]("bad", "error");
                }
            };
            const ct = new CreateTool(ms);
            const t = ct.create({ description: { function: { name: "ask" } } });

            return withTimeout(t.execute({})).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(err).toBe("bad");
                    expect(globalThis[sent[0].id]).toBeUndefined();
                }
            );
        });

        it("超时后 reject 并清理 globalThis", () => {
            const sent = [];
            const ms = { send: (info) => sent.push(info) };
            const ct = new CreateTool(ms);
            const t = ct.create({ description: { function: { name: "ask" } } }, { timeout: 50 });

            const id = () => sent[0] && sent[0].id;

            return withTimeout(t.execute({})).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(String(err.message)).toContain("超时");
                    expect(globalThis[id()]).toBeUndefined();
                }
            );
        });
    });

};
