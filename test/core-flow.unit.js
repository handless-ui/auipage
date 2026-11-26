import { toModelMessages, generator } from "@auipage/core";
import toHistoryMessages from "@auipage/core/src/tools/toHistoryMessages.js";
import { createPage, withTimeout, flush } from "./helper.js";

export default function ({ describe, it, expect }) {

    // ----------------------- content 规范化 -----------------------
    describe("AuiPage 消息规范化", () => {
        it("字符串 content 只回显一次（不再逐字符）", () => {
            const { page, log } = createPage({
                parts: [{ type: "text", text: "hi" }]
            });

            return withTimeout(page.sendMessage({ role: "user", content: "你好世界" })).then(() => {
                // 第 1 条是用户回显，第 2 条是模型正文
                expect(log.chat.length).toBe(2);
                expect(log.chat[0][0]).toBe("user");
                expect(log.chat[0][1].type).toBe("text");
                expect(log.chat[0][1].text).toBe("你好世界");
            });
        });

        it("content 缺省时不崩，历史里仍是空片段数组", () => {
            const { page, log } = createPage({
                parts: [{ type: "text", text: "ok" }]
            });

            return withTimeout(page.sendMessage({ role: "user" })).then(() => {
                expect(log.chat.length).toBe(1);
                expect(page.currentMessages.length).toBe(1);
            });
        });
    });

    // ----------------------- 适配器 / 运行时容错 -----------------------
    describe("AuiPage 适配器容错", () => {
        it("普通对象适配器（无 name）可构造，同步 list 数组直接渲染", () => {
            const threads = [{ threadId: "t1" }];
            const { page, log } = createPage({ list: () => threads });

            expect(page.adapter.ThreadList).toBeDefined();
            expect(page.runtime.ChatContent).toBeDefined();
            // 同步返回值被直接消费，不再因 ?.then 崩
            expect(log.threads[0][0]).toBe("init");
            expect(log.threads[0][1]).toBe(threads);
        });

        it("run 同步抛错 → reject 且 isExecuting 复位", () => {
            const { page } = createPage({
                run: () => { throw new Error("no transport"); }
            });

            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(err.message).toBe("no transport");
                    expect(page.isExecuting).toBe(false);
                }
            );
        });

        it("run 返回空值 → reject 且 isExecuting 复位", () => {
            const { page } = createPage({ run: () => null });

            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(err).toBe("ChatTransport.run() 返回空值");
                    expect(page.isExecuting).toBe(false);
                }
            );
        });

        it("未实现的 unarchiveThread 不抛；同步返回 true 时调用运行时", () => {
            const { page, log } = createPage({});
            page.unarchiveThread("t1");
            expect(log.threads.length).toBe(0);

            const sync = createPage({ unarchiveThread: () => true });
            sync.page.unarchiveThread("t2");
            expect(sync.log.threads[0][0]).toBe("unarchive");
            expect(sync.log.threads[0][1]).toBe("t2");
        });

        it("activeThread + load 同步返回 → 直接渲染历史", () => {
            const groups = [
                { messages: [{ role: "user", content: [{ type: "text", text: "旧" }] }] }
            ];
            const { page, log } = createPage({ load: () => groups });

            page.activeThread("t1");

            expect(page.currentThreadId).toBe("t1");
            expect(page.currentMessages).toBe(groups);
            expect(log.chatInit[0]).toEqual(groups[0].messages);
        });
    });

    // ----------------------- 前端工具 -----------------------
    describe("AuiPage 前端工具", () => {
        const tool = (name, execute, render) => ({
            description: { function: { name } },
            execute,
            render
        });

        it("ChatContent.append 返回 undefined 时工具照常完成（不再锁死）", () => {
            const { page, log } = createPage({
                parts: [
                    { type: "tool-call", status: "pending", id: "c1", name: "show", caller: "frontend", args: { a: 1 } },
                    { type: "text", text: "done" }
                ],
                tools: [tool("show", (args) => "ok:" + args.a)]
            });

            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(() => {
                expect(page.isExecuting).toBe(false);
                expect(log.responses.length).toBe(1);
                expect(log.responses[0][0]).toBe("tool-result");
                expect(log.responses[0][1].id).toBe("c1");
                expect(log.responses[0][1].status).toBe("success");
                expect(log.responses[0][1].result).toBe("ok:1");
            });
        });

        it("工具抛错 → status=error，流程继续", () => {
            const { page, log } = createPage({
                parts: [
                    { type: "tool-call", status: "pending", id: "c2", name: "boom", caller: "frontend", args: {} },
                    { type: "text", text: "done" }
                ],
                tools: [tool("boom", () => { throw new Error("kapow"); })]
            });

            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(() => {
                expect(log.responses[0][1].status).toBe("error");
                expect(log.responses[0][1].result.message).toBe("kapow");
            });
        });

        it("带 render + 视图 updater → 回传 render 的结果", () => {
            let updates = 0;
            const onAppend = () => (arg) => {
                updates++;
                return Promise.resolve(arg && arg.render ? "UI_OK" : undefined);
            };

            const { page, log } = createPage({
                parts: [
                    { type: "tool-call", status: "pending", id: "c3", name: "ask", caller: "frontend", args: {} },
                    { type: "text", text: "done" }
                ],
                onAppend,
                tools: [tool("ask", () => "TOOL", () => "RENDER")]
            });

            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(() => {
                expect(log.responses[0][1].status).toBe("success");
                expect(log.responses[0][1].result).toBe("UI_OK");
                expect(updates >= 2).toBe(true);
            });
        });
    });

    // ----------------------- 生命周期与入库 -----------------------
    describe("AuiPage 生命周期与入库", () => {
        it("完整流程：task:start → task:end(complete) → 历史入库一组", () => {
            const events = [];
            const { page, log } = createPage({
                parts: [{ type: "text", text: "hi" }]
            });
            page.on("task:start", () => events.push("start"));
            page.on("task:end", (p) => events.push(p.status));

            return withTimeout(page.sendMessage({ role: "user", content: [{ type: "text", text: "q" }] })).then(() => {
                expect(events).toEqual(["start", "complete"]);
                expect(page.currentMessages.length).toBe(1);
                expect(log.appends.length).toBe(1);
                expect(log.appends[0][0]).toBe("thread-1");
                // 新建会话：runtime 追加会话并激活
                expect(log.threads[0][0]).toBe("append");
                expect(log.threads[1][0]).toBe("active");
                expect(log.threads[1][1]).toBe("thread-1");
            });
        });

        it("入库失败 → reject + task:end(error) + isExecuting 复位", () => {
            const events = [];
            const { page } = createPage({
                parts: [{ type: "text", text: "hi" }],
                append: () => Promise.reject(new Error("disk full"))
            });
            page.on("task:end", (p) => events.push(p.status));

            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(err.message).toBe("disk full");
                    expect(events).toEqual(["error"]);
                    expect(page.isExecuting).toBe(false);
                }
            );
        });

        it("新建会话失败（new 返回空） → reject '新建会话失败'", () => {
            const { page } = createPage({
                parts: [{ type: "text", text: "hi" }],
                newThread: () => undefined
            });

            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(err.message).toBe("新建会话失败");
                    expect(page.isExecuting).toBe(false);
                }
            );
        });

        it("执行中再次发送 → reject '当前正在执行中'", () => {
            const { page } = createPage({
                parts: [{ type: "text", text: "slow" }],
                append: () => new Promise(() => { })    // 永不返回，保持执行中
            });

            const first = page.sendMessage({ role: "user", content: [] });
            return withTimeout(page.sendMessage({ role: "user", content: [] })).then(
                () => { throw new Error("应 reject"); },
                (err) => {
                    expect(err).toBe("当前正在执行中");
                    expect(first).toBeDefined();
                }
            );
        });
    });

    // ----------------------- toHistoryMessages -----------------------
    describe("toHistoryMessages", () => {
        it("同 role 相邻消息合并 content", () => {
            const v = {
                messages: [
                    { role: "user", content: [{ type: "text", text: "a" }] },
                    { role: "user", content: [{ type: "text", text: "b" }] }
                ]
            };
            const out = toHistoryMessages(v);
            expect(out.messages.length).toBe(1);
            expect(out.messages[0].content.length).toBe(2);
        });

        it("不改写入参消息对象（content 数组不被追加）", () => {
            const first = { role: "user", content: [{ type: "text", text: "a" }] };
            const second = { role: "user", content: [{ type: "text", text: "b" }] };
            const out = toHistoryMessages({ messages: [first, second] });

            expect(out.messages[0].content.length).toBe(2);
            expect(first.content.length).toBe(1);
        });
    });

    // ----------------------- toModelMessages -----------------------
    describe("toModelMessages", () => {
        it("文本拼接、thinking 过滤、工具调用转 assistant + tool", () => {
            const history = [{
                messages: [
                    { role: "user", content: [{ type: "text", text: "查天气" }] },
                    {
                        role: "assistant", content: [
                            { type: "thinking", text: "先想一想" },
                            { type: "text", text: "我查一下" },
                            {
                                type: "tool-call", id: "c1", name: "weather",
                                args: { city: "南京" }, result: "晴", status: "success"
                            }
                        ]
                    }
                ]
            }];

            const out = toModelMessages(history);

            expect(out.length).toBe(3);
            expect(out[0]).toEqual({ role: "user", content: "查天气" });
            expect(out[1].role).toBe("assistant");
            expect(out[1].content).toBe("我查一下");
            expect(out[1].tool_calls[0].id).toBe("c1");
            expect(out[1].tool_calls[0].function.name).toBe("weather");
            expect(out[1].tool_calls[0].function.arguments).toBe(JSON.stringify({ city: "南京" }));
            expect(out[2]).toEqual({
                role: "tool",
                tool_call_id: "c1",
                tool_name: "weather",
                content: "晴"
            });
        });

        it("未结束的工具调用被丢弃，只留文本", () => {
            const out = toModelMessages([{
                role: "assistant",
                content: [
                    { type: "text", text: "等一下" },
                    { type: "tool-call", id: "c2", name: "w", status: "pending" }
                ]
            }]);

            expect(out.length).toBe(1);
            expect(out[0].content).toBe("等一下");
            expect(out[0].tool_calls).toBeUndefined();
        });

        it("缺 id 时生成稳定 id，tool 消息能对应上", () => {
            const out = toModelMessages([{
                role: "assistant",
                content: [
                    { type: "tool-call", name: "w", args: {}, result: 1, status: "success" }
                ]
            }]);

            expect(out[0].tool_calls[0].id).toBe("call_1");
            expect(out[1].tool_call_id).toBe("call_1");
            expect(out[1].content).toBe("1");
        });

        it("错误对象结果转成可读文本，不是 '{}'", () => {
            const out = toModelMessages([{
                role: "assistant",
                content: [
                    { type: "tool-call", id: "c9", name: "w", args: {}, result: new Error("boom"), status: "error" }
                ]
            }]);

            expect(out[1].content).toBe("Error: boom");
        });
    });

    // ----------------------- generator 取消 -----------------------
    describe("generator 取消", () => {
        it("消费者 return 后生产者推送被丢弃，不抛错", () => {
            let push = null;
            const g = generator((next) => { push = next; });

            // async generator 惰性启动：先 next() 才会执行生产者函数
            const first = g.next();
            push("first");

            return withTimeout(first).then((r) => {
                expect(r.value).toBe("first");
                return g.return();
            }).then((r) => {
                expect(r.done).toBe(true);
                // 已取消：推送应被静默丢弃
                push("after-return");
                return g.next();
            }).then((r) => {
                expect(r.done).toBe(true);
            });
        });
    });

    // ----------------------- 主动结束与取消 -----------------------
    describe("AuiPage 主动结束与取消", () => {

        it("空闲时 stop() / cancel() 都返回 false", () => {
            const { page } = createPage();
            expect(page.stop()).toBe(false);
            expect(page.cancel()).toBe(false);
        });

        it("stop() 当成功收尾：resolve、标记 stopped、已产出内容保留", () => {
            let context = null;

            const { page, log } = createPage({
                run: (params) => {
                    context = params.context;
                    return (async function* () {
                        yield { type: "thinking", text: "想" };
                        // 等页面停止后才继续，用于验证后续分片被丢弃
                        await new Promise((resolve) => {
                            params.context.signal.addEventListener("abort", resolve);
                        });
                        yield { type: "text", text: "不该出现" };
                    })();
                }
            });

            const events = [];
            page.on("task:end", (payload) => events.push(payload));

            const promise = page.sendMessage({ role: "user", content: "你好" });

            return flush().then(() => {
                expect(page.isExecuting).toBe(true);
                expect(page.stop()).toBe(true);
                expect(context.signal.aborted).toBe(true);

                return withTimeout(promise).then(() => {
                    // stop 属于成功收尾，不该 reject
                });
            }).then(() => {
                const payload = events[events.length - 1];

                expect(payload.status).toBe("stopped");
                expect(payload.by).toBe("user");
                expect(payload.displayed).toBe(undefined);

                // 停止后的分片不再渲染
                expect(log.chat.every(([, part]) => part.text !== "不该出现")).toBe(true);

                // 这轮照样入库，带 stopped 标记
                expect(log.appends.length).toBe(1);
                expect(log.appends[0][1].status).toBe("stopped");

                expect(page.isExecuting).toBe(false);
                expect(page.stop()).toBe(false);
            });
        });

        it("cancel() 取消本轮：以「已取消」reject，进度上报，入库标记 cancelled", () => {
            let context = null;

            const { page, log } = createPage({
                run: (params) => {
                    context = params.context;
                    return (async function* () {
                        yield { type: "thinking", text: "想" };
                        await new Promise((resolve) => {
                            params.context.signal.addEventListener("abort", resolve);
                        });
                        yield { type: "text", text: "不该出现" };
                    })();
                }
            });

            const events = [];
            page.on("task:end", (payload) => events.push(payload));

            const promise = page.sendMessage({ role: "user", content: "你好" });

            return flush().then(() => {
                expect(page.cancel()).toBe(true);
                expect(context.signal.aborted).toBe(true);

                return withTimeout(promise).then(
                    () => { throw new Error("取消后应 reject"); },
                    (error) => { expect(error).toBe("已取消"); }
                );
            }).then(() => {
                const payload = events[events.length - 1];

                expect(payload.status).toBe("cancelled");
                expect(payload.by).toBe("user");
                expect(payload.displayed.length).toBe(2);
                expect(payload.displayed[0].index).toBe(0);
                expect(payload.displayed[1].role).toBe("assistant");

                expect(log.chat.every(([, part]) => part.text !== "不该出现")).toBe(true);

                expect(log.appends.length).toBe(1);
                expect(log.appends[0][1].status).toBe("cancelled");

                expect(page.isExecuting).toBe(false);
                expect(page.cancel()).toBe(false);
            });
        });

        it("适配器忽略 signal 时，兜底超时强制收尾", () => {
            const { page } = createPage({
                stopTimeout: 60,
                run: () => (async function* () {
                    await new Promise(() => { });
                })()
            });

            const promise = page.sendMessage({ role: "user", content: "你好" });

            return flush().then(() => {
                expect(page.cancel()).toBe(true);
                return withTimeout(promise, 1000, "取消兜底");
            }).then(
                () => { throw new Error("取消后应 reject"); },
                (error) => {
                    expect(error).toBe("已取消");
                    expect(page.isExecuting).toBe(false);
                }
            );
        });

        it("取消后可以立即发送下一条", () => {
            let calls = 0;

            const { page } = createPage({
                stopTimeout: 80,
                run: () => {
                    calls += 1;

                    // 第一条挂住，模拟一个不理 signal 的适配器
                    if (calls === 1) {
                        return (async function* () {
                            await new Promise(() => { });
                        })();
                    }

                    return generator((next, done) => {
                        next({ type: "text", text: "第二条" });
                        done();
                    });
                }
            });

            const first = page.sendMessage({ role: "user", content: "一" });

            return flush().then(() => {
                page.cancel();
                return withTimeout(first, 1000, "第一条").then(
                    null,
                    (error) => { expect(error).toBe("已取消"); }
                );
            }).then(() => withTimeout(page.sendMessage({ role: "user", content: "二" }), 1000, "第二条"))
                .then(() => {
                    expect(page.isExecuting).toBe(false);
                });
        });
    });

    // ----------------------- 工具里的 stop / cancel -----------------------
    describe("AuiPage 工具控制句柄", () => {

        const tool = (execute, render) => [{
            description: {
                type: "function",
                function: { name: "finish", description: "结束这一轮", parameters: {} }
            },
            execute,
            render
        }];

        const toolPart = (extra = {}) => Object.assign({
            type: "tool-call",
            id: "c1",
            name: "finish",
            caller: "frontend",
            args: {},
            status: "pending"
        }, extra);

        it("execute 里 stop()：结果照常入库，整轮按 stopped 结束", () => {
            const { page, log } = createPage({
                tools: tool((args, control) => {
                    expect(typeof control.stop).toBe("function");
                    expect(control.toolCallId).toBe("c1");
                    control.stop();
                    return "已完成";
                }),
                run: () => (async function* () {
                    yield toolPart();
                })()
            });

            const events = [];
            page.on("task:end", (payload) => events.push(payload));

            return withTimeout(page.sendMessage({ role: "user", content: "开始" })).then(() => {
                const payload = events[events.length - 1];

                expect(payload.status).toBe("stopped");
                expect(payload.by).toBe("tool");

                // 这次工具调用要落进消息里，不能因为提前结束被丢掉
                const group = log.appends[0][1];
                expect(group.status).toBe("stopped");

                const parts = group.messages.reduce((all, msg) => all.concat(msg.content), []);
                const call = parts.filter((part) => part.type === "tool-call")[0];
                expect(call.result).toBe("已完成");
            });
        });

        it("execute 里 cancel()：结果丢弃，整轮按 cancelled 结束", () => {
            const { page, log } = createPage({
                tools: tool((args, control) => {
                    control.cancel();
                    return "不该落库";
                }),
                run: () => (async function* () {
                    yield toolPart();
                })()
            });

            const events = [];
            page.on("task:end", (payload) => events.push(payload));

            return withTimeout(page.sendMessage({ role: "user", content: "开始" })).then(
                () => { throw new Error("取消后应 reject"); },
                (error) => {
                    expect(error).toBe("已取消");

                    const payload = events[events.length - 1];
                    expect(payload.status).toBe("cancelled");
                    expect(payload.by).toBe("tool");

                    // 取消的那次调用不写进消息
                    const group = log.appends[0][1];
                    expect(group.status).toBe("cancelled");
                    const parts = group.messages.reduce((all, msg) => all.concat(msg.content), []);
                    expect(parts.filter((part) => part.type === "tool-call").length).toBe(0);
                }
            );
        });

        it("render 里 stop()：结束悬挂的界面等待，按 execute 结果收尾", () => {
            let control = null;

            const { page, log } = createPage({
                tools: tool(() => "已查", (data) => {
                    // 模拟一个等用户点击的卡片：永不 resolve，只能靠 stop 打断
                    control = data;
                    return new Promise(() => { });
                }),
                onAppend: (role, part) => {
                    // 把 append 的返回值当作 updater：界面在这里调用 render
                    return (data) => data.render ? data.render(data) : undefined;
                },
                run: () => (async function* () {
                    yield toolPart();
                })()
            });

            const events = [];
            page.on("task:end", (payload) => events.push(payload));

            const promise = page.sendMessage({ role: "user", content: "开始" });

            return flush().then(() => {
                expect(typeof control.stop).toBe("function");
                expect(control.stop()).toBe(true);

                return withTimeout(promise);
            }).then(() => {
                const payload = events[events.length - 1];
                expect(payload.status).toBe("stopped");
                expect(payload.by).toBe("tool");

                const group = log.appends[0][1];
                expect(group.status).toBe("stopped");
                const parts = group.messages.reduce((all, msg) => all.concat(msg.content), []);
                const call = parts.filter((part) => part.type === "tool-call")[0];
                expect(call.result).toBe("已查");
            });
        });
    });

};
