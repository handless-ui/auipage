import toHistoryMessages from "./tools/toHistoryMessages.js";

// 挂载适配器/运行时：name 缺失时回退到配置对象的 key，避免直接崩
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

// 适配器调用：Promise 就等完成，同步值直接处理，同步返回 undefined 视为未实现
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

// 安全调用：返回值可能为 void / Promise，异常与拒绝都不外泄
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

// content 规范化为片段数组：字符串按整段处理，避免逐字符渲染
function normalizeContent(content) {
    if (Array.isArray(content)) return content;
    if (content === void 0 || content === null) return [];
    if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
    return [content];
}

// 取消时等待 next() 落定的兜底上限（毫秒），防止适配器忽略 signal 时页面停在执行中
const DEFAULT_STOP_TIMEOUT = 5000;

// 被取消的任务：后续分片与工具结果一律丢弃；被 stop 则继续把结果落地
function isCancelled(task) {
    return !!(task.endRequest && task.endRequest.status === "cancelled");
}

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

// 触发生命周期事件；handler 抛错被吞掉，避免影响 sendMessage 主流程
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

// 交给界面渲染，同时登记显示条目：取消时据此告诉界面涉及哪几条
AuiPage.prototype._render = function (task, role, part) {
    const content = this.runtime.ChatContent;
    if (!content || typeof content.append !== "function") return;

    task.displayed.push({ index: task.displayed.length, role: role, part: part });
    return content.append(role, part);
};

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

/**
 * 主动结束当前任务：当作成功收尾——内容保留、入库标记 stopped、sendMessage 正常 resolve。
 * 与 cancel 的区别只在这份“怎么收下这一轮”的口径，不在谁点的。
 *
 * @returns {boolean} 当时是否有正在执行的任务
 */
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

/**
 * 处理单个生成器分片。文本类分片按类型累积并通过 streamFun 流式追加，
 * 工具调用分片交给 _handleToolCall。
 *
 * @param {object} task 当前任务句柄
 * @param {{value: object, done: boolean}} chunk 生成器返回项
 */
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

/**
 * 工具调用分片：pending 时挂上视图并执行前端工具，success/error 时回填后端工具结果。
 *
 * @param {object} task 当前任务句柄
 * @param {object} call 工具调用分片
 */
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

        // 需要视图交互获取结果
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
    }

    // 工具调用结束（后端工具）
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

AuiPage.prototype.newThread = function () {
    this.activeThread(void 0);
};

export default AuiPage;
