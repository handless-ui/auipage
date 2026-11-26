import { AuiPage, generator } from "@auipage/core";

// 超时护栏：让「本该 resolve 却没 resolve」的用例直接失败，而不是静默挂住
export function withTimeout(promise, ms = 2000, label = "用例") {
    return Promise.race([
        promise,
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(label + " 超时（" + ms + "ms）")), ms);
            if (timer.unref) timer.unref();
        })
    ]);
}

// 让出一拍，等待内部 Promise 链推进
export function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// 起一个本地 HTTP 服务，跑完自动关闭；run(port) 的返回值原样透出
export function withServer(handler, run) {
    return import("http").then(({ default: http }) => new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            Promise.resolve(run(port)).then(
                (value) => server.close(() => resolve(value)),
                (err) => server.close(() => reject(err))
            );
        });
    }));
}

/**
 * 构造一个可控的 AuiPage：适配器与运行时都是普通对象（无 name 字段），
 * 同时顺带验证 mount 的名称兜底逻辑。
 *
 * config.parts         ChatTransport.run 默认产出的分片数组
 * config.run           自定义 run({messages, context})
 * config.onAppend      ChatContent.append 的返回值钩子（默认返回 undefined）
 * config.list/load/newThread/deleteThread/archiveThread/unarchiveThread  ThreadList / MessageHistory 行为
 * config.append        MessageHistory.append 行为
 */
export function createPage(config = {}) {

    const log = {
        chat: [],        // ChatContent.append 收到的 [role, part]
        chatInit: [],    // ChatContent.init 收到的消息数组
        threads: [],     // ThreadList.* 调用轨迹
        responses: [],   // ChatTransport.response 调用轨迹
        appends: []      // MessageHistory.append 调用轨迹
    };

    const runtime = {
        ThreadList: {
            init: (threads) => log.threads.push(["init", threads]),
            active: (id) => log.threads.push(["active", id]),
            append: (thread) => log.threads.push(["append", thread]),
            delete: (id) => log.threads.push(["delete", id]),
            archive: (id) => log.threads.push(["archive", id]),
            unarchive: (id) => log.threads.push(["unarchive", id])
        },
        ChatContent: {
            init: (messages) => log.chatInit.push(messages),
            append: (role, part) => {
                log.chat.push([role, part]);
                return config.onAppend ? config.onAppend(role, part) : undefined;
            }
        }
    };

    const adapter = {
        ChatTransport: {
            run: config.run || function () {
                const parts = config.parts || [];
                return generator((next, done) => {
                    for (const part of parts) next(part);
                    done();
                });
            },
            response: (name, data) => log.responses.push([name, data])
        },
        MessageHistory: {
            load: config.load || (() => undefined),
            append: config.append || ((threadId, messages) => {
                log.appends.push([threadId, messages]);
            })
        },
        ThreadList: {
            list: config.list || (() => undefined),
            new: config.newThread || (() => ({ threadId: "thread-1" })),
            delete: config.deleteThread,
            archive: config.archiveThread,
            unarchive: config.unarchiveThread
        }
    };

    const page = new AuiPage({
        adapter,
        runtime,
        tools: config.tools || [],
        stopTimeout: config.stopTimeout
    });

    return { page, log, adapter, runtime };
}
