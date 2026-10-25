import { createFetch } from "@auipage/fetch/src/fetch.js";
import { Emitter } from "@auipage/fetch/src/emitter.js";
import { Response } from "@auipage/fetch/src/response.js";

export default function ({ describe, it, expect }) {

    describe("Emitter", () => {
        it("on 后 emit 触发且顺序、参数正确", () => {
            const e = new E();
            const received = [];
            e.on("ping", (a, b) => received.push([a, b]));

            const result = e.emit("ping", 1, "x");

            expect(result).toBe(true);
            expect(received).toEqual([[1, "x"]]);
        });

        it("off 后不再触发", () => {
            const e = new E();
            const fn = () => calls.push(1);
            const calls = [];
            e.on("x", fn);
            e.off("x", fn);
            e.emit("x");

            expect(calls).toEqual([]);
        });

        it("同事件多 listener 全部触发", () => {
            const e = new E();
            const calls = [];
            e.on("x", () => calls.push("a"));
            e.on("x", () => calls.push("b"));
            e.emit("x");

            expect(calls).toEqual(["a", "b"]);
        });

        it("无 listener 时 emit 返回 false，有则返回 true", () => {
            const e = new E();
            expect(e.emit("nope")).toBe(false);

            e.on("yep", () => { });
            expect(e.emit("yep")).toBe(true);
        });

        it("on 非函数 listener 被忽略", () => {
            const e = new E();
            e.on("x", 123);
            e.on("x", null);
            // 不抛 + 仍然 false
            expect(e.emit("x")).toBe(false);
        });

        it("on / off 链式返回 this", () => {
            const e = new E();
            const fn = () => { };
            expect(e.on("x", fn)).toBe(e);
            expect(e.off("x", fn)).toBe(e);
        });

        it("listener 在 emit 中 off 自己不影响本次派发（拷贝切片）", () => {
            const e = new E();
            const calls = [];
            const me = () => { calls.push(1); e.off("x", me); };
            e.on("x", me);
            e.on("x", () => calls.push(2));

            e.emit("x");
            e.emit("x");

            // 第一次 me 被调用并 off 自己 → 收到 1,2；第二次只剩另一个 → 2
            expect(calls).toEqual([1, 2, 2]);
        });

        it("listener 抛错不影响其它 listener（queueMicrotask 抛出）", () => {
            const e = new E();
            const calls = [];

            // 源码用 queueMicrotask(()=>{throw e}) 重新抛出，Node 中走 uncaughtException
            const handler = (err) => {
                calls.push(["boom", err.message]);
            };
            process.once("uncaughtException", handler);

            e.on("x", () => calls.push("before"));
            e.on("x", () => { throw new Error("boom"); });
            e.on("x", () => calls.push("after"));

            e.emit("x");

            // 同步阶段：before、after 已被加入（抛错的 listener 被 try/catch 抓住转 queueMicrotask）
            expect(calls).toEqual(["before", "after"]);

            return new Promise((resolve) => {
                setTimeout(() => {
                    // 异步阶段：错误被抛到 uncaughtException
                    expect(calls).toEqual(["before", "after", ["boom", "boom"]]);
                    resolve();
                }, 20);
            });
        });
    });

    describe("Response 基础事件与 _done 锁定", () => {
        it("_push('data') 触发 data 事件", () => {
            const r = new Response();
            const got = [];
            r.on("data", (v) => got.push(v));
            r._push("data", "a");
            r._push("data", "b");

            expect(got).toEqual(["a", "b"]);
            expect(r._done).toBe(false);
        });

        it("end 后再 push('data') 不再触发（_done 锁定）", () => {
            const r = new Response();
            const got = [];
            r.on("data", (v) => got.push(v));
            r.on("end", () => { });

            r._push("data", "1");
            r._push("end");
            r._push("data", "2"); // 应被丢弃

            expect(got).toEqual(["1"]);
            expect(r._done).toBe(true);
        });

        it("_push('error') 后 _done=true，再次 push（type==='error'）也会触发 error 事件", () => {
            // 注意：源码中只有非 error 类型的 push 会被 _done 屏蔽；error 总是触发
            const r = new Response();
            const errs = [];
            r.on("error", (e) => errs.push(e));

            const e1 = new Error("e1");
            const e2 = new Error("e2");
            r._push("error", e1);
            r._push("error", e2);

            expect(errs).toEqual([e1, e2]);
            expect(r._done).toBe(true);
        });
    });

    describe("Response SSE 解析", () => {
        function newSse() {
            const r = new Response();
            // 触发 SSE 模式：模仿 createFetch 在 onResponse 中设置
            r._sseMode = true;
            return r;
        }

        it("单事件 data: hello 解析为 'hello'", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));

            r._push("data", "data: hello\n\n");

            expect(got).toEqual(["hello"]);
        });

        it("多事件按顺序触发", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));

            r._push("data", "data: a\n\ndata: b\n\n");

            expect(got).toEqual(["a", "b"]);
        });

        it("data: 多行内容用 \\n 拼接", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));

            r._push("data", "data: line1\ndata: line2\n\n");

            expect(got).toEqual(["line1\nline2"]);
        });

        it("不含 data: 行被忽略", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));

            r._push("data", "event: foo\ndata: bar\n\n");

            expect(got).toEqual(["bar"]);
        });

        it("chunk 跨边界拼接正确", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));

            r._push("data", "data: hel");   // 不完整事件，留在 buffer
            r._push("data", "lo\n\n");      // 补全

            expect(got).toEqual(["hello"]);
        });

        it("\\r\\n 变体也能解析", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));

            r._push("data", "data: a\r\n\r\ndata: b\r\n\r\n");

            expect(got).toEqual(["a", "b"]);
        });

        it("end 时 flush 缓冲区残留", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));
            r.on("end", () => { });

            r._push("data", "data: trailing");   // 无结尾
            r._push("end");                       // 应 flush

            expect(got).toEqual(["trailing"]);
        });

        it("end 后再 push('data') 被丢弃", () => {
            const r = newSse();
            const got = [];
            r.on("data", (v) => got.push(v));
            r.on("end", () => { });

            r._push("data", "data: a\n\n");
            r._push("end");
            r._push("data", "data: b\n\n");   // 被 _done 屏蔽

            expect(got).toEqual(["a"]);
        });
    });

    describe("createFetch", () => {
        it("options.url 缺失 → Promise reject", () => {
            const fetch = createFetch(() => { });
            const p = fetch({});
            return p.then(
                () => { throw new Error("应 reject"); },
                (err) => { expect(err.message).toContain("url"); }
            );
        });

        it("正常路径：onResponse/onData/onEnd 触发后消费者按序收到 data/end, status 同步", () => {
            const fakeAdapter = (options, { onResponse, onData, onEnd }) => {
                onResponse({ status: 200, headers: { "content-type": "text/plain" } });
                onData("a");
                onData("b");
                onEnd();
            };
            const fetch = createFetch(fakeAdapter);

            return fetch({ url: "x://x" }).then((res) => {
                expect(res.status).toBe(200);
                expect(res.ok).toBe(true);
                expect(res.headers["content-type"]).toBe("text/plain");
                expect(res._sseMode).toBe(false);

                const got = [];
                return new Promise((resolve, reject) => {
                    res.on("data", (v) => got.push(v));
                    res.on("end", () => {
                        expect(got).toEqual(["a", "b"]);
                        resolve();
                    });
                    res.on("error", reject);
                });
            });
        });

        it("SSE content-type 触发 _sseMode=true", () => {
            const fakeAdapter = (options, { onResponse, onData, onEnd }) => {
                onResponse({ status: 200, headers: { "content-type": "text/event-stream" } });
                onData("data: hi\n\n");
                onEnd();
            };
            const fetch = createFetch(fakeAdapter);

            return fetch({ url: "x://x" }).then((res) => {
                expect(res._sseMode).toBe(true);

                return new Promise((resolve, reject) => {
                    const got = [];
                    res.on("data", (v) => got.push(v));
                    res.on("end", () => {
                        expect(got).toEqual(["hi"]);
                        resolve();
                    });
                    res.on("error", reject);
                });
            });
        });

        it("非 200 状态码 ok=false", () => {
            const fakeAdapter = (options, { onResponse, onData, onEnd }) => {
                onResponse({ status: 500, headers: {} });
                onEnd();
            };
            const fetch = createFetch(fakeAdapter);

            return fetch({ url: "x://x" }).then((res) => {
                expect(res.status).toBe(500);
                expect(res.ok).toBe(false);
            });
        });

        it("adapter onError → Promise reject 且 Response 触发 error 事件", () => {
            const fakeAdapter = (options, { onError }) => {
                onError(new Error("net down"));
            };
            const fetch = createFetch(fakeAdapter);

            return fetch({ url: "x://x" }).then(
                () => { throw new Error("应 reject"); },
                (err) => { expect(err.message).toBe("net down"); }
            );
        });
    });

    // 内部 alias（Emitter 无需重命名；保留兼容写法）
    function E() { return new Emitter(); }

};