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

        it("listener 抛错不影响其它 listener（console.error 上报）", () => {
            const e = new E();
            const calls = [];
            const logged = [];

            // 源码把 listener 异常交给 console.error，不再抛到 uncaughtException
            const originError = console.error;
            console.error = (...args) => logged.push(args);

            try {
                e.on("x", () => calls.push("before"));
                e.on("x", () => { throw new Error("boom"); });
                e.on("x", () => calls.push("after"));

                e.emit("x");
            } finally {
                console.error = originError;
            }

            // 抛错的 listener 被隔离，前后监听照常执行
            expect(calls).toEqual(["before", "after"]);
            expect(logged.length).toBe(1);
            expect(logged[0][0].message).toBe("boom");
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

    describe("Response 工具方法", () => {
        it("header(name) 兼容普通对象与 Headers", () => {
            const r = new Response();

            r.headers = { "content-type": "text/plain" };
            expect(r.header("content-type")).toBe("text/plain");
            expect(r.header("missing")).toBeUndefined();

            r.headers = new Headers({ "content-type": "text/event-stream" });
            expect(r.header("content-type")).toBe("text/event-stream");
        });

        it("cancel() 调用注入的 _cancel", () => {
            const r = new Response();
            let cancelled = 0;
            r._cancel = () => { cancelled++; };

            expect(r.cancel()).toBe(r);
            expect(cancelled).toBe(1);
        });
    });

    describe("createFetch", () => {
        // 真实适配器都是异步投递事件的；这里用 0ms 定时器模拟，保证消费方先注册监听
        function asyncAdapter(emit) {
            return (options, hooks) => {
                setTimeout(() => emit(options, hooks), 0);
            };
        }

        it("options.url 缺失 → Promise reject", () => {
            const fetch = createFetch(() => { });
            const p = fetch({});
            return p.then(
                () => { throw new Error("应 reject"); },
                (err) => { expect(err.message).toContain("url"); }
            );
        });

        it("正常路径：data/end 按序到达，status 同步", () => {
            const fetch = createFetch(asyncAdapter((options, { onResponse, onData, onEnd }) => {
                onResponse({ status: 200, headers: { "content-type": "text/plain" } });
                onData("a");
                onData("b");
                onEnd();
            }));

            return fetch({ url: "x://x" }).then((res) => {
                // 响应头到达前 status 为 0，断言要放在事件回调里
                expect(res.status).toBe(0);

                const got = [];
                return new Promise((resolve, reject) => {
                    res.on("data", (v) => got.push(v));
                    res.on("end", () => {
                        expect(res.status).toBe(200);
                        expect(res.ok).toBe(true);
                        expect(res.header("content-type")).toBe("text/plain");
                        expect(res._sseMode).toBe(false);
                        expect(got).toEqual(["a", "b"]);
                        resolve();
                    });
                    res.on("error", reject);
                });
            });
        });

        it("SSE content-type 触发 _sseMode=true", () => {
            const fetch = createFetch(asyncAdapter((options, { onResponse, onData, onEnd }) => {
                onResponse({ status: 200, headers: { "content-type": "text/event-stream" } });
                onData("data: hi\n\n");
                onEnd();
            }));

            return fetch({ url: "x://x" }).then((res) => {
                return new Promise((resolve, reject) => {
                    const got = [];
                    res.on("data", (v) => got.push(v));
                    res.on("end", () => {
                        expect(res._sseMode).toBe(true);
                        expect(got).toEqual(["hi"]);
                        resolve();
                    });
                    res.on("error", reject);
                });
            });
        });

        it("非 2xx：ok=false + http-error 事件，错误体仍能读到", () => {
            const fetch = createFetch(asyncAdapter((options, { onResponse, onData, onEnd }) => {
                onResponse({ status: 500, headers: { "content-type": "application/json" } });
                onData('{"error":"boom"}');
                onEnd();
            }));

            return fetch({ url: "x://x" }).then((res) => {
                const metas = [];
                const got = [];
                return new Promise((resolve, reject) => {
                    res.on("http-error", (meta) => metas.push(meta));
                    res.on("data", (v) => got.push(v));
                    res.on("end", () => {
                        expect(metas.length).toBe(1);
                        expect(metas[0].status).toBe(500);
                        expect(res.status).toBe(500);
                        expect(res.ok).toBe(false);
                        expect(got).toEqual(['{"error":"boom"}']);
                        resolve();
                    });
                    res.on("error", reject);
                });
            });
        });

        it("adapter onError → Promise reject；Response 侧 error 事件被 _done 屏蔽", () => {
            const fetch = createFetch((options, { onError }) => {
                onError(new Error("net down"));
            });

            return fetch({ url: "x://x" }).then(
                () => { throw new Error("应 reject"); },
                (err) => { expect(err.message).toBe("net down"); }
            );
        });

        it("adapter 返回 Promise 拒绝 → 走 error 事件（Promise 已 resolve）", () => {
            const fetch = createFetch(() => Promise.reject(new Error("adapter down")));

            return fetch({ url: "x://x" }).then((res) => new Promise((resolve, reject) => {
                res.on("error", (err) => {
                    expect(err.message).toBe("adapter down");
                    resolve();
                });
                // 该用例只关心 error 事件
                setTimeout(() => reject(new Error("未触发 error 事件")), 500);
            }));
        });

        it("timeout：到点通过 error 事件返回超时", () => {
            const fetch = createFetch(() => { /* 永不投递 */ });

            return fetch({ url: "x://x", timeout: 30 }).then((res) => new Promise((resolve, reject) => {
                res.on("error", (err) => {
                    expect(err.message).toContain("超时");
                    expect(res._done).toBe(true);
                    resolve();
                });
                setTimeout(() => reject(new Error("未触发超时")), 500);
            }));
        });

        it("外部 signal abort → reject 已取消", () => {
            const fetch = createFetch(asyncAdapter(() => { }));
            const ctrl = new AbortController();
            const p = fetch({ url: "x://x", signal: ctrl.signal });

            ctrl.abort();

            return p.then(
                () => { throw new Error("应 reject"); },
                (err) => { expect(err.message).toContain("已取消"); }
            );
        });

        it("普通对象 body 被序列化为 JSON 字符串", () => {
            let captured = null;
            const fetch = createFetch(asyncAdapter((options, { onEnd }) => {
                captured = options.body;
                onEnd();
            }));

            return fetch({ url: "x://x", method: "POST", body: { a: 1 } })
                .then((res) => new Promise((resolve) => res.on("end", resolve)))
                .then(() => {
                    expect(typeof captured).toBe("string");
                    expect(captured).toBe(JSON.stringify({ a: 1 }));
                });
        });

        it("cancel() 会中断底层请求", () => {
            let signal = null;
            const fetch = createFetch(asyncAdapter((options) => { signal = options.signal; }));

            return fetch({ url: "x://x" }).then((res) => {
                return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
                    expect(signal).toBeDefined();
                    expect(signal.aborted).toBe(false);

                    res.cancel();
                    expect(signal.aborted).toBe(true);
                });
            });
        });
    });

    // 内部 alias（Emitter 无需重命名；保留兼容写法）
    function E() { return new Emitter(); }

};