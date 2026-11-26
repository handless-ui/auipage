/* 由 apis/agent/build.mjs 生成，勿手改 */
// #doc:merge
function toHistoryMessages (value) {

    let messages = [], index = -1;
    for (let message of value.messages || []) {

        if (index != -1 && messages[index].role === message.role) {
            // 复制内容数组，避免改写入参消息对象
            messages[index].content.push(...message.content);
        } else {
            messages.push(Object.assign({}, message, { content: (message.content || []).slice() }));
            index = messages.length - 1;
        }
    }

    value.messages = messages;
    return value;
}
// #end

// 挂载适配器/运行时：name 缺失时回退到配置对象的 key，避免直接崩
// #doc:mount
function mount(aui, list, suffix) {
    const result = {};
    for (const [key, instance] of Object.entries(list || {})) {
        if (!instance) continue;
        instance.aui = aui;
        const name = typeof instance.name === "string" ? instance.name : "";
        result[name.replace(suffix, "") || key.replace(suffix, "")] = instance;
    }
    return result;
}
// #end

// 适配器调用：Promise 就等完成，同步值直接处理，同步返回 undefined 视为未实现
// #doc:invoke
function invoke(target, method, apply, args) {
    if (!target || typeof target[method] !== "function") return;
    let ret;
    try {
        ret = target[method].apply(target, args || []);
    } catch (e) {
        return;
    }
    if (ret === void 0 || ret === null) return;
    if (typeof ret.then === "function") {
        ret.then(apply, function () { });
        return;
    }
    if (typeof apply === "function") apply(ret);
}
// #end

// 安全调用：返回值可能为 void / Promise，异常与拒绝都不外泄
// #doc:safe
function callSafely(fn, arg) {
    if (typeof fn !== "function") return;
    try {
        const ret = fn(arg);
        if (ret && typeof ret.then === "function") ret.then(null, function () { });
    } catch (e) { /* 忽略视图与上报通道异常 */ }
}

// 视图更新函数：runtime 的 append 允许返回 void（类型契约如此），这里统一兜底
function asUpdater(ret) {
    return typeof ret === "function" ? ret : null;
}
// #end

// content 规范化为片段数组：字符串按整段处理，避免逐字符渲染
// #doc:content
function normalizeContent(content) {
    if (Array.isArray(content)) return content;
    if (content === void 0 || content === null) return [];
    if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
    return [content];
}
// #end

// 取消时等待 next() 落定的兜底上限（毫秒），防止适配器忽略 signal 时页面停在执行中
// #doc:cancelchk
const DEFAULT_STOP_TIMEOUT = 5000;

// 被取消的任务：后续分片与工具结果一律丢弃；被 stop 则继续把结果落地
function isCancelled(task) {
    return !!(task.endRequest && task.endRequest.status === "cancelled");
// #end
}

// #doc:ctor
function AuiPage(options) {
    options = options || {};

    // 连接适配器和运行时视图
    this.adapter = mount(this, options.adapter, "Adapter");
    this.runtime = mount(this, options.runtime, "Runtime");

    // 工具注册
    this.tools_execute = {};
    this.tools_render = {};
    this.tools_description = [];
    for (let tool of options.tools || []) {
        this.tools_execute[tool.description.function.name] = tool.execute;
        this.tools_render[tool.description.function.name] = tool.render;
        this.tools_description.push({ description: tool.description });
    }

    // 当前是否在执行中
    this.isExecuting = false;

    // 当前激活的会话ID
    this.currentThreadId = void 0;

    // 当前会话内容
    this.currentMessages = [];

    // 任务生命周期事件：task:start / task:end
    this._events = { "task:start": [], "task:end": [] };

    // 任务自增序号，用于生成 taskId
    this._taskSeq = 0;

    // 当前正在执行的任务句柄（sendMessage 进入执行期时写入）
    this._currentTask = null;

    // 取消时等待 next 落定的兜底时长
    this._stopTimeout = options.stopTimeout > 0 ? options.stopTimeout : DEFAULT_STOP_TIMEOUT;

    // 请求对话列表
    invoke(this.adapter.ThreadList, "list", (threads) => {
        this.runtime.ThreadList?.init(threads);
    });
}
// #end

// 触发生命周期事件；handler 抛错被吞掉，避免影响 sendMessage 主流程
// #doc:events
AuiPage.prototype._emit = function (event, payload) {
    let handlers = this._events[event];
    if (!handlers) return;
    // 复制一份，防止 off() 在回调中修改原数组
    handlers.slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { /* 吞掉 handler 异常 */ }
    });
};

// 订阅生命周期事件
AuiPage.prototype.on = function (event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return this;
};

// 取消订阅
AuiPage.prototype.off = function (event, handler) {
    let list = this._events[event];
    if (!list) return this;
    let idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
    return this;
};
// #end

// 交给界面渲染，同时登记显示条目：取消时据此告诉界面涉及哪几条
// #doc:render
AuiPage.prototype._render = function (task, role, part) {
    const content = this.runtime.ChatContent;
    if (!content || typeof content.append !== "function") return;

    task.displayed.push({ index: task.displayed.length, role: role, part: part });
    return content.append(role, part);
};
// #end

// #doc:send
AuiPage.prototype.sendMessage = function (message) {
    let _this = this;

    return new Promise((resolve, reject) => {

        if (this.isExecuting) return reject("当前正在执行中");

        if (!message || typeof message !== "object") return reject("消息格式不正确");

        // content 规范化：字符串包成单个 text 片段，避免逐字符渲染
        const content = normalizeContent(message.content);
        const input = Array.isArray(message.content) ? message : Object.assign({}, message, { content });

        this.isExecuting = true;

        // 取消通道：signal 交给适配器，由它透传到底层 HTTP / 模型请求
        const controller = typeof AbortController === "function" ? new AbortController() : null;

        let generator;
        try {
            generator = this.adapter.ChatTransport.run({
                messages: [input],
                context: {
                    history: this.currentMessages,
                    tools: this.tools_description,
                    signal: controller ? controller.signal : void 0
                }
            });
        } catch (error) {
            // run() 同步抛错：复位状态，否则页面永久卡在“执行中”
            this.isExecuting = false;
            reject(error);
            return;
        }

        if (!generator || typeof generator.next !== "function") {
            this.isExecuting = false;
            reject("ChatTransport.run() 返回空值");
            return;
        }

        // 结束信号：工具或界面里发起 stop / cancel 时唤醒等待中的流程
        let signalEnd;
        const endSignal = new Promise(function (resolve) { signalEnd = resolve; });

        // 写入任务上下文，供后续协同使用
        let taskId = String(++this._taskSeq);
        const task = this._currentTask = {
            taskId,
            message: input,
            generator,
            controller,
            cacheMessages: [input],
            displayed: [],
            preType: "",
            preText: "",
            textTypes: ["loading", "thinking", "text"],
            streamFun: void 0,
            tool_calls: {},
            resolve,
            reject,
            ended: false,
            endRequest: null,
            endSignal: { promise: endSignal, resolve: signalEnd },
            busy: false,
            nextPending: false
        };

        // 任务开始生命周期
        this._emit("task:start", {
            taskId,
            threadId: this.currentThreadId,
            message: input
        });

        // 回显用户消息
        for (let i = 0; i < content.length; i++) {
            this._render(task, input.role, content[i]);
        }
// #end

        // #doc:pump
        const finishEnd = () => {
            const request = task.endRequest;
            if (task.ended || !request) return;
            this._finalize(request.status, true, null, request.by, task);
        };

        const pump = () => {
            if (task.ended) return;
            if (task.endRequest) return finishEnd();

            let step;
            try {
                step = generator.next();
            } catch (error) {
                this._finalize("error", false, error);
                return;
            }

            task.nextPending = true;

            Promise.resolve(step).then(function (res) {
                task.nextPending = false;

                // next 未决期间发起过结束请求：此刻已落定，可以安全收尾
                if (task.endRequest) return finishEnd();
                if (task.ended) return;

                if (res && res.done) {
                    _this._finalize("complete", true);
                    return;
                }

                task.busy = true;
                _this._handleChunk(task, res).then(function () {
                    task.busy = false;

                    if (task.endRequest) return finishEnd();
                    if (task.ended) return;
                    pump();
        // #end
                }, function (error) {
                    task.busy = false;

                    if (task.endRequest) return finishEnd();
                    _this._finalize("error", false, error);
                });
            }, function (error) {
                task.nextPending = false;

                if (task.endRequest) return finishEnd();
                _this._finalize("error", false, error);
            });
        };

        pump();

    });
};

/**
 * 统一结束请求：stopped 当成功收尾，cancelled 当取消。
 * 有分片或工具正在处理时不立即收尾，等它把手上的结果落完再结束，
 * 否则这次工具调用会从消息里丢掉。
 *
 * @param {"stopped"|"cancelled"} status 结束状态
 * @param {"user"|"tool"} by 发起方
 * @param {object} [task] 指定任务；工具侧传入自己所属的任务，避免打到下一轮
 * @returns {boolean} 当时是否有可结束的任务
 */
// #doc:end
AuiPage.prototype._requestEnd = function (status, by, task) {
    task = task || this._currentTask;
    if (!task || task.ended) return false;
    if (task.endRequest) return true;

    task.endRequest = { status: status, by: by };

    // 中断底层请求；适配器把 context.signal 透传下去即可立即停止
    callSafely(function () {
        if (task.controller) task.controller.abort();
    });

    // 唤醒可能卡在界面交互里的流程
    callSafely(task.endSignal.resolve);

    if (task.busy || task.nextPending) {
        // 等着当前分片落定；兜底超时防止适配器忽略 signal 时页面停在执行中
        const _this = this;
        task.stopTimer = setTimeout(function () {
            _this._finalize(status, true, null, by, task);
        }, this._stopTimeout);
        if (task.stopTimer && typeof task.stopTimer.unref === "function") task.stopTimer.unref();

        return true;
    }

    this._finalize(status, true, null, by, task);
    return true;
};
// #end

/**
 * 主动结束当前任务：当作成功收尾——内容保留、入库标记 stopped、sendMessage 正常 resolve。
 * 与 cancel 的区别只在这份“怎么收下这一轮”的口径，不在谁点的。
 *
 * @returns {boolean} 当时是否有正在执行的任务
 */
// #doc:stopcancel
AuiPage.prototype.stop = function () {
    return this._requestEnd("stopped", "user");
};

/**
 * 取消当前任务：中断底层请求，已产出的部分照常入库并标记 cancelled，
 * task:end 附带 displayed，界面可自行撤销。
 *
 * @returns {boolean} 当时是否有正在执行的任务
 */
AuiPage.prototype.cancel = function () {
    return this._requestEnd("cancelled", "user");
};

/**
 * 交给工具的任务控制句柄：execute / render 里直接调用 stop() 或 cancel()。
 *
 * @param {object} task 任务句柄
 * @param {object} call 工具调用分片
 */
AuiPage.prototype._toolControl = function (task, call) {
    const _this = this;
    return {
        taskId: task.taskId,
        toolCallId: call.id,
        stop: function () { return _this._requestEnd("stopped", "tool", task); },
        cancel: function () { return _this._requestEnd("cancelled", "tool", task); }
    };
};
// #end

/**
 * 处理单个生成器分片。文本类分片按类型累积并通过 streamFun 流式追加，
 * 工具调用分片交给 _handleToolCall。
 *
 * @param {object} task 当前任务句柄
 * @param {{value: object, done: boolean}} chunk 生成器返回项
 */
// #doc:chunk
AuiPage.prototype._handleChunk = async function (task, chunk) {
    if (!task || task.ended || task.endRequest) return;

    const value = (chunk && chunk.value) || {};
    const text = typeof value.text === "string" ? value.text : "";

    // 类型变了，或者是一种特殊类型
    if (value.type != task.preType || !task.textTypes.includes(value.type)) {
        task.streamFun = void 0;

        if (task.preText) {
            task.cacheMessages.push({
                role: "assistant",
                content: [{ type: task.preType, text: task.preText }]
            });
            task.preText = "";
            task.preType = "";
        }

        if (!task.textTypes.includes(value.type)) {
            if (value.type === "tool-call") await this._handleToolCall(task, value);
        } else {
            task.preText = text;
            task.preType = value.type;
            task.streamFun = this._render(task, "assistant", value);
        }

    } else {
        task.preText += text;
        if (task.streamFun) callSafely(task.streamFun, value.text);
    }
};
// #end

/**
 * 工具调用分片：pending 时挂上视图并执行前端工具，success/error 时回填后端工具结果。
 *
 * @param {object} task 当前任务句柄
 * @param {object} call 工具调用分片
 */
// #doc:toolpending
AuiPage.prototype._handleToolCall = async function (task, call) {

    // 工具开始调用（前端工具 + 后端工具）
    if (call.status === "pending") {
        const updater = asUpdater(this._render(task, "assistant", call));
        if (updater) task.tool_calls[call.id] = updater;

        // 后端工具由 ChatTransport 自己执行，这里只挂视图
        if (call.caller !== "frontend") return;

        // 前端工具需要自己执行；第二个参数是任务控制句柄，工具里可直接 stop / cancel
        const execute = this.tools_execute[call.name];
        const control = this._toolControl(task, call);
        let result, status;

        if (typeof execute === "function") {
            try {
                result = await execute(call.args, control);
                status = "success";
            } catch (error) {
                result = error;
                status = "error";
            }
        } else {
            result = new Error("未注册的工具：" + call.name);
            status = "error";
        }

        // 工具执行期间被取消：结果丢弃；被 stop 则继续把这次调用的结果落地
        if (task.ended || isCancelled(task)) return;

        const render = this.tools_render[call.name];
// #end

        // 需要视图交互获取结果
        // #doc:toolrender
        if (typeof render === "function" && updater) {
            const pending = Promise.resolve(updater(Object.assign({}, call, {
                result: result,
                status: status,
                render: render,
                taskId: control.taskId,
                stop: control.stop,
                cancel: control.cancel
            })));

            // 界面还挂着等交互时被结束：放弃等待，按 execute 的结果收尾
            const outcome = await Promise.race([
                pending.then(function (value) {
                    return { value: value };
                }, function (error) {
                    return { error: error };
                }),
                task.endRequest
                    ? Promise.resolve({ ended: true })
                    : task.endSignal.promise.then(function () { return { ended: true }; })
            ]);

            if (task.ended || isCancelled(task)) return;

            if (outcome.ended) {
                callSafely(updater, Object.assign({}, call, { result: result, status: status }));
                delete task.tool_calls[call.id];

                task.cacheMessages.push({
                    role: "assistant",
                    content: [{
                        type: "tool-call",
                        name: call.name,
                        args: call.args,
                        result,
                        status
                    }]
                });

                return;
            }

            let result_ui = outcome.error !== void 0 ? outcome.error : outcome.value;
            let status_ui = outcome.error !== void 0 ? "error" : "success";

            callSafely(updater, Object.assign({}, call, { result: result_ui, status: status_ui }));
            delete task.tool_calls[call.id];

            task.cacheMessages.push({
                role: "assistant",
                content: [{
                    type: "tool-call",
                    name: call.name,
                    args: call.args,
                    result,
                    status,
                    ui: { status: status_ui, result: result_ui }
                }]
            });

            invoke(this.adapter.ChatTransport, "response", null, ["tool-result", {
                id: call.id,
                status: status_ui,
                result: result_ui
            }]);
        }

        // #end
        // #doc:toolplain
        // 没有可用的视图入口，就当作纯工具调用
        else {
            if (updater) {
                callSafely(updater, Object.assign({}, call, { result, status }));
                delete task.tool_calls[call.id];
            }

            task.cacheMessages.push({
                role: "assistant",
                content: [{
                    type: "tool-call",
                    name: call.name,
                    args: call.args,
                    result,
                    status
                }]
            });

            invoke(this.adapter.ChatTransport, "response", null, ["tool-result", {
                id: call.id,
                result,
                status
            }]);
        }

        return;
        // #end
    }

    // 工具调用结束（后端工具）
    // #doc:toolbackend
    if (call.status === "success" || call.status === "error") {
        if (task.tool_calls[call.id]) {
            callSafely(task.tool_calls[call.id], call);
            delete task.tool_calls[call.id];

            task.cacheMessages.push({
                role: "assistant",
                content: [{
                    type: "tool-call",
                    name: call.name,
                    args: call.args,
                    result: call.result,
                    status: call.status
                }]
            });
        }
    }
    // #end
};

/**
 * 收尾 sendMessage 任务。统一处理：残留文本归并、入库、isExecuting 复位、
 * 发出 task:end 事件、释放 Promise。
 *
 * @param {"complete"|"stopped"|"error"|"cancelled"} status 任务结束原因
 * @param {boolean} isHistory 是否走入库分支（complete / stopped / cancelled 为 true，error 为 false）
 * @param {Error|string} [err] status === "error" 时附带的错误对象
 * @param {"user"|"tool"} [by] stopped / cancelled 时的发起方
 * @param {object} [taskArg] 指定任务；兜底计时器传入，避免落到下一轮
 */
// #doc:finishA
AuiPage.prototype._finalize = async function (status, isHistory, err, by, taskArg) {
    let task = taskArg || this._currentTask;
    if (!task || task.ended) return;
    task.ended = true;

    // 清理兜底计时器，并释放还在等结束信号的流程
    if (task.stopTimer && typeof clearTimeout === "function") clearTimeout(task.stopTimer);
    task.stopTimer = null;
    callSafely(task.endSignal.resolve);

    // 1. 残留文本归并到 cacheMessages
    if (task.preText) {
        task.cacheMessages.push({
            role: "assistant",
            content: [{ type: task.preType, text: task.preText }]
        });
        task.preText = "";
        task.preType = "";
    }

    // 2. 让生成器停止继续产出（此时 next() 已 settle，可安全调用）
    if (typeof task.generator.return === "function") {
        callSafely(function () { return task.generator.return(); });
    }

// #end
    // #doc:finishB
    // 3. 入库；失败降级为 error，避免前端误以为消息已保存
    let failure = status === "error" ? err : null;

    if (isHistory && !failure) {
        try {
            let historyMessages = toHistoryMessages({ messages: task.cacheMessages });

            // 主动结束与取消也入库，只打标记；存或丢由 MessageHistory.append 自己决定
            if (status === "stopped" || status === "cancelled") historyMessages.status = status;

            if (this.currentThreadId === void 0) {
                let newThread = await this.adapter.ThreadList?.new?.(historyMessages);

                if (!newThread) throw new Error("新建会话失败");

                await Promise.resolve(this.runtime.ThreadList?.append(newThread));
                this.activeThread(newThread.threadId, true);
            }

            this.currentMessages.push(historyMessages);
            await this.adapter.MessageHistory?.append?.(this.currentThreadId, historyMessages);
        } catch (e) {
            failure = e;
        }
    }

    // 4. 复位、emit task:end、释放 Promise
    if (this._currentTask === task) {
        this.isExecuting = false;
        this._currentTask = null;
    }

    const finalStatus = failure ? "error" : status;

    const payload = {
        taskId: task.taskId,
        threadId: this.currentThreadId,
        message: task.message,
        status: finalStatus
    };

    // 主动结束 / 取消时说明是谁发起的；取消另附已显示条目，界面据此决定是否撤销
    if (finalStatus === "stopped" || finalStatus === "cancelled") payload.by = by || "user";
    if (finalStatus === "cancelled") payload.displayed = task.displayed;

    this._emit("task:end", payload);

    if (finalStatus === "error") task.reject(failure || new Error("任务执行失败"));
    else if (finalStatus === "cancelled") task.reject("已取消");
    else task.resolve();
};
    // #end

// #doc:active
AuiPage.prototype.activeThread = function (threadId, __noLoad__) {
    if (this.currentThreadId === threadId) return;

    // 已经有执行的，不允许切换
    if (this.isExecuting && !__noLoad__) return;

    this.currentThreadId = threadId;
    this.runtime.ThreadList?.active(threadId);

    if (threadId === void 0) {
        this.currentMessages = [];
        this.runtime.ChatContent?.init([]);
        return;
    }

    if (__noLoad__) return;

    // 加载历史消息
    invoke(this.adapter.MessageHistory, "load", (messages) => {
        this.currentMessages = messages;

        let plainMessages = [];
        messages.forEach(item => {
            plainMessages.push(...item.messages);
        });
        this.runtime.ChatContent?.init(plainMessages);
    }, [threadId]);
};
// #end

// #doc:threads
AuiPage.prototype.deleteThread = function (threadId) {
    invoke(this.adapter.ThreadList, "delete", () => {
        this.runtime.ThreadList?.delete(threadId);

        if (threadId === this.currentThreadId) this.newThread();
    }, [threadId]);
};

AuiPage.prototype.archiveThread = function (threadId) {
    invoke(this.adapter.ThreadList, "archive", () => {
        this.runtime.ThreadList?.archive(threadId);

        if (threadId === this.currentThreadId) this.newThread();
    }, [threadId]);
};

AuiPage.prototype.unarchiveThread = function (threadId) {
    invoke(this.adapter.ThreadList, "unarchive", () => {
        this.runtime.ThreadList?.unarchive(threadId);
    }, [threadId]);
};

// #end
// #doc:newthread
AuiPage.prototype.newThread = function () {
    this.activeThread(void 0);
};

function initOption(setOption, defaultOption) {
    for (const key in setOption) {
        defaultOption[key] = setOption[key];
    }

    return defaultOption;
}

let EmptyFunction = () => void 0;

// #doc:ctor
const DEFAUTL_OPTIONS$4 = {
    run: EmptyFunction,
    response: EmptyFunction,
};

// #end

function ChatTransportAdapter(options) {
    this.name="ChatTransportAdapter";

    // #doc:merge
    let value = initOption(options, { ...DEFAUTL_OPTIONS$4 });
    for (let key in DEFAUTL_OPTIONS$4) {
        this[key] = value[key];
    }
    // #end
}

const DEFAUTL_OPTIONS$3 = {
    load: EmptyFunction,
    append: EmptyFunction
};

function MessageHistoryAdapter(options) {
    this.name="MessageHistoryAdapter";

    let value = initOption(options, { ...DEFAUTL_OPTIONS$3 });
    for (let key in DEFAUTL_OPTIONS$3) {
        this[key] = value[key];
    }
}

// #doc:methods
const DEFAUTL_OPTIONS$2 = {
    list: EmptyFunction,
    new: EmptyFunction,
    archive: EmptyFunction,
    unarchive: EmptyFunction,
    delete: EmptyFunction
};
// #end

function ThreadListAdapter(options) {
    this.name="ThreadListAdapter";

    let value = initOption(options, { ...DEFAUTL_OPTIONS$2 });
    for (let key in DEFAUTL_OPTIONS$2) {
        this[key] = value[key];
    }
}

const DEFAUTL_OPTIONS$1 = {
    init: EmptyFunction,
    active: EmptyFunction,
    delete: EmptyFunction,
    archive: EmptyFunction,
    unarchive: EmptyFunction,
    append: EmptyFunction,
};

function ThreadListRuntime(options) {
    this.name="ThreadListRuntime";
    
    let value = initOption(options, { ...DEFAUTL_OPTIONS$1 });
    for (let key in DEFAUTL_OPTIONS$1) {
        this[key] = value[key];
    }
}

// #doc:ctor
const DEFAUTL_OPTIONS = {
    init: EmptyFunction,
    append: EmptyFunction,
};

// #end

function ChatContentRuntime(options) {
    this.name="ChatContentRuntime";

    let value = initOption(options, { ...DEFAUTL_OPTIONS });
    for (let key in DEFAUTL_OPTIONS) {
        this[key] = value[key];
    }
}

// #doc:shape
function defineTool (options) {
    return {
        description: {
            type: "function",
            function: {
                name: options.name,
                description: options.description,
                parameters: options.parameters
            }
        },
        execute: options.execute,
        render: options.render
    };
// #end
}

// #doc:ctor
function MessageStream(send, end) {
    this.send = send || EmptyFunction;
    this.end = end || EmptyFunction;
}

// 页面消息（富片段）→ 模型线上消息（纯文本 + tool_calls / tool 结果）

// 入参既可以是历史消息组数组，也可以是纯消息数组
// #doc:flat
function flatten(input) {
    const list = [];
    for (const item of input || []) {
        if (!item) continue;
        if (Array.isArray(item.messages)) list.push(...item.messages);
        else list.push(item);
    }
    return list;
}
// #end

// 只拼接 text 片段；thinking / loading 与自定义片段不进模型上下文
function textOf(parts) {
    let text = "";
    for (const part of parts) {
        if (!part || part.type !== "text" || typeof part.text !== "string") continue;
        text += part.text;
    }
    return text;
}

function contentOf(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return String(value);
    try {
        const text = JSON.stringify(value);
        return typeof text === "string" ? text : "";
    } catch (e) {
        return String(value);
    }
}

/**
 * 把页面侧的历史消息转换为模型可用的 ChatMessage 数组。
 *
 * @param {Array} input 历史消息组数组（HistoryMessageGroup[]）或消息数组（ChatContentMessage[]）
 * @returns {Array} 可直接作为 completions.messages 的数组
 */
function toModelMessages(input) {
    const messages = flatten(input);
    const result = [];
    let seq = 0;

    for (const message of messages) {
        const parts = Array.isArray(message.content) ? message.content : [];
        const text = typeof message.content === "string" ? message.content : textOf(parts);

        // #doc:calls
        // 只保留已结束的工具调用，避免模型收到没有结果的 tool_call
        const calls = parts.filter(part => part
            && part.type === "tool-call"
            && typeof part.name === "string"
            && (part.status === "success" || part.status === "error"));

        if (calls.length === 0) {
            if (text) result.push({ role: message.role, content: text });
            continue;
        }

        // 历史片段可能没有 id，这里补一个稳定 id，让 tool 消息能对应上
        const tool_calls = calls.map(call => ({
            id: call.id || ("call_" + (++seq)),
            type: "function",
            function: {
                name: call.name,
                arguments: JSON.stringify(call.args || {})
            }
        }));

        result.push({ role: "assistant", content: text || void 0, tool_calls });

        calls.forEach((call, i) => {
            const payload = call.ui && call.ui.status ? call.ui.result : call.result;
            result.push({
                role: "tool",
                tool_call_id: tool_calls[i].id,
                tool_name: call.name,
                content: contentOf(payload)
            });
        });
        // #end
    }

    return result;
}

// 工具注册表：全部是「前端工具」——定义在 Agent 侧（只有 description），
// 真正执行发生在页面（AuiPage.tools_execute），结果再经 ChatTransport.response 回传。

const pageInfo = defineTool({
    name: "page_info",
    description: "读取用户当前正在阅读的文档页：标题、分组、地址。用户问『我在看哪一篇』时调用。",
    parameters: {
        type: "object",
        properties: {},
        required: []
    },
    execute: function () {
        const heading = document.querySelector(".pagehead h1");
        const crumbs = document.querySelector(".pagehead .crumbs");
        return {
            title: (heading && heading.textContent || document.title || "").trim(),
            section: (crumbs && crumbs.textContent || "").replace(/\s+/g, " ").trim(),
            url: location.pathname.split("/").slice(-3).join("/")
        };
    }
});

const listPages = defineTool({
    name: "list_pages",
    description: "列出文档站当前已有的分组与页数，用于回答『文档里都有什么』。",
    parameters: {
        type: "object",
        properties: {},
        required: []
    },
    execute: function () {
        const links = Array.from(document.querySelectorAll(".tree a"));
        const groups = Array.from(document.querySelectorAll(".tree .group")).map((el) => el.textContent.trim());
        return {
            count: links.length,
            groups: groups,
            first: links.slice(0, 3).map((a) => a.textContent.trim())
        };
    }
});

const TOOLS = [pageInfo, listPages];

// 极简 markdown 渲染：只支持这套文档/对话实际用到的语法，输出前统一转义
function escapeHtml(text) {
    return String(text == null ? "" : text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return out;
}

function renderMarkdown(source) {
    const lines = String(source == null ? "" : source).split("\n");
    const html = [];
    let inCode = false;
    let codeLines = [];
    let listTag = "";
    let para = [];

    const flushPara = function () {
        if (!para.length) return;
        html.push("<p>" + inline(para.join(" ")) + "</p>");
        para = [];
    };
    const closeList = function () {
        if (listTag) {
            html.push("</" + listTag + ">");
            listTag = "";
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^```/.test(line)) {
            if (inCode) {
                html.push('<pre><code>' + escapeHtml(codeLines.join("\n")) + "</code></pre>");
                inCode = false;
                codeLines = [];
            } else {
                flushPara();
                closeList();
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            continue;
        }
        if (!line.trim()) {
            flushPara();
            closeList();
            continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            flushPara();
            closeList();
            const level = Math.min(4, heading[1].length + 2);
            html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
            continue;
        }
        const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
        const bullet = line.match(/^\s*[-*]\s+(.+)$/);
        if (ordered || bullet) {
            flushPara();
            const want = ordered ? "ol" : "ul";
            if (listTag !== want) {
                closeList();
                html.push("<" + want + ">");
                listTag = want;
            }
            html.push("<li>" + inline((ordered || bullet)[1]) + "</li>");
            continue;
        }
        closeList();
        para.push(line);
    }

    if (inCode && codeLines.length) html.push('<pre><code>' + escapeHtml(codeLines.join("\n")) + "</code></pre>");
    flushPara();
    closeList();
    return html.join("");
}

// ChatContentRuntime 的真实实现：把 AuiPage 推来的片段落成 DOM，并返回更新函数做流式增量

function el$1(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function prettyArgs(args) {
    try {
        const text = JSON.stringify(args || {}, null, 2);
        return text === "{}" ? "（无参数）" : text;
    } catch (e) {
        return String(args);
    }
}

function prettyResult(result) {
    if (result instanceof Error) return result.message;
    if (typeof result === "string") return result.slice(0, 600);
    try {
        return JSON.stringify(result, null, 2).slice(0, 600);
    } catch (e) {
        return String(result);
    }
}

const SUGGESTIONS = [
    "auipage 是什么",
    "我现在在看哪一篇",
    "工具是怎么被调用的",
    "模型地址连不上怎么办"
];

function createChatView(container, scope) {
    let assistantTurn = null;
    let loadingEl = null;
    let emptyEl = null;

    function scrollToEnd() {
        // 同步贴一次，再在定时器里补一次：流式内容会在这一轮之后继续长高
        container.scrollTop = container.scrollHeight;
        setTimeout(function () {
            container.scrollTop = container.scrollHeight;
        }, 0);
    }

    function hideEmpty() {
        if (emptyEl) {
            emptyEl.remove();
            emptyEl = null;
        }
    }

    function showEmpty() {
        hideEmpty();
        emptyEl = el$1("div", "agt-empty");
        emptyEl.appendChild(el$1("h2", "", "你好，我是 auipage 助手"));
        emptyEl.appendChild(el$1("p", "", "可以问我这套文档里的任意一篇，也可以让我解释某个包的实现。回答会实时流式输出，工具调用也看得见。"));
        const box = el$1("div", "agt-chips");
        SUGGESTIONS.forEach(function (text) {
            const chip = el$1("button", "agt-chip", text);
            chip.type = "button";
            chip.addEventListener("click", function () {
                if (scope.onAsk) scope.onAsk(text);
            });
            box.appendChild(chip);
        });
        emptyEl.appendChild(box);
        container.appendChild(emptyEl);
    }

    function newTurn(role) {
        hideEmpty();
        const turn = el$1("div", "agt-turn agt-" + role);
        if (role === "assistant") {
            const avatar = el$1("div", "agt-ava");
            const logoUrl = window.__AGH_LOGO__ || "";
            if (logoUrl) {
                const mark = document.createElement("img");
                mark.src = logoUrl;
                mark.alt = "";
                mark.onerror = function () { mark.remove(); avatar.textContent = "AI"; };
                avatar.appendChild(mark);
            } else {
                avatar.textContent = "AI";
            }
            turn.appendChild(avatar);
        }
        const body = el$1("div", "agt-body");
        turn.appendChild(body);
        container.appendChild(turn);
        scrollToEnd();
        return { turn: turn, body: body };
    }

    function renderUser(part) {
        const spot = newTurn("user");
        const text = el$1("div", "agt-text");
        text.innerHTML = renderMarkdown(part.text || "");
        spot.body.appendChild(text);
        scrollToEnd();
    }

    function renderThinking(part) {
        const spot = assistantTurn || newTurn("assistant");
        if (loadingEl) {
            loadingEl.remove();
            loadingEl = null;
        }
        assistantTurn = spot;
        const box = el$1("details", "agt-think");
        const summary = el$1("summary", "");
        summary.textContent = "思考过程";
        box.appendChild(summary);
        const pre = el$1("div", "agt-think-body");
        box.appendChild(pre);
        pre.textContent = part.text || "";
        spot.body.appendChild(box);
        scrollToEnd();
        return function (delta) {
            pre.textContent += delta || "";
            scrollToEnd();
        };
    }

    function renderText(part) {
        const spot = assistantTurn || newTurn("assistant");
        assistantTurn = spot;
        if (loadingEl) {
            loadingEl.remove();
            loadingEl = null;
        }
        const block = el$1("div", "agt-text");
        spot.body.appendChild(block);

        let raw = part.text || "";
        let frame = null;
        block.innerHTML = renderMarkdown(raw);
        scrollToEnd();

        return function (delta) {
            raw += delta || "";
            if (frame) return;
            frame = setTimeout(function () {
                frame = null;
                block.innerHTML = renderMarkdown(raw);
                scrollToEnd();
            }, 16);
        };
    }

    function renderLoading() {
        const spot = assistantTurn || newTurn("assistant");
        assistantTurn = spot;
        if (loadingEl) return null;
        loadingEl = el$1("div", "agt-dots");
        loadingEl.innerHTML = "<i></i><i></i><i></i>";
        spot.body.appendChild(loadingEl);
        scrollToEnd();
        return null;
    }

    function renderToolCall(part) {
        const spot = assistantTurn || newTurn("assistant");
        assistantTurn = spot;
        if (loadingEl) {
            loadingEl.remove();
            loadingEl = null;
        }

        const card = el$1("div", "agt-tool");
        const head = el$1("div", "agt-tool-head");
        const dot = el$1("span", "agt-tool-dot");
        const name = el$1("code", "agt-tool-name");
        const status = el$1("span", "agt-tool-status");
        head.appendChild(dot);
        head.appendChild(name);
        head.appendChild(status);
        const body = el$1("div", "agt-tool-body");
        const pre = el$1("pre", "");
        body.appendChild(pre);
        card.appendChild(head);
        card.appendChild(body);
        spot.body.appendChild(card);

        const paint = function (value) {
            const state = value.status || "pending";
            card.dataset.status = state;
            name.textContent = value.name || "tool";
            status.textContent = state === "pending" ? "调用中" : (state === "success" ? "已完成" : "失败");
            pre.textContent = prettyArgs(value.args);
            if (state !== "pending") {
                const out = el$1("pre", "agt-tool-result");
                out.textContent = prettyResult(value.result);
                body.innerHTML = "";
                body.appendChild(pre);
                body.appendChild(out);
            }
        };

        paint(part);
        scrollToEnd();

        return function (value) {
            paint(value || {});
            scrollToEnd();
        };
    }

    const runtime = new ChatContentRuntime({
        init: function (messages) {
            container.innerHTML = "";
            assistantTurn = null;
            loadingEl = null;
            if (!(messages || []).length) showEmpty();
            (messages || []).forEach(function (message) {
                const parts = Array.isArray(message.content) ? message.content : [];
                if (message.role === "user") {
                    parts.forEach(function (part) {
                        if (part && part.type === "text") renderUser(part);
                    });
                    return;
                }
                parts.forEach(function (part) {
                    if (!part) return;
                    if (part.type === "text") renderText(part);
                    else if (part.type === "thinking") renderThinking(part);
                    else if (part.type === "tool-call") renderToolCall(part);
                });
            });
            assistantTurn = null;
            scrollToEnd();
        },
        append: function (role, part) {
            if (!part) return;
            if (role === "user") {
                assistantTurn = null;
                if (loadingEl) {
                    loadingEl.remove();
                    loadingEl = null;
                }
                renderUser(part);
                return;
            }
            if (part.type === "loading") return renderLoading();
            if (part.type === "thinking") return renderThinking(part);
            if (part.type === "tool-call") return renderToolCall(part);
            return renderText(part);
        }
    });

    showEmpty();

    return {
        runtime: runtime,
        showEmpty: showEmpty,
        isDemo: scope.isDemo,
        pushUser: function (text) {
            assistantTurn = null;
            renderUser({ type: "text", text: text });
        },
        reset: function () {
            container.innerHTML = "";
            assistantTurn = null;
            loadingEl = null;
        }
    };
}

// 会话三件套：Adapter 与 Runtime 之外，多一层本机持久化（localStorage）。
// 会话列表、归档标记与消息历史都落盘，刷新后还能看到；写失败（隐私模式/配额）就退化成内存。

const THREAD_KEY = "auipage.docs.agent.v1.threads";
const HISTORY_KEY = "auipage.docs.agent.v1.history";
const MAX_THREADS = 30;
const MAX_GROUPS = 40;

function titleOf(group) {
    const messages = (group && group.messages) || [];
    for (const message of messages) {
        if (message.role !== "user") continue;
        const parts = Array.isArray(message.content) ? message.content : [];
        const text = parts.filter((p) => p && p.type === "text").map((p) => p.text).join("").trim();
        if (text) return text.length > 24 ? text.slice(0, 24) + "…" : text;
    }
    return "新对话";
}

function read(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        return false;
    }
}

function clock(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    const pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function createThreads(container, hooks) {
    const savedThreads = read(THREAD_KEY, []);
    const threads = Array.isArray(savedThreads) ? savedThreads.slice(0, MAX_THREADS) : [];
    const history = new Map();
    const savedHistory = read(HISTORY_KEY, {});
    Object.keys(savedHistory || {}).forEach(function (id) {
        if (Array.isArray(savedHistory[id])) history.set(id, savedHistory[id].slice(-MAX_GROUPS));
    });

    const items = new Map();
    let activeId = null;
    let archivedCount = 0;

    const archBox = document.createElement("div");
    archBox.className = "agt-arch";
    const archHead = document.createElement("button");
    archHead.type = "button";
    archHead.className = "agt-arch-head";
    const archList = document.createElement("div");
    archList.className = "agt-arch-list";
    archBox.appendChild(archHead);
    archBox.appendChild(archList);
    container.appendChild(archBox);

    function saveThreads() {
        write(THREAD_KEY, threads.slice(0, MAX_THREADS));
    }

    function saveHistory() {
        const plain = {};
        history.forEach(function (value, key) { plain[key] = value; });
        write(HISTORY_KEY, plain);
    }

    function paintArch() {
        archivedCount = threads.filter((t) => t.archived).length;
        archHead.textContent = "已归档 · " + archivedCount;
        archBox.classList.toggle("is-on", archivedCount > 0);
    }

    function makeRow(item) {
        const row = document.createElement("div");
        row.className = "agt-thread";
        row.dataset.id = item.threadId;

        const main = document.createElement("button");
        main.type = "button";
        main.className = "agt-thread-main";
        const label = document.createElement("span");
        label.className = "agt-thread-title";
        label.textContent = item.title || "新对话";
        const time = document.createElement("span");
        time.className = "agt-thread-time";
        time.textContent = clock(item.createdAt);
        main.appendChild(label);
        row.appendChild(main);
        row.appendChild(time);

        const acts = document.createElement("div");
        acts.className = "agt-thread-acts";

        if (!item.archived) {
            const archive = document.createElement("button");
            archive.type = "button";
            archive.className = "agt-thread-act";
            archive.title = "归档这条会话";
            archive.textContent = "归档";
            archive.addEventListener("click", function () {
                if (hooks && hooks.onArchive) hooks.onArchive(item.threadId);
            });
            acts.appendChild(archive);
        } else {
            const back = document.createElement("button");
            back.type = "button";
            back.className = "agt-thread-act";
            back.title = "恢复到会话列表";
            back.textContent = "恢复";
            back.addEventListener("click", function () {
                if (hooks && hooks.onUnarchive) hooks.onUnarchive(item.threadId);
            });
            acts.appendChild(back);
        }

        const del = document.createElement("button");
        del.type = "button";
        del.className = "agt-thread-act is-danger";
        del.title = "删除这条会话";
        del.textContent = "删除";
        del.addEventListener("click", function () {
            if (hooks && hooks.onDelete) hooks.onDelete(item.threadId);
        });
        acts.appendChild(del);
        row.appendChild(acts);

        main.addEventListener("click", function () {
            if (item.archived) return;
            if (hooks && hooks.onSelect) hooks.onSelect(item.threadId);
        });

        return row;
    }

    function paintActive() {
        items.forEach(function (node, id) {
            node.classList.toggle("is-active", id === activeId);
        });
        const current = threads.find((t) => t.threadId === activeId);
        if (hooks && hooks.onTitle) hooks.onTitle(current ? current.title : "新对话");
    }

    const runtime = new ThreadListRuntime({
        init: function (list) {
            container.querySelectorAll(".agt-thread").forEach(function (node) { node.remove(); });
            items.clear();
            const groups = threads.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
            groups.forEach(function (item) { runtime.append(item); });
            paintArch();
            paintActive();
        },
        append: function (item) {
            if (!item || items.has(item.threadId)) return;
            const row = makeRow(item);
            if (item.archived) archList.appendChild(row);
            else container.insertBefore(row, archBox);
            items.set(item.threadId, row);
            if (item.archived) row.classList.add("is-archived");
            paintArch();
            paintActive();
            archHead.classList.toggle("is-empty", !archivedCount);
        },
        active: function (threadId) {
            activeId = threadId;
            paintActive();
        },
        delete: function (threadId) {
            const row = items.get(threadId);
            if (row) {
                row.classList.add("is-leaving");
                setTimeout(function () { row.remove(); }, 160);
            }
            items.delete(threadId);
            history.delete(threadId);
            paintArch();
        },
        archive: function (threadId) {
            const row = items.get(threadId);
            if (!row) return;
            const item = threads.find((t) => t.threadId === threadId);
            row.classList.add("is-archived");
            row.querySelector(".agt-thread-acts").innerHTML = "";
            archList.appendChild(row);
            if (item) {
                const back = document.createElement("button");
                back.type = "button";
                back.className = "agt-thread-act";
                back.textContent = "恢复";
                back.addEventListener("click", function () {
                    if (hooks && hooks.onUnarchive) hooks.onUnarchive(threadId);
                });
                const del = document.createElement("button");
                del.type = "button";
                del.className = "agt-thread-act is-danger";
                del.textContent = "删除";
                del.addEventListener("click", function () {
                    if (hooks && hooks.onDelete) hooks.onDelete(threadId);
                });
                row.querySelector(".agt-thread-acts").appendChild(back);
                row.querySelector(".agt-thread-acts").appendChild(del);
            }
            paintArch();
        },
        unarchive: function (threadId) {
            const row = items.get(threadId);
            const item = threads.find((t) => t.threadId === threadId);
            if (!row || !item) return;
            row.classList.remove("is-archived");
            container.insertBefore(row, archBox);
            const acts = row.querySelector(".agt-thread-acts");
            acts.innerHTML = "";
            const archive = document.createElement("button");
            archive.type = "button";
            archive.className = "agt-thread-act";
            archive.textContent = "归档";
            archive.addEventListener("click", function () {
                if (hooks && hooks.onArchive) hooks.onArchive(threadId);
            });
            const del = document.createElement("button");
            del.type = "button";
            del.className = "agt-thread-act is-danger";
            del.textContent = "删除";
            del.addEventListener("click", function () {
                if (hooks && hooks.onDelete) hooks.onDelete(threadId);
            });
            acts.appendChild(archive);
            acts.appendChild(del);
            paintArch();
        }
    });

    archHead.addEventListener("click", function () {
        archBox.classList.toggle("is-open");
    });

    const adapter = new ThreadListAdapter({
        list: function () {
            return threads.slice();
        },
        new: function (group) {
            const item = {
                threadId: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                title: titleOf(group),
                createdAt: Date.now(),
                archived: false
            };
            threads.unshift(item);
            if (threads.length > MAX_THREADS) threads.length = MAX_THREADS;
            saveThreads();
            return item;
        },
        delete: function (threadId) {
            const at = threads.findIndex((t) => t.threadId === threadId);
            if (at >= 0) threads.splice(at, 1);
            saveThreads();
            return true;
        },
        archive: function (threadId) {
            const item = threads.find((t) => t.threadId === threadId);
            if (item) item.archived = true;
            saveThreads();
            return true;
        },
        unarchive: function (threadId) {
            const item = threads.find((t) => t.threadId === threadId);
            if (item) item.archived = false;
            saveThreads();
            return true;
        }
    });

    const messageHistory = new MessageHistoryAdapter({
        load: function (threadId) {
            return (history.get(threadId) || []).slice();
        },
        append: function (threadId, group) {
            if (!history.has(threadId)) history.set(threadId, []);
            history.get(threadId).push(group);
            if (history.get(threadId).length > MAX_GROUPS) history.set(threadId, history.get(threadId).slice(-MAX_GROUPS));
            saveHistory();
            return true;
        }
    });

    paintArch();

    return { adapter: adapter, runtime: runtime, messageHistory: messageHistory, threads: threads };
}

// 极简 EventEmitter：on / off / emit，供 Response 复用
class Emitter {
  constructor() {
    this._events = Object.create(null);
  }

  on(event, listener) {
    if (typeof listener !== 'function') return this;
    const list = this._events[event] || (this._events[event] = []);
    list.push(listener);
    return this;
  }

  off(event, listener) {
    const list = this._events[event];
    if (!list) return this;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) delete this._events[event];
    return this;
  }

  // #doc:emit
  emit(event, ...args) {
    const list = this._events[event];
    if (!list || list.length === 0) return false;
    // 复制一份再触发，避免 off 回调过程中影响本次派发
    for (const fn of list.slice()) {
      try {
        fn.apply(null, args);
      } catch (e) {
        // 单个监听器异常不影响其它监听器，也不再冒泡成进程级异常
        console.error(e);
      }
    }
    return true;
  // #end
  }
}

// Response：暴露 on/off 事件机制，承载 status / headers / 流式 data/end/error

class Response extends Emitter {
  constructor() {
    super();
    // #doc:state
    this.status = 0;
    this.headers = {};
    this.ok = false;
    this._done = false; // 标记是否已经 end/error，防止重复触发
    this._sseMode = false; // SSE 模式：按 \n\n 分割事件，提取 data: 字段原始字符串
    this._sseBuffer = ''; // SSE 缓冲区，处理 chunk 边界
    this._cancel = null; // 由 createFetch 注入，用于中断底层请求
    this._errorPending = null; // 消费者还没来得及注册时就发生的错误，注册后补发
    // #end
  }

  // 注册监听；error 是一次性终态，注册时若已发生则补发
  // #doc:replay
  on(event, listener) {
    super.on(event, listener);
    if (event === 'error' && this._errorPending) {
      const err = this._errorPending;
      this._errorPending = null;
      // 异步补发，避免在注册栈里同步回调
      queueMicrotask(() => this.emit('error', err));
    }
    return this;
  // #end
  }

  // 主动取消请求，失败统一从 error 事件返回
  cancel() {
    if (this._cancel) this._cancel();
    return this;
  }

  // 统一读取响应头：浏览器是 Headers 对象，Node 是普通对象
  header(name) {
    const headers = this.headers;
    if (!headers) return undefined;
    if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
    return headers[name];
  }

  // 提供一个统一入口让 adapter 推数据，屏蔽 Emitter 的细节
  _push(type, payload) {
    if (this._done && type !== 'error') return;

    // SSE 模式：缓冲 + 按 \n\n 分割，提取 data: 字段原始字符串
    // #doc:sse
    if (type === 'data' && this._sseMode) {
      this._sseBuffer += payload;

      // 按 \n\n 分割出完整事件，最后一段可能不完整
      const parts = this._sseBuffer.split(/\r{0,1}\n\r{0,1}\n/);
      this._sseBuffer = parts.pop();

      for (const part of parts) {
        const payload = this._extractSSEData(part);
        if (payload !== null) {
          this.emit('data', payload);
        }
      }
      return;
    // #end
    }

    if (type === 'end') {
      // SSE 模式下，flush 缓冲区残留
      if (this._sseMode && this._sseBuffer.trim()) {
        const payload = this._extractSSEData(this._sseBuffer);
        if (payload !== null) {
          this.emit('data', payload);
        }
        this._sseBuffer = '';
      }
      this._done = true;
    }
    if (type === 'error') {
      this._done = true;
      const listeners = this._events && this._events['error'];
      if (!listeners || listeners.length === 0) {
        // 消费者还没注册监听，先缓存，注册时补发
        this._errorPending = payload;
        return;
      }
    }

    this.emit(type, payload);
  }

  // 从一个 SSE 事件块中提取 data: 字段内容（去掉前缀，多行用 \n 拼接）
  // #doc:extract
  _extractSSEData(raw) {
    const dataLines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.replace(/^data:\s*/, '').replace(/\r$/, ''));
      }
    }
    if (dataLines.length === 0) return null;
    return dataLines.join('\n');
  // #end
  }
}

// fetch 工厂：注入 adapter，返回对外的 fetch 函数

// 只有普通对象才自动 JSON 序列化，ArrayBufferView / Blob / FormData 等保持原样
function isPlainBody(body) {
  return Object.prototype.toString.call(body) === '[object Object]';
}

function createFetch(adapter) {
  // #doc:factory
  return function fetch(options) {
    // 必须返回 Promise<response>，让调用方能 .then(res => res.on(...))
    return new Promise((resolve, reject) => {
      if (!options || !options.url) {
        reject(new Error('fetch: options.url is required'));
        return;
      }

      // 请求体是普通对象时自动序列化，避免 Node 端 req.write(object) 抛 TypeError
      if (isPlainBody(options.body)) {
        options = Object.assign({}, options, { body: JSON.stringify(options.body) });
      }

      const response = new Response();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer = null;
      let failed = false;

      response._cancel = () => { if (controller) controller.abort(); };

      // adapter 调用前先把 response 交出去，确保 .then(res => ...) 里能立刻 on(...) 注册监听
      // 用 queueMicrotask 推后一拍，避免同步 resolve 后用户立刻注册的监听错过首个 data
      queueMicrotask(() => resolve(response));
  // #end

      const clearTimer = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      // #doc:hooks
      const hooks = {
        onResponse(meta) {
          if (meta && typeof meta.status === 'number') {
            response.status = meta.status;
            response.ok = meta.status >= 200 && meta.status < 300;
          }
          if (meta && meta.headers) {
            response.headers = meta.headers;

            // 自动检测 SSE：浏览器 Headers 对象用 get()，Node 的 plain object 用 []
            const contentType =
              (typeof meta.headers.get === 'function' && meta.headers.get('content-type')) ||
              meta.headers['content-type'] ||
              '';
            if (contentType.includes('text/event-stream')) {
              response._sseMode = true;
            }
          }

          // 非 2xx 单独通知：不占用 error 事件、不锁 _done，错误体照常投递
          if (response.status >= 400) {
            response.emit('http-error', { status: response.status, headers: response.headers });
          }
        },
        onData(chunk) {
          response._push('data', chunk);
        },
        onEnd() {
          clearTimer();
          response._push('end');
        },
        onError(err) {
          if (failed) return;
          failed = true;
          clearTimer();
          // 错误同时通过 error 事件 和 catch 暴露，避免遗漏
          response._push('error', err);
          reject(err);
        }
      };
      // #end

      // #doc:abort
      const abortWith = (err) => {
        if (controller) controller.abort();
        hooks.onError(err);
      };

      // 超时：到点先中断底层请求，再走统一错误通道
      if (options.timeout > 0) {
        timer = setTimeout(() => {
          timer = null;
          abortWith(new Error('fetch: 请求超时（' + options.timeout + 'ms）'));
        }, options.timeout);
      }

      // 外部 signal
      if (options.signal) {
        if (options.signal.aborted) {
          abortWith(new Error('fetch: 请求已取消'));
          return;
        }
        options.signal.addEventListener('abort', () => {
          abortWith(new Error('fetch: 请求已取消'));
        });
      }

      // 把内部 controller 的 signal 交给 adapter，adapter 可据此中断底层请求
      const requestOptions = controller ? Object.assign({}, options, { signal: controller.signal }) : options;

      let ret;
      try {
        ret = adapter(requestOptions, hooks);
      } catch (err) {
        hooks.onError(err);
        return;
      }
      // adapter 允许返回 Promise，失败也要走同一条错误通道
      if (ret && typeof ret.then === 'function') ret.then(null, hooks.onError);
      // #end
    });
  };
}

// 浏览器环境适配器：基于原生 fetch + ReadableStream
// adapter 协议：(options, { onData, onEnd, onError, onResponse }) => void
function browserAdapter(options, { onData, onEnd, onError, onResponse }) {
  const { url, method = 'GET', headers = {}, body, signal } = options;

  if (typeof fetch !== 'function') {
    onError(new Error('Global fetch is not available in this environment'));
    return;
  }

  fetch(url, { method, headers, body, signal })
    .then(async (res) => {
      if (typeof onResponse === 'function') {
        onResponse({
          status: res.status || 0,
          headers: res.headers || {}
        });
      }

      // 没有 body（例如 204）直接结束
      if (!res.body) {
        onEnd();
        return;
      }

      // #doc:read
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');

      // 循环读取流直到 done
      // 用 async IIFE 形式启动，错误统一走 onError
      (async () => {
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              onEnd();
              return;
            }
            // value 是 Uint8Array，解码为字符串
            onData(decoder.decode(value, { stream: true }));
      // #end
          }
        } catch (err) {
          onError(err);
        }
      })();
    })
    .catch((err) => onError(err));
}

// Node 环境适配器：基于 http / https，天然流式输出
// adapter 协议：(options, { onData, onEnd, onError, onResponse }) => void
// 运行时不通过顶层 import 静态拉取 node 内置模块，而是 await import 按需加载，
// 避免在浏览器 / bundler 解析阶段触发对 'http' / 'https' / 'url' 的静态分析。
async function nodeAdapter(options, { onData, onEnd, onError, onResponse }) {
  // #doc:lazy
  const [{ default: http }, { default: https }, { URL }] = await Promise.all([
    import('http'),
    import('https'),
    import('url')
  ]);
  // #end

  const { url, method = 'GET', headers = {}, body, signal } = options;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    onError(e);
    return;
  }

  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  const reqOptions = {
    method,
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers
  };

  // #doc:req
  const req = lib.request(reqOptions, (res) => {
    // 把 status / headers 同步给 Response（若上游关心）
    if (typeof onResponse === 'function') {
      onResponse({
        status: res.statusCode || 0,
        headers: res.headers || {}
      });
    }

    res.setEncoding('utf8');
    res.on('data', (chunk) => onData(chunk));
    res.on('end', () => onEnd());
    res.on('error', (err) => onError(err));
  });

  req.on('error', (err) => onError(err));
  // #end

  // 取消 / 超时：直接中断底层请求，错误从 req 的 error 事件返回
  // #doc:abort
  if (signal) {
    if (signal.aborted) {
      onError(new Error('请求已取消'));
      return;
    }
    signal.addEventListener('abort', () => {
      req.destroy(new Error('请求已取消'));
  // #end
    });
  }

  if (body != null) {
    req.write(body);
  }
  req.end();
}

// 入口：环境判断 + 选择 adapter，构造并导出 fetch

// 浏览器存在 window / document；Node 不存在。SSR 环境需要 polyfill 时也能正确走 nodeAdapter
// #doc:pick
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

const adapter = isBrowser ? browserAdapter : nodeAdapter;

const fetch$1 = createFetch(adapter);

// 字符串转 JSON，适配 LLM 返回的各种流式格式：
// 单条 JSON（含 pretty-printed 的多行）、带 "data: " 前缀的 SSE、多条 SSE 事件、NDJSON
function stripDataPrefix(text) {
    return text.replace(/^data:\s*/, "");
}

function tryParse(text) {
    try {
        return { value: JSON.parse(text) };
    } catch (e) {
        return null;
    }
}

function parseOne(text, origin) {
    const parsed = tryParse(stripDataPrefix(text.trim()));
    if (!parsed) throw new SyntaxError("模型返回无法解析：" + String(origin).slice(0, 120));
    return parsed.value;
}

// 错误响应体（{"error":{...}}）直接抛出，交给调用方转成 reject
function checkError(result) {
    if (Array.isArray(result)) {
        for (const item of result) {
            if (item && item.error) throw item.error;
        }
        return result;
    }
    if (result && result.error) throw result.error;
    return result;
}

function parseString (value) {
    let text = String(value == null ? "" : value).trim();

    // 结束标记：可能单独出现，也可能紧跟在最后一条事件后面
    // #doc:done
    text = text.replace(/data:\s*\[DONE\]$/, "").trim();
    if (text === "" || text === "[DONE]") return [];
    // #end

    // 单条：带 data: 前缀或裸 JSON
    let single = tryParse(stripDataPrefix(text)) || tryParse(text);
    if (single) return checkError(single.value);

    // 多条 SSE 事件，以 "\n\ndata: " 分隔
    // #doc:multi
    const parts = text.split(/\r?\n\r?\ndata: /);
    if (parts.length > 1) return checkError(parts.map(part => parseOne(part, text)));
    // #end

    // NDJSON：逐行 JSON（跳过空行和 ":" 注释行）
    const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith(":"));
    if (lines.length > 1) return checkError(lines.map(line => parseOne(line, text)));

    throw new SyntaxError("模型返回无法解析：" + text.slice(0, 120));
}

// 解析 LLM 返回的推理内容（reasoning / reasoning_content）
// 将 <think>...</think> 形式的内容从 reasoning 字段中剥离出来
function parseReasoning(reasoning, content) {
    if (!/<\/think>/.test(reasoning)) return reasoning;

    const parts = reasoning.split("</think>");
    const thinkPart = parts[0].replace("<think>", "");
    return {
        reasoning: thinkPart,
        content: parts[1] + (content || "")
    };
}

const OPEN = "<think>";
const CLOSE = "</think>";

// 计算文本尾部与标签前缀的最长匹配长度
// 用于标签可能被截断在 chunk 边界的情况（如收到 "</thi"）
// #doc:partial
function partialTagLength(text, tag) {
    const max = Math.min(tag.length - 1, text.length);
    for (let len = max; len > 0; len--) {
        if (text.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
// #end
}

// 部分模型（如 MiniMax-M3）会把思考过程以 <think>...</think> 形式混在 content 中
// 这里把它剥离出来：思考片段归 thinkback，其余归正文
// 流式时标签可能分散在多个 chunk，依赖 state.inThink / state.thinkBuf 跨 chunk 记录状态
// 返回 { thinking, content }
function extractThink(content, state) {
    const buf = (state.thinkBuf || "") + content;
    state.thinkBuf = "";

    // 正处于思考块内：寻找 </think>
    if (state.inThink) {
        const end = buf.indexOf(CLOSE);
        if (end === -1) {
            const hold = partialTagLength(buf, CLOSE);
            state.thinkBuf = buf.slice(buf.length - hold);
            return { thinking: buf.slice(0, buf.length - hold), content: "" };
        }
        state.inThink = false;
        const rest = extractThink(buf.slice(end + CLOSE.length), state);
        return { thinking: buf.slice(0, end) + rest.thinking, content: rest.content };
    }

    // 正常正文：寻找 <think>
    const start = buf.indexOf(OPEN);
    if (start === -1) {
        const hold = partialTagLength(buf, OPEN);
        state.thinkBuf = buf.slice(buf.length - hold);
        return { thinking: "", content: buf.slice(0, buf.length - hold) };
    }

    const end = buf.indexOf(CLOSE, start);
    if (end !== -1) {
        const rest = extractThink(buf.slice(end + CLOSE.length), state);
        return {
            thinking: buf.slice(start + OPEN.length, end) + rest.thinking,
            content: buf.slice(0, start) + rest.content
        };
    }

    // 有 <think> 无 </think>：进入思考态
    state.inThink = true;
    const body = buf.slice(start + OPEN.length);
    const hold = partialTagLength(body, CLOSE);
    state.thinkBuf = body.slice(body.length - hold);
    return { thinking: body.slice(0, body.length - hold), content: buf.slice(0, start) };
}

// 流结束时调用：冲刷 extractThink 留下的截断残留，按当前所处模式归属输出
function flushThink(state) {
    const buf = state.thinkBuf || "";
    state.thinkBuf = "";
    return state.inThink ? { thinking: buf, content: "" } : { thinking: "", content: buf };
}

// 新调用的槽位：保留原始字段形状，只保证 function.arguments 是字符串
function normalizeCall(toolCall) {
    const fn = toolCall.function || {};
    return {
        ...toolCall,
        function: {
            ...fn,
            arguments: typeof fn.arguments === "string" ? fn.arguments : ""
        }
    };
}

// 续片：按 index 优先归并，否则追加到最后一个槽位
// #doc:merge
function mergeToolCall(state, toolCall) {
    if (!state._toolSlots) state._toolSlots = new Map();

    const calls = state.tool_calls;
    const index = typeof toolCall.index === "number" ? toolCall.index : null;
    const hasId = typeof toolCall.id === "string" && toolCall.id !== "";

    // 带 id 视为新调用；同 id 重复下发时复用已有槽位
    if (hasId) {
        const exist = calls.find(call => call.id === toolCall.id);
        if (exist) {
            appendArguments(exist, toolCall);
            return;
        }
        const slot = normalizeCall(toolCall);
        calls.push(slot);
        if (index !== null) state._toolSlots.set(index, slot);
        return;
    }

    let slot = index !== null ? state._toolSlots.get(index) : null;
    if (!slot && calls.length) slot = calls[calls.length - 1];

    // 首片就没有 id：建占位槽位，后续分片补齐参数
    if (!slot) {
        slot = normalizeCall(toolCall);
        calls.push(slot);
        if (index !== null) state._toolSlots.set(index, slot);
        return;
    }

    appendArguments(slot, toolCall);
// #end
}

function appendArguments(slot, toolCall) {
    const fn = toolCall.function || {};
    if (fn.name && !slot.function.name) slot.function.name = fn.name;
    if (typeof fn.arguments === "string") slot.function.arguments += fn.arguments;
}

// 处理单批 choices 数据：累加 content、拼装 tool_calls、回调 thinkback / logback
function handleChoices(choices, { logback, thinkback }, state) {
    if (!Array.isArray(choices)) return;

    for (let i = 0; i < choices.length; i++) {
        const delta = choices[i].delta;

        // 推理内容（reasoning / reasoning_content 字段）
        let reasoning = delta.reasoning || delta.reasoning_content;
        if (reasoning) {
            const parsed = parseReasoning(reasoning, delta.content);
            if (typeof parsed === "object") {
                reasoning = parsed.reasoning;
                delta.content = parsed.content;
            }
            if (thinkback) thinkback(reasoning);
        }

        // 正文内容：剥离混在 content 中的 <think>...</think> 思考片段
        if (delta.content) {
            const extracted = extractThink(delta.content, state);
            if (extracted.thinking && thinkback) thinkback(extracted.thinking);
            if (extracted.content) {
                if (logback) logback(extracted.content);
                state.content += extracted.content;
            }
        }

        // 工具调用分片
        if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
                mergeToolCall(state, toolCall);
            }
        }
    }
}

// 流结束时调用：把 <think> 标签截断残留冲刷到对应回调
function flushThinkBuffer(state, { logback, thinkback }) {
    const flushed = flushThink(state);
    if (flushed.thinking && thinkback) thinkback(flushed.thinking);
    if (flushed.content) {
        if (logback) logback(flushed.content);
        state.content += flushed.content;
    }
}

// 统一把各种错误形态收敛成 Error，保证 Promise 一定 settle
function toError(value, fallback) {
    if (value instanceof Error) return value;
    if (value && typeof value.message === "string") return new Error(value.message);
    try {
        return new Error(String(value));
    } catch (e) {
        return new Error(fallback || "模型请求失败");
    }
}

// HTTP 错误：尽量带出响应体里的 error.message，方便定位
function errorFromHttp(meta, body) {
    const status = meta && meta.status;
    let detail = "";

    if (body) {
        try {
            const parsed = JSON.parse(body);
            const raw = parsed && parsed.error;
            detail = (raw && (raw.message || raw)) || "";
        } catch (e) {
            detail = String(body).slice(0, 200);
        }
        if (detail && typeof detail !== "string") detail = JSON.stringify(detail);
    }

    return new Error("模型服务返回 HTTP " + status + (detail ? "：" + detail : ""));
}

function completions(params, logback, thinkback) {
    return new Promise((resolve, reject) => {

        // #doc:state
        const state = { content: "", tool_calls: [] };
        const callbacks = { logback, thinkback };

        let buffer = "";
        let httpError = null;
        let streamError = null;
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };
        const fail = value => finish(reject, toError(value, "模型请求失败"));
        // #end

        // #doc:body
        fetch$1({
            url: `${this.baseURL.replace(/\/+$/, "")}/chat/completions`,
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: this.model,
                messages: params.messages,
                tools: params.tools ? params.tools.map(tool => tool.description) : [],
                stream: params.stream,
            }),
            timeout: params.timeout,
            signal: params.signal
        // #end
        }).then(res => {

            // 非 2xx：非流式等错误体读完再判，流式直接中断
            res.on("http-error", meta => {
                httpError = meta;
                if (params.stream) fail(errorFromHttp(meta));
            });

            // 数据流
            // #doc:stream
            res.on("data", chunk => {
                if (settled) return;
                if (!params.stream) {
                    buffer += chunk;
                    return;
                }
                let parsed;
                try {
                    parsed = parseString(chunk.toString());
                } catch (e) {
                    streamError = e;
                    fail(e);
            // #end
                    return;
                }
                try {
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    for (const item of items) handleChoices(item.choices, callbacks, state);
                } catch (e) {
                    fail(e);
                }
            });

            // 结束
            res.on("end", () => {
                if (!params.stream) {
                    if (httpError) {
                        fail(errorFromHttp(httpError, buffer));
                        return;
                    }
                    try {
                        const parsed = parseString(buffer);
                        const choices = parsed && parsed.choices;
                        if (!choices || !choices[0] || !choices[0].message) {
                            throw new Error("模型响应缺少 choices[0].message");
                        }
                        handleChoices([{ delta: choices[0].message }], callbacks, state);
                    } catch (e) {
                        fail(e);
                        return;
                    }
                } else if (streamError) {
                    fail(streamError);
                    return;
                } else if (httpError) {
                    fail(errorFromHttp(httpError));
                    return;
                }

                // 冲刷 <think> 标签截断残留
                flushThinkBuffer(state, callbacks);
                finish(resolve, { content: state.content, tool_calls: state.tool_calls });
            });

            res.on("error", err => fail(err));
        }).catch(err => fail(err));

    });
}

// #doc:ctor
function Model(fields) {
    this.model = fields.model;
    this.apiKey = fields.apiKey;
    this.baseURL = fields.baseURL;
// #end
}

Model.prototype.completions = completions;

/**
 * 根据模型返回的 tool_calls，依次在 _this.tools 中查找匹配的工具并执行，
 * 返回与 tool_calls 等长的结果数组（同步值/异步值都会被规范化）。
 *
 * @param {Object} _this Agent 实例
 * @param {Array}  tool_calls 模型返回的工具调用列表
 * @returns {Promise<Array>} 每个工具的执行结果，未匹配到的槽位会被填入错误说明字符串
 */
function callFuns(_this, tool_calls) {

    // #doc:map
    const tasks = (tool_calls || []).map(call => {
        const fn = (call && call.function) || {};
        const tool = (_this.tools || []).find(
            t => t.description.function.name === fn.name
        );

        if (!tool) {
            return Promise.resolve("工具" + fn.name + "不存在");
        }

        if (typeof tool.execute !== "function") {
            return Promise.resolve("工具" + fn.name + "缺少 execute");
        }

        let args;
        try {
            // 无参工具：arguments 为空字符串或缺失时按 {} 处理
            args = typeof fn.arguments === "string" && fn.arguments.trim() ? JSON.parse(fn.arguments) : {};
        } catch (e) {
            return Promise.resolve("参数解析失败:" + e);
        }

        try {
            // 工具内部报错（含同步抛错）也不要阻断对话，转成字符串继续往下走
            return Promise.resolve(tool.execute(args)).catch(e => "运行出错:" + e);
        } catch (e) {
            return Promise.resolve("运行出错:" + e);
    // #end
        }
    });

    return Promise.all(tasks);
}

/**
 * 把一次工具调用的执行结果转成 tool 消息。
 */
function toToolMessage(call, value) {
    return {
        role: "tool",
        tool_call_id: call.id,
        tool_name: call.function.name,
        content: typeof value === "string" ? value : (JSON.stringify(value) + "")
    };
}

/**
 * 把模型响应按 role 追加到 messages，返回是否还有工具调用需要下一轮处理。
 */
function appendAssistantMessage(messages, result) {
    if (result.content) {
        messages.push({ role: "assistant", content: result.content });
    }
    if (result.tool_calls && result.tool_calls.length > 0) {
        messages.push({ role: "assistant", tool_calls: result.tool_calls });
        return true;
    }
    return false;
}

/**
 * 执行模型对话循环：
 * 1. 调用模型获取响应
 * 2. 若返回工具调用，依次执行工具并将结果追加到 messages，继续循环
 * 3. 否则将最终内容 resolve 给调用方
 */
async function runConversation(_this, messages, logback, thinkback) {

    // maxSteps 为 0 表示不限制
    // #doc:loop
    const maxSteps = _this.maxSteps > 0 ? _this.maxSteps : Infinity;

    for (let step = 1; step <= maxSteps; step++) {

        const result = await _this.model.completions({
            messages,
            tools: _this.tools,
            stream: _this.stream,
            signal: _this.signal || void 0,
        }, logback, thinkback);

        const hasToolCalls = appendAssistantMessage(messages, result);

        if (!hasToolCalls) {
            return result.content;
        }

        const toolResults = await callFuns(_this, result.tool_calls);

        result.tool_calls.forEach((call, i) => {
            messages.push(toToolMessage(call, toolResults[i]));
        });
        // #end
    }

    throw new Error("工具调用步骤超过 maxSteps 上限：" + _this.maxSteps);
}

function CreateTool(ms) {
    this.ms = ms;
}

/**
 * 包装一个工具。
 *
 * @param {object} input description + 可选 execute（缺省即前端工具）
 * @param {object} [options] { timeout } 前端工具等待页面回传的超时毫秒数，0 表示不限制
 */
CreateTool.prototype.create = function ({ description, execute }, options) {
    let _this = this;
    const timeout = options && options.timeout > 0 ? options.timeout : 0;

    return {
        description,
        execute: async function (args) {
            let toolInfo = {
                type: "tool-call",
                status: "pending",
                id: Date.now().toString() + "_" + Math.random().toString(36).substring(2).toUpperCase(),
                name: description.function.name,
                caller: execute ? "backend" : "frontend",
                args
            };

            // 后端工具调用
            // #doc:backend
            if (execute) {
                _this.ms.send(toolInfo); // 开始调用工具

                let result, status;
                try {
                    result = await execute(args);
                    status = "success"; // 调用成功
                } catch (error) {
                    result = error;
                    status = "error"; // 调用失败
                }

                _this.ms.send(initOption({ // 结束调用工具
                    status,
                    result
                }, toolInfo));

                // 失败继续抛出，由 callFuns 统一转成给模型的错误文本
                if (status === "error") throw result;

                return result;
            // #end
            }

            // 前端工具调用
            let settle = null;
            let timer = null;

            const done = () => {
                if (timer) { clearTimeout(timer); timer = null; }
                delete globalThis[toolInfo.id];
            };

            // 先建好 Promise 再推事件，避免页面同步回传时 _resolve 还不存在
            const waiting = new Promise((resolve, reject) => {
                settle = { resolve, reject };
            });

            globalThis[toolInfo.id] = function (result, status) {
                if (!settle) return;
                const current = settle;
                settle = null;
                done();
                if (status === "error") current.reject(result);
                else current.resolve(result);
            };

            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (!settle) return;
                    const current = settle;
                    settle = null;
                    done();
                    current.reject(new Error("前端工具调用超时：" + description.function.name));
                }, timeout);
            }

            try {
                _this.ms.send(toolInfo); // 开始调用工具
            } catch (error) {
                settle = null;
                done();
                throw error;
            }

            return waiting;
        }
    };
};

function Agent(option) {
    option = option || {};

    // #doc:ctor
    this.model = new Model(option.model);
    this.tools = option.tools || [];
    this.systemPrompt = option.systemPrompt || "";
    this.stream = option.stream || false;

    // 工具调用循环上限，0 表示不限制
    this.maxSteps = option.maxSteps > 0 ? option.maxSteps : 0;

    // 取消信号，透传给每次模型请求
    this.signal = option.signal || null;
    // #end
}

Agent.prototype.generate = function (messages, logback, thinkback) {
    if (!Array.isArray(messages)) messages = [];

    // 注入 system 提示词；首条已是同内容时跳过，避免复用同一数组时累积（原地修改，保持契约）
    // #doc:system
    if (this.systemPrompt) {
        let first = messages[0];
        if (!first || first.role !== "system" || first.content !== this.systemPrompt) {
            messages.unshift({
                role: "system",
                content: this.systemPrompt
            });
        }
    }
    // #end

    return runConversation(this, messages, logback, thinkback);
};

// ChatTransportAdapter 的真实实现：
// run() 把 Agent 的流（logback / thinkback / CreateTool 事件）转成 AuiPage 认的 generator；
// response() 把页面工具的返回值回传给 CreateTool 等待中的 Promise（globalThis[toolId]）。

const SYSTEM_PROMPT = [
    "你是 auipage 文档站的助手，只回答与这套框架、这份文档相关的问题。",
    "回答用中文，简洁、具体，能引用篇目时用「第 N 篇」的写法。",
    "需要文档内容时调用工具，不要凭印象编造篇目或代码。",
    "如果你其实是演示模型，不要假装能联网或能执行命令。"
].join("\n");

function createTransport(options) {
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

// 模型服务配置：默认种子 + 本地持久化（增删改由设置页驱动）

const KEY = "auipage.docs.agent.v1.providers";

const DEMO_ID = "demo";
const OLLAMA_ID = "ollama-local";

function seed() {
    return {
        schema: 1,
        activeId: DEMO_ID,
        list: [
            {
                id: OLLAMA_ID,
                name: "Ollama 本地",
                protocol: "openai",
                builtin: false,
                readonly: false,
                baseURL: "http://localhost:11434/v1",
                model: "qwen3.5",
                apiKey: "",
                temperature: 0.7,
                topP: 1,
                maxTokens: 2048,
                timeout: 60000,
                tools: true,
                description: "本机推理，零数据外传"
            },
            {
                id: DEMO_ID,
                name: "本地模型（演示）",
                protocol: "demo",
                builtin: true,
                readonly: true,
                model: "auipage-demo",
                description: "无需联网与密钥，用预置脚本演示完整对话与工具流程"
            }
        ]
    };
}

function normalize(value) {
    if (!value || !Array.isArray(value.list) || !value.list.length) return seed();

    // 演示模型必须一直在：用户即使旧数据里没有它，也补回来
    if (!value.list.some((item) => item && item.id === DEMO_ID)) {
        value.list = value.list.concat(seed().list.filter((item) => item.id === DEMO_ID));
    }
    if (!value.list.some((item) => item && item.id === value.activeId)) {
        value.activeId = value.list[0].id;
    }
    value.schema = 1;
    return value;
}

function loadProviders() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return seed();
        return normalize(JSON.parse(raw));
    } catch (e) {
        return seed();
    }
}

function saveProviders(state) {
    try {
        localStorage.setItem(KEY, JSON.stringify(normalize(state)));
        return true;
    } catch (e) {
        // 隐私模式或配额满：不阻断对话，只在界面上提示
        return false;
    }
}

function activeProvider(state) {
    const list = state.list || [];
    return list.find((item) => item.id === state.activeId) || list[0];
}

function setActive(state, id) {
    if (!(state.list || []).some((item) => item.id === id)) return state;
    state.activeId = id;
    saveProviders(state);
    return state;
}

function isDemo(provider) {
    return !!provider && provider.protocol === "demo";
}

function newProviderId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 新增或就地更新一条配置（编辑时保留 id）
function upsertProvider(state, input) {
    const item = {
        id: input.id || newProviderId(),
        name: String(input.name || "").trim() || "自定义模型",
        protocol: "openai",
        builtin: false,
        readonly: false,
        baseURL: String(input.baseURL || "").trim(),
        model: String(input.model || "").trim(),
        apiKey: String(input.apiKey || ""),
        temperature: Number(input.temperature) || 0,
        topP: Number(input.topP) || 1,
        maxTokens: Number(input.maxTokens) || 2048,
        timeout: Number(input.timeout) || 60000,
        tools: input.tools !== false,
        description: "浏览器直连的自定义服务"
    };

    const index = (state.list || []).findIndex((one) => one && one.id === item.id);
    if (index >= 0) {
        const old = state.list[index];
        if (old.readonly) return state;
        state.list[index] = item;
    } else {
        state.list.push(item);
    }
    saveProviders(state);
    return state;
}

function removeProvider(state, id) {
    const target = (state.list || []).find((one) => one && one.id === id);
    if (!target || target.readonly) return state;
    state.list = state.list.filter((one) => one.id !== id);
    if (state.activeId === id) state.activeId = DEMO_ID;
    saveProviders(state);
    return state;
}

// 演示模型：不联网、不发请求，用预置脚本走完「真实」的框架链路。
// 契约与 @auipage/model 的 Model 完全一致：completions(params, logback, thinkback) → { content, tool_calls }


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

function lastToolMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const item = messages[i];
        if (item && item.role === "tool") return item;
    }
    return null;
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
        "我是**本地演示模型**：回答来自预置脚本，不联网、不调用任何真实模型。",
        "",
        "这样你能在没有任何配置的情况下，完整体验一遍「流式输出、工具卡片、停止、入库」。",
        "",
        "可以试试问我：",
        "",
        "- `auipage 是什么`",
        "- `工具是怎么调用的`",
        "- `我现在在看哪一篇`（会真的触发一次工具调用）",
        "- `连不上模型怎么办`"
    ].join("\n");
}

function roundTwoAnswer(toolMessage) {
    let info = null;
    try {
        info = JSON.parse(toolMessage.content);
    } catch (e) {
        info = null;
    }
    if (!info) {
        return "工具返回的内容我没解析出来，不过这次工具调用链路是完整跑通的。";
    }
    return [
        "工具返回了，你当前在：",
        "",
        "- 页面：《" + (info.title || "未知") + "》",
        "- 分组：" + (info.section || "未标注"),
        "- 地址：`" + (info.url || "") + "`",
        "",
        "这一条回答是**第二轮**生成的——第一轮我只发了 `tool_calls`，工具跑完把结果作为 `role: \"tool\"` 的消息塞回来，我才有内容可说。",
        "也就是说：`runConversation` 的循环、`CreateTool` 的等待、`AuiPage` 的工具卡片，三者刚才都真实工作过。"
    ].join("\n");
}

/* ------------------------------------------------------------------ 意图路由 */

function plan(messages) {
    const tool = lastToolMessage(messages);
    if (tool) {
        return { think: "工具结果回来了，整理一下。", text: roundTwoAnswer(tool), call: null };
    }

    const q = lastUserText(messages);

    if (/哪一篇|这篇|当前|页面|我在看/.test(q)) {
        return {
            think: "这个问题需要知道用户当前页面，先调 page_info 工具。",
            text: "我先看一下你正停在哪个页面。",
            call: { name: "page_info", args: "{}" }
        };
    }
    if (/是什么|介绍|auipage|框架/.test(q)) {
        return { think: "问的是产品本身，按四个包的结构讲。", text: introAnswer(), call: null };
    }
    if (/工具|tool|调用|函数/.test(q)) {
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
    return { think: "没命中脚本，用兜底说明我是演示模型。", text: fallbackAnswer(), call: null };
}

/* ------------------------------------------------------------------ 模型实现 */

function DemoModel() {
    this.model = "auipage-demo";
    this.id = DEMO_ID;
}

DemoModel.prototype.completions = function (params, logback, thinkback) {
    const signal = params.signal;
    const planned = plan(params.messages || []);

    return new Promise(function (resolve, reject) {
        let content = "";
        let aborted = false;

        // 步骤队列：先思考、再正文、最后（可选）抛一个 tool_call
        const steps = [];
        if (planned.think) steps.push({ kind: "think", text: planned.think });
        if (planned.text) steps.push({ kind: "text", text: planned.text });
        if (planned.call) steps.push({ kind: "call" });

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
                if (!planned.call) return resolve({ content: content, tool_calls: [] });
                return resolve({
                    content: content,
                    tool_calls: [{
                        id: "call_" + Date.now().toString(36),
                        type: "function",
                        function: { name: planned.call.name, arguments: planned.call.args }
                    }]
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
};

// 模型工厂：真实配置走 @auipage/model 的 Model，演示配置走本地 DemoModel

function createModel(provider) {
    if (provider && provider.protocol === "demo") return new DemoModel();
    return new Model({
        model: provider.model,
        apiKey: provider.apiKey,
        baseURL: provider.baseURL
    });
}

function describeProvider(provider) {
    if (!provider) return "未配置模型";
    if (provider.protocol === "demo") return "演示模式 · 不联网";
    return provider.model + " · " + shortHost(provider.baseURL);
}

function shortHost(url) {
    try {
        return new URL(url).host;
    } catch (e) {
        return String(url || "").replace(/^https?:\/\//, "").split("/")[0];
    }
}

// 连接诊断：直接对 baseURL 发一次最小的 chat/completions，把失败翻译成用户能懂的结论
function probe(provider, timeout) {
    if (!provider) return Promise.resolve({ level: "error", message: "没有可用的模型配置" });
    if (provider.protocol === "demo") {
        return Promise.resolve({ level: "ok", message: "演示模型无需联网，立即可用" });
    }

    const base = String(provider.baseURL || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) {
        return Promise.resolve({ level: "error", message: "地址需要以 http:// 或 https:// 开头：" + base });
    }
    if (typeof fetch !== "function") {
        return Promise.resolve({ level: "error", message: "当前环境没有 fetch" });
    }

    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const limit = Math.min(Number(timeout || 8000), 15000);
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, limit);

    return fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + (provider.apiKey || "none")
        },
        body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "ping" }],
            stream: false,
            max_tokens: 1
        }),
        signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
        clearTimeout(timer);
        if (res.ok) return { level: "ok", message: "连接成功，可以用这个地址对话" };
        if (res.status === 401 || res.status === 403) {
            return { level: "warn", message: "能连上，但密钥被拒（HTTP " + res.status + "）：检查 API Key" };
        }
        if (res.status === 404) {
            return { level: "warn", message: "地址通了，但找不到接口或模型（HTTP 404）：确认 baseURL 是否带 /v1、模型名是否存在" };
        }
        return { level: "warn", message: "地址可达，但返回 HTTP " + res.status + "，检查服务日志" };
    }, function (error) {
        clearTimeout(timer);
        if (error && error.name === "AbortError") {
            return { level: "warn", message: "等了 " + Math.round(limit / 1000) + " 秒没有响应：服务没启动，或地址不可达" };
        }
        return {
            level: "error",
            message: "请求被浏览器拦住了：多半是该地址没开跨域（CORS）。本机 Ollama 可用 OLLAMA_ORIGINS=* 重启，或用 --disable-web-security 启动的浏览器访问"
        };
    });
}

// 设置页：模型服务的增删改、测试连接、切换当前使用（数据落在 localStorage）

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function field(labelText, input) {
    const wrap = el("label", "agt-field");
    wrap.appendChild(el("span", "", labelText));
    wrap.appendChild(input);
    return wrap;
}

function textInput(type, value, placeholder) {
    const input = el("input", "");
    input.type = type;
    input.value = value == null ? "" : value;
    if (placeholder) input.placeholder = placeholder;
    return input;
}

function createSettings(options) {
    const state = options.state;
    const onChange = options.onChange || function () {};

    const root = el("section", "agt-settings");

    const head = el("div", "agt-set-head");
    const back = el("button", "agt-set-back");
    back.type = "button";
    back.textContent = "← 返回对话";
    const title = el("h2", "agt-set-title", "模型服务");
    head.appendChild(back);
    head.appendChild(title);
    root.appendChild(head);

    const note = el("div", "agt-set-note");
    note.innerHTML =
        "<p><b>浏览器直连需要跨域（CORS）</b>　这里填的地址是浏览器直接请求的，对方必须允许跨域，" +
        "否则会显示「请求被浏览器拦住」。本机 Ollama 可用 <code>OLLAMA_ORIGINS=* ollama serve</code> 放行；" +
        "临时体验也可以用带 <code>--disable-web-security</code> 的浏览器打开本站（仅调试用）。</p>";
    root.appendChild(note);

    const grid = el("div", "agt-set-grid");
    root.appendChild(grid);

    const editor = el("div", "agt-editor");
    const editorCard = el("div", "agt-editor-card");
    editor.appendChild(editorCard);
    root.appendChild(editor);

    let editingId = null;

    function closeEditor() {
        editor.classList.remove("is-open");
        editingId = null;
    }

    editor.addEventListener("click", function (event) {
        if (event.target === editor) closeEditor();
    });

    function openEditor(provider) {
        editingId = provider ? provider.id : null;
        editorCard.innerHTML = "";

        const heading = el("h3", "", provider ? "编辑模型服务" : "添加模型服务");
        editorCard.appendChild(heading);

        const form = el("div", "agt-editor-form");
        const name = textInput("text", provider ? provider.name : "", "例如 我的 qwen");
        const base = textInput("text", provider ? provider.baseURL : "", "http://localhost:11434/v1");
        const model = textInput("text", provider ? provider.model : "", "qwen3.5");
        const key = textInput("password", provider ? provider.apiKey : "", "本地服务通常留空");
        const temp = textInput("number", provider ? provider.temperature : 0.7, "0.7");
        const maxTokens = textInput("number", provider ? provider.maxTokens : 2048, "2048");
        const timeout = textInput("number", provider ? provider.timeout : 60000, "60000");

        form.appendChild(field("服务名称", name));
        form.appendChild(field("接口地址 baseURL", base));
        form.appendChild(field("模型名", model));
        form.appendChild(field("API Key", key));

        const row = el("div", "agt-editor-row");
        row.appendChild(field("温度", temp));
        row.appendChild(field("maxTokens", maxTokens));
        row.appendChild(field("超时 ms", timeout));
        form.appendChild(row);
        editorCard.appendChild(form);

        const tip = el("p", "agt-editor-tip", "协议固定为 OpenAI 兼容（POST /chat/completions）。");
        editorCard.appendChild(tip);

        const foot = el("div", "agt-editor-foot");
        const cancel = el("button", "agt-btn");
        cancel.type = "button";
        cancel.textContent = "取消";
        const save = el("button", "agt-btn agt-btn-main");
        save.type = "button";
        save.textContent = "保存";
        foot.appendChild(cancel);
        foot.appendChild(save);
        editorCard.appendChild(foot);

        cancel.addEventListener("click", closeEditor);
        save.addEventListener("click", function () {
            const baseValue = base.value.trim();
            if (!/^https?:\/\//.test(baseValue)) {
                tip.textContent = "接口地址需要以 http:// 或 https:// 开头。";
                tip.classList.add("is-bad");
                return;
            }
            if (!model.value.trim()) {
                tip.textContent = "模型名不能为空，例如 qwen3.5。";
                tip.classList.add("is-bad");
                return;
            }

            options.upsert({
                id: editingId,
                name: name.value,
                baseURL: baseValue,
                model: model.value,
                apiKey: key.value,
                temperature: temp.value,
                maxTokens: maxTokens.value,
                timeout: timeout.value
            });
            closeEditor();
            paint();
            onChange();
        });

        editor.classList.add("is-open");
        setTimeout(function () { base.focus(); }, 30);
    }

    function card(provider) {
        const box = el("article", "agt-card");
        const top = el("div", "agt-card-top");
        const name = el("b", "", provider.name);
        top.appendChild(name);
        if (provider.readonly) {
            const badge = el("span", "agt-badge", "内置 · 只读");
            top.appendChild(badge);
        }
        if (provider.id === state.activeId) {
            const badge = el("span", "agt-badge agt-badge-on", "当前使用");
            top.appendChild(badge);
        }
        box.appendChild(top);

        box.appendChild(el("div", "agt-card-line", provider.protocol === "demo"
            ? "不联网 · 预置脚本回答"
            : provider.baseURL));
        box.appendChild(el("div", "agt-card-line is-dim", provider.protocol === "demo"
            ? "演示模型 · auipage-demo"
            : "模型 " + provider.model + (provider.apiKey ? " · 已填密钥" : " · 无密钥")));

        const result = el("p", "agt-card-result");
        box.appendChild(result);

        const actions = el("div", "agt-card-actions");

        const test = el("button", "agt-btn");
        test.type = "button";
        test.textContent = "测试连接";
        test.addEventListener("click", function () {
            test.disabled = true;
            result.className = "agt-card-result";
            result.textContent = "正在请求 " + (provider.protocol === "demo" ? "演示模型" : provider.baseURL) + " …";
            probe(provider, Math.min(provider.timeout || 8000, 10000)).then(function (report) {
                result.className = "agt-card-result is-" + report.level;
                result.textContent = report.message;
                test.disabled = false;
            });
        });
        actions.appendChild(test);

        if (!provider.readonly) {
            const edit = el("button", "agt-btn");
            edit.type = "button";
            edit.textContent = "编辑";
            edit.addEventListener("click", function () { openEditor(provider); });
            actions.appendChild(edit);
        }

        if (provider.id !== state.activeId) {
            const use = el("button", "agt-btn");
            use.type = "button";
            use.textContent = "设为当前";
            use.addEventListener("click", function () {
                options.activate(provider.id);
                paint();
                onChange();
            });
            actions.appendChild(use);
        }

        if (!provider.readonly) {
            const del = el("button", "agt-btn is-danger");
            del.type = "button";
            del.textContent = "删除";
            del.addEventListener("click", function () {
                options.remove(provider.id);
                paint();
                onChange();
            });
            actions.appendChild(del);
        }

        box.appendChild(actions);
        return box;
    }

    function paint() {
        grid.innerHTML = "";
        (state.list || []).forEach(function (provider) {
            grid.appendChild(card(provider));
        });

        const add = el("button", "agt-card agt-card-add");
        add.type = "button";
        add.appendChild(el("span", "", "＋ 添加模型服务"));
        add.appendChild(el("small", "", "填一个允许跨域的 OpenAI 兼容地址"));
        add.addEventListener("click", function () { openEditor(null); });
        grid.appendChild(add);
    }

    back.addEventListener("click", function () {
        root.classList.remove("is-open");
        options.onBack && options.onBack();
    });

    paint();

    return {
        root: root,
        open: function () {
            paint();
            root.classList.add("is-open");
        },
        close: function () {
            root.classList.remove("is-open");
        }
    };
}

// 面板装配：AuiPage + 四个适配器 + 输入区 + 模型切换

let instance = null;

function html(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function buildPanel() {
    const mask = html("div", "agt-mask");
    const panel = html("div", "agt-panel");

    const side = html("aside", "agt-side");
    const brand = html("div", "agt-brand");
    const logo = html("div", "agt-brand-logo");
    const logoUrl = window.__AGH_LOGO__ || "";
    if (logoUrl) {
        const mark = document.createElement("img");
        mark.src = logoUrl;
        mark.alt = "";
        mark.onerror = function () { mark.remove(); logo.textContent = "A"; };
        logo.appendChild(mark);
    } else {
        logo.textContent = "A";
    }
    brand.appendChild(logo);
    const brandText = html("div", "agt-brand-text");
    brandText.appendChild(html("b", "", "auipage 助手"));
    brandText.appendChild(html("span", "", "文档站内智能体"));
    brand.appendChild(brandText);
    side.appendChild(brand);

    const newBtn = html("button", "agt-new");
    newBtn.type = "button";
    newBtn.textContent = "+ 新对话";
    side.appendChild(newBtn);

    const threadList = html("div", "agt-threads");
    side.appendChild(threadList);

    const sideFoot = html("div", "agt-side-foot");
    sideFoot.textContent = "会话存在本机浏览器，可归档或删除";
    side.appendChild(sideFoot);
    panel.appendChild(side);

    const main = html("main", "agt-main");
    const head = html("header", "agt-head");
    const sideToggle = html("button", "agt-sidetoggle", "☰");
    sideToggle.type = "button";
    sideToggle.setAttribute("aria-label", "会话列表");
    head.appendChild(sideToggle);
    const title = html("div", "agt-title", "新对话");
    head.appendChild(title);

    const actions = html("div", "agt-actions");
    const setBtn = html("button", "agt-setbtn", "设置");
    setBtn.type = "button";
    const modelSelect = html("select", "agt-model");
    const closeBtn = html("button", "agt-close");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "×";
    actions.appendChild(setBtn);
    actions.appendChild(modelSelect);
    actions.appendChild(closeBtn);
    head.appendChild(actions);
    main.appendChild(head);
    panel.appendChild(main);

    // 手机上面板全屏，会话列表收成抽屉
    const scrim = html("div", "agt-scrim");
    panel.appendChild(scrim);
    function drawer(open) {
        side.classList.toggle("is-open", !!open);
        scrim.classList.toggle("is-on", !!open);
    }
    sideToggle.addEventListener("click", function () { drawer(!side.classList.contains("is-open")); });
    scrim.addEventListener("click", function () { drawer(false); });

    const notice = html("div", "agt-notice");
    const noticeText = html("span", "agt-notice-text");
    const noticeClose = html("button", "agt-notice-close");
    noticeClose.type = "button";
    noticeClose.textContent = "知道了";
    notice.appendChild(noticeText);
    notice.appendChild(noticeClose);
    main.appendChild(notice);

    const cors = html("div", "agt-cors");
    cors.innerHTML = "<b>需要跨域</b><span>浏览器直连该地址，服务端必须允许 CORS；本机 Ollama 可用 <code>OLLAMA_ORIGINS=*</code> 启动，或使用带 <code>--disable-web-security</code> 的浏览器临时访问。</span>";
    main.appendChild(cors);

    const chatBox = html("div", "agt-chat");
    const chatInner = html("div", "agt-chat-inner");
    chatBox.appendChild(chatInner);
    main.appendChild(chatBox);

    const compose = html("div", "agt-compose");
    const input = html("textarea", "agt-input");
    input.rows = 1;
    input.placeholder = "问点什么，比如「auipage 是什么」";
    compose.appendChild(input);

    const bar = html("div", "agt-compose-bar");
    const hint = html("span", "agt-hint", "Enter 发送 · Shift+Enter 换行");
    const sendBtn = html("button", "agt-send");
    sendBtn.type = "button";
    sendBtn.setAttribute("aria-label", "发送");
    sendBtn.textContent = "↑";
    const stopBtn = html("button", "agt-stop");
    stopBtn.type = "button";
    stopBtn.textContent = "停止";
    bar.appendChild(hint);
    bar.appendChild(stopBtn);
    bar.appendChild(sendBtn);
    compose.appendChild(bar);
    main.appendChild(compose);

    const status = html("footer", "agt-status");
    main.appendChild(status);

    mask.appendChild(panel);
    return {
        mask: mask,
        panel: panel,
        title: title,
        modelSelect: modelSelect,
        closeBtn: closeBtn,
        notice: notice,
        noticeText: noticeText,
        noticeClose: noticeClose,
        chatBox: chatInner,
        input: input,
        sendBtn: sendBtn,
        stopBtn: stopBtn,
        status: status,
        threadList: threadList,
        newBtn: newBtn,
        setBtn: setBtn,
        cors: cors,
        main: main
    };
}

function boot() {
    const ui = buildPanel();
    const state = loadProviders();

    let busy = false;

    ui.mask.addEventListener("click", function (event) {
        if (event.target === ui.mask) api.close();
    });
    ui.closeBtn.addEventListener("click", function () { api.close(); });

    const chatScope = { isDemo: function () { return isDemo(activeProvider(state)); } };
    const chat = createChatView(ui.chatBox, chatScope);
    chatScope.onAsk = function (text) {
        ui.input.value = text;
        submit();
    };

    const threads = createThreads(ui.threadList, {
        onSelect: function (threadId) {
            if (busy) return;
            page.activeThread(threadId);
            drawer(false);
        },
        onTitle: function (text) {
            ui.title.textContent = text || "新对话";
        },
        onDelete: function (threadId) { page.deleteThread(threadId); },
        onArchive: function (threadId) { page.archiveThread(threadId); },
        onUnarchive: function (threadId) { page.unarchiveThread(threadId); }
    });

    const transport = createTransport({
        getProvider: function () { return activeProvider(state); },
        tools: TOOLS,
        createModel: createModel
    });

    const page = new AuiPage({
        adapter: {
            ChatTransport: transport,
            ThreadList: threads.adapter,
            MessageHistory: threads.messageHistory
        },
        runtime: {
            ThreadList: threads.runtime,
            ChatContent: chat.runtime
        },
        tools: TOOLS
    });

    const settings = createSettings({
        state: state,
        upsert: function (input) {
            upsertProvider(state, input);
            if (!state.list.some((item) => item.id === state.activeId)) setActive(state, "demo");
        },
        remove: function (id) { removeProvider(state, id); },
        activate: function (id) { setActive(state, id); },
        onChange: function () { paintProviders(); refreshStatus(); },
        onBack: function () { ui.input.focus(); }
    });
    ui.main.appendChild(settings.root);

    function refreshStatus() {
        const provider = activeProvider(state);
        const demo = isDemo(provider);
        ui.status.textContent = (demo ? "● 演示模式 · 不联网" : "● " + describeProvider(provider)) + " · 数据只在本机浏览器";
        ui.status.classList.toggle("is-demo", demo);

        ui.notice.classList.toggle("is-on", demo);
        ui.cors.classList.toggle("is-on", !demo);
        if (demo) {
            ui.noticeText.textContent = "当前是本地演示模型：回答来自预置脚本，用于体验交互与工具流程；配置自己的模型后即为真实对话。";
        }
    }

    function paintProviders() {
        ui.modelSelect.innerHTML = "";
        state.list.forEach(function (provider) {
            const option = document.createElement("option");
            option.value = provider.id;
            option.textContent = provider.protocol === "demo" ? provider.name : provider.model;
            option.selected = provider.id === state.activeId;
            ui.modelSelect.appendChild(option);
        });
    }

    ui.setBtn.addEventListener("click", function () {
        ui.settingsOpen = true;
        settings.open();
    });

    ui.status.addEventListener("click", function () {
        settings.open();
    });

    ui.modelSelect.addEventListener("change", function () {
        if (busy) {
            paintProviders();
            return;
        }
        setActive(state, ui.modelSelect.value);
        paintProviders();
        refreshStatus();
    });

    function setBusy(value) {
        busy = value;
        ui.stopBtn.classList.toggle("is-on", value);
        ui.sendBtn.classList.toggle("is-off", value);
        ui.input.setAttribute("aria-busy", value ? "true" : "false");
    }

    function autoGrow() {
        ui.input.style.height = "auto";
        ui.input.style.height = Math.min(150, ui.input.scrollHeight) + "px";
    }

    ui.input.addEventListener("input", autoGrow);
    ui.input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit();
        }
    });

    ui.sendBtn.addEventListener("click", submit);
    ui.stopBtn.addEventListener("click", function () {
        page.stop();
    });
    ui.newBtn.addEventListener("click", function () {
        if (busy) return;
        page.newThread();
        drawer(false);
    });
    ui.noticeClose.addEventListener("click", function () {
        ui.notice.classList.remove("is-on");
    });

    function sendText(text) {
        text = String(text || "").trim();
        if (busy || !text) return;

        setBusy(true);

        page.sendMessage({
            role: "user",
            content: [{ type: "text", text: text }]
        }).then(function () {
            setBusy(false);
        }, function (error) {
            setBusy(false);
            const reason = typeof error === "string" ? error : ((error && error.message) || "发送失败");
            chat.runtime.append("assistant", { type: "text", text: "⚠ " + reason });
            chat.runtime.append("assistant", { type: "text", text: "如果是「Failed to fetch / 请求被拦住」，点右上角「设置 → 测试连接」看诊断结论。" });
        });
    }

    function submit() {
        if (busy) return;
        const text = (ui.input.value || "").trim();
        if (!text) return;

        ui.input.value = "";
        autoGrow();
        sendText(text);
    }

    page.on("task:end", function (payload) {
        setBusy(false);
        if (payload && payload.status === "cancelled") {
            chat.runtime.append("assistant", { type: "text", text: "_（本轮已取消）_" });
        } else if (payload && payload.status === "stopped") {
            chat.runtime.append("assistant", { type: "text", text: "_（已停止生成）_" });
        }
    });

    document.body.appendChild(ui.mask);

    paintProviders();
    refreshStatus();

    const api = {
        page: page,
        send: sendText,
        show: function () {
            ui.mask.classList.add("is-open");
            setTimeout(function () { ui.input.focus(); }, 60);
        },
        close: function () {
            if (busy) page.cancel();
            ui.mask.classList.remove("is-open");
        },
        state: state
    };

    window.__auipageAgent = api;
    return api;
}

function open() {
    if (!instance) instance = boot();
    instance.show();
    return instance;
}

function close() {
    if (instance) instance.close();
}

export { close, open };
