import toHistoryMessages from "./tools/toHistoryMessages.js";

function AuiPage(options) {

    // 连接适配器和运行时视图
    this.adapter = {};
    this.runtime = {};
    for (let instance of Object.values(options.adapter)) {
        instance.aui = this;
        this.adapter[instance.name.replace("Adapter", "")] = instance;
    }
    for (let instance of Object.values(options.runtime)) {
        instance.aui = this;
        this.runtime[instance.name.replace("Runtime", "")] = instance;
    }

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
    this.adapter.ThreadList.list()?.then((threads) => {

        // 在页面中显示对话列表
        this.runtime.ThreadList.init(threads);
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
        this.isExecuting = true;

        let generator = this.adapter.ChatTransport.run({
            messages: [message],
            context: {
                history: this.currentMessages,
                tools: this.tools_description
            }
        });

        if (!generator) {
            this.isExecuting = false;
            reject("ChatTransport.run() 返回空值");
            return;
        }

        // 写入任务上下文，供后续协同使用
        let taskId = String(++this._taskSeq);
        this._currentTask = {
            taskId,
            message,
            generator,
            cacheMessages: [message],
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
            message
        });

        let cacheMessages = this._currentTask.cacheMessages;
        let preType = this._currentTask.preType;
        let preText = this._currentTask.preText;
        let textTypes = this._currentTask.textTypes;
        let streamFun = this._currentTask.streamFun;
        let tool_calls = this._currentTask.tool_calls;

        for (let i = 0; i < message.content.length; i++) {
            this.runtime.ChatContent.append(message.role, message.content[i]);
        }

        // 同步写入 _currentTask 的小工具
        let sync = function () {
            _this._currentTask.preType = preType;
            _this._currentTask.preText = preText;
            _this._currentTask.streamFun = streamFun;
        };

        (function doit() {
            generator?.next().then(async function (res) {
                if (!res.done) {

                    // 类型变了，或者是一种特殊类型
                    if (res.value.type != preType || !textTypes.includes(res.value.type)) {
                        streamFun = void 0;

                        if (preText) {
                            cacheMessages.push({
                                role: "assistant", content: [{
                                    type: preType,
                                    text: preText
                                }]
                            });
                            preText = "";
                            preType = "";
                        }

                        if (!textTypes.includes(res.value.type)) {

                            // 工具调用
                            if (res.value.type === "tool-call") {

                                // 工具开始调用（前端工具+后端工具）
                                if (res.value.status === "pending") {
                                    tool_calls[res.value.id] = _this.runtime.ChatContent.append("assistant", res.value);

                                    // 对于前端工具，需要自己执行工具调用
                                    if (res.value.caller === "frontend") {
                                        let result, status;

                                        try {
                                            result = await _this.tools_execute[res.value.name](res.value.args);
                                            status = "success"; // 调用成功
                                        } catch (error) {
                                            result = error;
                                            status = "error"; // 调用失败
                                        }

                                        let render = _this.tools_render[res.value.name];

                                        // 需要视图交互获取结果
                                        if (render) {
                                            let result_ui, status_ui;

                                            try {
                                                result_ui = await tool_calls[res.value.id]({
                                                    ...res.value,
                                                    result,
                                                    status,
                                                    render
                                                });
                                                status_ui = "success";
                                            } catch (error) {
                                                result_ui = error;
                                                status_ui = "error";
                                            }

                                            tool_calls[res.value.id]({
                                                ...res.value,
                                                result: result_ui,
                                                status: status_ui
                                            });
                                            delete tool_calls[res.value.id];

                                            cacheMessages.push({
                                                role: "assistant", content: [{
                                                    type: "tool-call",
                                                    name: res.value.name,
                                                    args: res.value.args,
                                                    result,
                                                    status,
                                                    ui: {
                                                        status: status_ui,
                                                        result: result_ui
                                                    }
                                                }]
                                            });

                                            _this.adapter.ChatTransport.response("tool-result", {
                                                id: res.value.id,
                                                status: status_ui,
                                                result: result_ui
                                            });
                                        }

                                        // 没有render，就相当于纯粹的工具调用
                                        else {
                                            tool_calls[res.value.id]({
                                                ...res.value,
                                                result,
                                                status
                                            });
                                            delete tool_calls[res.value.id];

                                            cacheMessages.push({
                                                role: "assistant", content: [{
                                                    type: "tool-call",
                                                    name: res.value.name,
                                                    args: res.value.args,
                                                    result,
                                                    status
                                                }]
                                            });

                                            _this.adapter.ChatTransport.response("tool-result", {
                                                id: res.value.id,
                                                result,
                                                status
                                            });
                                        }

                                    }

                                }

                                // 工具调用结束（后端工具）
                                else if (res.value.status === "success" || res.value.status === "error") {
                                    if (tool_calls[res.value.id]) {
                                        tool_calls[res.value.id](res.value);
                                        delete tool_calls[res.value.id];

                                        cacheMessages.push({
                                            role: "assistant", content: [{
                                                type: "tool-call",
                                                name: res.value.name,
                                                args: res.value.args,
                                                result: res.value.result,
                                                status: res.value.status
                                            }]
                                        });
                                    }
                                }
                            } else {
                                // console.log("【其他消息】", res.value);
                            }

                        } else {
                            preText = res.value.text;
                            preType = res.value.type;
                            streamFun = _this.runtime.ChatContent.append("assistant", res.value);
                        }

                    } else {
                        preText += res.value.text;
                        if (streamFun) streamFun(res.value.text);
                    }

                    sync();
                    doit();
                } else {
                    sync();
                    _this._finalize("complete", true);
                }
            }, err => {
                _this._finalize("error", false, err);
            });
        })();

    });
};

/**
 * 收尾当前 sendMessage 任务。统一处理：残留文本归并、是否入库、isExecuting 复位、
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

    let { taskId, message, cacheMessages, preType, preText, resolve, reject } = task;

    // 1. 残留文本归并到 cacheMessages
    if (preText) {
        cacheMessages.push({
            role: "assistant",
            content: [{ type: preType, text: preText }]
        });
        task.preText = "";
        task.preType = "";
    }

    // 2. 入库分支
    if (isHistory) {
        try {
            let historyMessages = toHistoryMessages({ messages: cacheMessages });

            if (this.currentThreadId === void 0) {
                let newThread = await this.adapter.ThreadList.new(historyMessages);

                if (!newThread) {
                    // 新建会话失败 → 退化为 error，不入库、不 resolve
                    this.isExecuting = false;
                    this._currentTask = null;
                    this._emit("task:end", { taskId, threadId: this.currentThreadId, message, status: "error" });
                    reject(new Error("新建会话失败"));
                    return;
                }

                await this.runtime.ThreadList.append(newThread);
                this.activeThread(newThread.threadId, true);
            }

            this.currentMessages.push(historyMessages);
            this.adapter.MessageHistory.append(this.currentThreadId, historyMessages);
        } catch (e) {
            // 入库链路本身抛错 → 退化为 error
            this.isExecuting = false;
            this._currentTask = null;
            this._emit("task:end", { taskId, threadId: this.currentThreadId, message, status: "error" });
            reject(e);
            return;
        }
    }

    // 4. 复位、emit task:end、释放 Promise
    this.isExecuting = false;
    this._currentTask = null;

    this._emit("task:end", { taskId, threadId: this.currentThreadId, message, status });

    if (status === "error") reject(err);
    else resolve();
};

AuiPage.prototype.activeThread = function (threadId, __noLoad__) {
    if (this.currentThreadId === threadId) return;

    // 已经有执行的，不允许切换
    if (this.isExecuting && !__noLoad__) return;

    this.currentThreadId = threadId;
    this.runtime.ThreadList.active(threadId);

    if (threadId === void 0) {
        this.currentMessages = [];
        this.runtime.ChatContent.init([]);
    } else if (!__noLoad__) {

        // 加载历史消息
        this.adapter.MessageHistory.load(threadId)?.then(messages => {
            this.currentMessages = messages;

            let plainMessages = [];
            messages.forEach(item => {
                plainMessages.push(...item.messages);
            });
            this.runtime.ChatContent.init(plainMessages);
        });
    }
};

AuiPage.prototype.deleteThread = function (threadId) {
    this.adapter.ThreadList.delete(threadId)?.then(() => {
        this.runtime.ThreadList.delete(threadId);

        if (threadId === this.currentThreadId) this.newThread();
    });

};

AuiPage.prototype.archiveThread = function (threadId) {
    this.adapter.ThreadList.archive(threadId)?.then(() => {
        this.runtime.ThreadList.archive(threadId);

        if (threadId === this.currentThreadId) this.newThread();
    });
};

AuiPage.prototype.unarchiveThread = function (threadId) {
    this.adapter.ThreadList.unarchive(threadId).then(() => {
        this.runtime.ThreadList.unarchive(threadId);
    });
};

AuiPage.prototype.newThread = function () {
    this.activeThread(void 0);
};

export default AuiPage;