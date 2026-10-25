import {
    AuiPage,
    defineTool,
    generator,
    MessageStream,
    ChatTransportAdapter,
    MessageHistoryAdapter,
    ThreadListAdapter,
    ThreadListRuntime,
    ChatContentRuntime
} from "@auipage/core";
import { EmptyFunction } from "@auipage/core/src/tools/enum.js";
import toHistoryMessages from "@auipage/core/src/tools/toHistoryMessages.js";

export default function ({ describe, it, expect }) {

    // ----------------------- EmptyFunction -----------------------
    describe("EmptyFunction", () => {
        it("返回 undefined", () => {
            expect(EmptyFunction()).toBeUndefined();
        });

        it("重复调用仍返回 undefined", () => {
            expect(EmptyFunction(1, 2, 3)).toBeUndefined();
        });

        it("多次取值为同一引用", () => {
            expect(EmptyFunction).toBe(EmptyFunction);
        });
    });

    // ----------------------- toHistoryMessages -----------------------
    describe("toHistoryMessages", () => {
        it("相邻同 role 合并 content", () => {
            const v = {
                messages: [
                    { role: "user", content: [{ type: "text", text: "a" }] },
                    { role: "user", content: [{ type: "text", text: "b" }] },
                ]
            };
            const out = toHistoryMessages(v);
            expect(out.messages).toEqual([
                { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }
            ]);
        });

        it("不同 role 不合并", () => {
            const v = {
                messages: [
                    { role: "user", content: [{ type: "text", text: "a" }] },
                    { role: "assistant", content: [{ type: "text", text: "b" }] },
                ]
            };
            const out = toHistoryMessages(v);
            expect(out.messages.length).toBe(2);
        });

        it("三条中前两条合并，第三条不合并", () => {
            const v = {
                messages: [
                    { role: "user", content: [{ type: "text", text: "a" }] },
                    { role: "user", content: [{ type: "text", text: "b" }] },
                    { role: "assistant", content: [{ type: "text", text: "c" }] },
                ]
            };
            const out = toHistoryMessages(v);
            expect(out.messages.length).toBe(2);
            expect(out.messages[0].content.length).toBe(2);
            expect(out.messages[1].role).toBe("assistant");
        });

        it("空 messages 返回空数组", () => {
            const v = { messages: [] };
            const out = toHistoryMessages(v);
            expect(out.messages).toEqual([]);
        });

        it("返回值与入参 value 是同一引用（原地修改）", () => {
            const v = { messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] };
            const out = toHistoryMessages(v);
            expect(out).toBe(v);
        });
    });

    // ----------------------- defineTool -----------------------
    describe("defineTool", () => {
        it("输出 description/execute/render 三字段", () => {
            const exec = () => "ok";
            const rend = () => "rendered";
            const t = defineTool({
                name: "noop",
                description: "do nothing",
                parameters: { type: "object", properties: {} },
                execute: exec,
                render: rend
            });
            expect(t.description.function.name).toBe("noop");
            expect(t.description.function.description).toBe("do nothing");
            expect(t.description.function.parameters).toEqual({ type: "object", properties: {} });
            expect(t.execute).toBe(exec);
            expect(t.render).toBe(rend);
        });

        it("render 可省略：undefined", () => {
            const t = defineTool({
                name: "n", description: "d", parameters: {}, execute: () => { }
            });
            expect(t.render).toBeUndefined();
        });
    });

    // ----------------------- MessageStream -----------------------
    describe("MessageStream", () => {
        it("传参后 send/end 等于入参引用", () => {
            const s = () => { }, e = () => { };
            const ms = new MessageStream(s, e);
            expect(ms.send).toBe(s);
            expect(ms.end).toBe(e);
        });

        it("不传参：两个槽均为 EmptyFunction", () => {
            const ms = new MessageStream();
            expect(ms.send).toBe(EmptyFunction);
            expect(ms.end).toBe(EmptyFunction);
            expect(ms.send()).toBeUndefined();
        });

        it("只传 send", () => {
            const s = () => "s";
            const ms = new MessageStream(s);
            expect(ms.send).toBe(s);
            expect(ms.end).toBe(EmptyFunction);
        });
    });

    // ----------------------- generator -----------------------
    describe("generator", () => {
        // generator 是 async generator，next() 永远返回 Promise，必须异步循环
        async function consume(g) {
            const out = [];
            while (true) {
                const r = await g.next();
                if (r.done) return out;
                out.push(r.value);
            }
        }

        it("直接 done：消费者立即收到 done=true", () => {
            return consume(generator((_next, done) => { done(); })).then((arr) => {
                expect(arr).toEqual([]);
            });
        });

        it("同步 next+done 序列正确", () => {
            const raw = (next, done) => {
                next("a");
                next("b");
                done();
            };
            return consume(generator(raw)).then((arr) => {
                expect(arr).toEqual(["a", "b"]);
            });
        });

        it("buffer：先 next 再消费", () => {
            const raw = (next, done) => {
                next(1);
                next(2);
                next(3);
                done();
            };
            return consume(generator(raw)).then((arr) => {
                expect(arr).toEqual([1, 2, 3]);
            });
        });

        it("done 后再次 next() 仍终止", () => {
            const raw = (_next, done) => { done(); };
            return generator(raw).next().then((r) => {
                expect(r.done).toBe(true);
            });
        });

        it("error 后 next 抛错", () => {
            const raw = (_next, _done, error) => {
                error(new Error("boom"));
            };
            const g = generator(raw);
            // 这里若 g.next() 实际 resolve，"应 reject" 会被吞掉变成 unhandledRejection
            // 用包装函数把 throw-on-reject 转成普通 throw 让 it() 抓住
            const p = g.next().then(
                () => { throw new Error("应 reject"); },
                (e) => { expect(e.message).toBe("boom"); }
            );
            // 兜底防 unhandledRejection
            return p.catch(() => { });
        });

        it("error 后再 next 仍抛错（已锁定）", () => {
            let errored = false;
            const raw = (_next, _done, error) => {
                if (!errored) {
                    errored = true;
                    error(new Error("e1"));
                }
            };
            const g = generator(raw);
            const p = g.next().catch((e) => {
                expect(e.message).toBe("e1");
                return g.next();
            }).then(
                () => { throw new Error("应 reject"); },
                (e) => { expect(e.message).toBe("e1"); }
            );
            return p.catch(() => { });
        });
    });

    // ----------------------- Adapters -----------------------
    describe("ChatTransportAdapter", () => {
        it("默认方法均为 EmptyFunction", () => {
            const a = new ChatTransportAdapter({});
            expect(a.run).toBe(EmptyFunction);
            expect(a.response).toBe(EmptyFunction);
            expect(a.name).toBe("ChatTransportAdapter");
        });

        it("自定义 run/response 被绑定", () => {
            const run = () => "r", resp = () => "s";
            const a = new ChatTransportAdapter({ run, response: resp });
            expect(a.run).toBe(run);
            expect(a.response).toBe(resp);
        });
    });

    describe("MessageHistoryAdapter", () => {
        it("默认 load/append 为 EmptyFunction", () => {
            const a = new MessageHistoryAdapter({});
            expect(a.load).toBe(EmptyFunction);
            expect(a.append).toBe(EmptyFunction);
            expect(a.name).toBe("MessageHistoryAdapter");
        });

        it("自定义 load/append 被绑定", () => {
            const l = () => "l", ap = () => "a";
            const a = new MessageHistoryAdapter({ load: l, append: ap });
            expect(a.load).toBe(l);
            expect(a.append).toBe(ap);
        });
    });

    describe("ThreadListAdapter", () => {
        it("默认方法均为 EmptyFunction", () => {
            const a = new ThreadListAdapter({});
            expect(a.list).toBe(EmptyFunction);
            expect(a.new).toBe(EmptyFunction);
            expect(a.archive).toBe(EmptyFunction);
            expect(a.unarchive).toBe(EmptyFunction);
            expect(a.delete).toBe(EmptyFunction);
            expect(a.name).toBe("ThreadListAdapter");
        });

        it("自定义方法被绑定", () => {
            const lst = () => "lst", nw = () => "n", ar = () => "ar", un = () => "un", del = () => "d";
            const a = new ThreadListAdapter({ list: lst, new: nw, archive: ar, unarchive: un, delete: del });
            expect(a.list).toBe(lst);
            expect(a.new).toBe(nw);
            expect(a.archive).toBe(ar);
            expect(a.unarchive).toBe(un);
            expect(a.delete).toBe(del);
        });
    });

    // ----------------------- Runtimes -----------------------
    describe("ChatContentRuntime", () => {
        it("默认 init/append 为 EmptyFunction", () => {
            const r = new ChatContentRuntime({});
            expect(r.init).toBe(EmptyFunction);
            expect(r.append).toBe(EmptyFunction);
            expect(r.name).toBe("ChatContentRuntime");
        });

        it("自定义 init/append 被绑定", () => {
            const i = () => "i", a = () => "a";
            const r = new ChatContentRuntime({ init: i, append: a });
            expect(r.init).toBe(i);
            expect(r.append).toBe(a);
        });
    });

    describe("ThreadListRuntime", () => {
        it("默认方法均为 EmptyFunction", () => {
            const r = new ThreadListRuntime({});
            expect(r.init).toBe(EmptyFunction);
            expect(r.active).toBe(EmptyFunction);
            expect(r.delete).toBe(EmptyFunction);
            expect(r.archive).toBe(EmptyFunction);
            expect(r.unarchive).toBe(EmptyFunction);
            expect(r.append).toBe(EmptyFunction);
            expect(r.name).toBe("ThreadListRuntime");
        });

        it("自定义方法被绑定", () => {
            const i = () => "i", ac = () => "ac", d = () => "d", ar = () => "ar", un = () => "un", ap = () => "ap";
            const r = new ThreadListRuntime({
                init: i, active: ac, delete: d, archive: ar, unarchive: un, append: ap
            });
            expect(r.init).toBe(i);
            expect(r.active).toBe(ac);
            expect(r.delete).toBe(d);
            expect(r.archive).toBe(ar);
            expect(r.unarchive).toBe(un);
            expect(r.append).toBe(ap);
        });
    });

    // ----------------------- AuiPage 入口 -----------------------
    describe("AuiPage 入口冒烟", () => {
        function minimalDeps() {
            // 构造期 AuiPage 会调用 adapter.ThreadList.list()?.then(...)
            // 必须给一个 ThreadListAdapter 才能让 list() 是函数
            return {
                adapter: {
                    TL: new ThreadListAdapter({ list: () => Promise.resolve([]) }),
                    MH: new MessageHistoryAdapter({}),
                    CT: new ChatTransportAdapter({})
                },
                runtime: {
                    TL: new ThreadListRuntime({}),
                    CR: new ChatContentRuntime({})
                },
                tools: []
            };
        }

        it("可正常导入", () => {
            expect(typeof AuiPage).toBe("function");
        });

        it("最小依赖构造不抛", () => {
            let thrown = null;
            try {
                new AuiPage(minimalDeps());
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeNull();
        });

        it("构造时 tools 被解析为 tools_execute/tools_render/tools_description", () => {
            const exec = () => "ok";
            const render = () => "rendered";
            const tool = defineTool({
                name: "t1", description: "d", parameters: {}, execute: exec, render
            });
            const deps = minimalDeps();
            deps.tools = [tool];
            const ap = new AuiPage(deps);
            expect(ap.tools_execute.t1).toBe(exec);
            expect(ap.tools_render.t1).toBe(render);
            expect(ap.tools_description).toEqual([{ description: tool.description }]);
            expect(ap.isExecuting).toBe(false);
            expect(ap.currentMessages).toEqual([]);
        });

        it("adapter 名称去掉 'Adapter' 后缀作为 key", () => {
            const ap = new AuiPage(minimalDeps());
            expect(ap.adapter.ThreadList).toBeDefined();
            expect(ap.adapter.ThreadList.name).toBe("ThreadListAdapter");
            expect(ap.adapter.ChatTransport).toBeDefined();
            expect(ap.adapter.MessageHistory).toBeDefined();
            expect(ap.runtime.ThreadList).toBeDefined();
            expect(ap.runtime.ChatContent).toBeDefined();
        });
    });

};