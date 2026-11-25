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

AuiPage.prototype.sendMessage = function (message) {
    let _this = this;

    return new Promise((resolve, reject) => {

        if (this.isExecuting) return reject("当前正在执行中");

        if (!message || typeof message !== "object") return reject("消息格式不正确");

        // content 规范化：字符串包成单个 text 片段，避免逐字符渲染
        const content = normalizeContent(message.content);
        const input = Array.isArray(message.content) ? message : Object.assign({}, message, { content });

        this.isExecuting = true;

        let generator;
        try {
            generator = this.adapter.ChatTransport.run({
                messages: [input],
                context: {
                    history: this.currentMessages,
                    tools: this.tools_description
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

        // 写入任务上下文，供后续协同使用
        let taskId = String(++this._taskSeq);
        this._currentTask = {
            taskId,
            message: input,
            generator,
            cacheMessages: [input],
            preType: "",
            preText: "",
            textTypes: ["loading", "thinking", "text"],
            streamFun: void 0,
            tool_calls: {},
            resolve,
            reject,
            ended: false
        };

        // 任务开始生命周期
        this._emit("task:start", {
            taskId,
            threadId: this.currentThreadId,
            message: input
        });

        // 回显用户消息
        for (let i = 0; i < content.length; i++) {
            this.runtime.ChatContent?.append(input.role, content[i]);
        }

        (function doit() {
            if (!_this._currentTask || _this._currentTask.ended) return;

            let step;
            try {
                step = generator.next();
            } catch (error) {
                _this._finalize("error", false, error);
                return;
            }

            Promise.resolve(step).then(function (res) {
                if (!_this._currentTask || _this._currentTask.ended) return;

                if (res && res.done) {
                    _this._finalize("complete", true);
                    return;
                }

                _this._handleChunk(_this._currentTask, res).then(doit, function (error) {
                    _this._finalize("error", false, error);
                });
            }, function (error) {
                _this._finalize("error", false, error);
            });
        })();

    });
};

/**
 * 处理单个生成器分片。文本类分片按类型累积并通过 streamFun 流式追加，
 * 工具调用分片交给 _handleToolCall。
 *
 * @param {object} task 当前任务句柄
 * @param {{value: object, done: boolean}} chunk 生成器返回项
 */
AuiPage.prototype._handleChunk = async function (task, chunk) {
    if (!task || task.ended) return;

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
            task.streamFun = this.runtime.ChatContent?.append("assistant", value);
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
        const updater = asUpdater(this.runtime.ChatContent?.append("assistant", call));
        if (updater) task.tool_calls[call.id] = updater;

        // 后端工具由 ChatTransport 自己执行，这里只挂视图
        if (call.caller !== "frontend") return;

        // 前端工具需要自己执行
        const execute = this.tools_execute[call.name];
        let result, status;

        if (typeof execute === "function") {
            try {
                result = await execute(call.args);
                status = "success";
            } catch (error) {
                result = error;
                status = "error";
            }
        } else {
            result = new Error("未注册的工具：" + call.name);
            status = "error";
        }

        const render = this.tools_render[call.name];

        // 需要视图交互获取结果
        if (typeof render === "function" && updater) {
            let result_ui, status_ui;

            try {
                result_ui = await updater(Object.assign({}, call, { result, status, render }));
                status_ui = "success";
            } catch (error) {
                result_ui = error;
                status_ui = "error";
            }

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
 * 收尾当前 sendMessage 任务。统一处理：残留文本归并、入库、isExecuting 复位、
 * 发出 task:end 事件、释放 Promise。
 *
 * @param {"complete"|"error"} status 任务结束原因
 * @param {boolean} isHistory 是否走入库分支（complete 始终 true；error 始终 false）
 * @param {Error|string} [err] status === "error" 时附带的错误对象
 */
AuiPage.prototype._finalize = async function (status, isHistory, err) {
    let task = this._currentTask;
    if (!task || task.ended) return;
    task.ended = true;

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
    this.isExecuting = false;
    this._currentTask = null;

    const finalStatus = failure ? "error" : status;
    this._emit("task:end", { taskId: task.taskId, threadId: this.currentThreadId, message: task.message, status: finalStatus });

    if (finalStatus === "error") task.reject(failure || new Error("任务执行失败"));
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
