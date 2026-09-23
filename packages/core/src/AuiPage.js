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

    // 请求对话列表
    this.adapter.ThreadList.list()?.then((threads) => {

        // 在页面中显示对话列表
        this.runtime.ThreadList.init(threads);
    });

}

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

        let cacheMessages = [message]; // 缓存消息，用于生成历史消息

        let preType = "", preText = ""; // 上一个消息的类型和文本
        let textTypes = ["loading", "thinking", "text"]; // 非特殊类型

        let streamFun, tool_calls = {};

        for (let i = 0; i < message.content.length; i++) {
            this.runtime.ChatContent.append(message.role, message.content[i]);
        }

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

                    doit();
                } else {
                    if (preText) {
                        cacheMessages.push({
                            role: "assistant",
                            content: [{
                                type: preType,
                                text: preText
                            }]
                        });
                        preText = "";
                        preType = "";
                    }

                    // 把准备入库的消息转换为历史消息
                    let historyMessages = toHistoryMessages({ messages: cacheMessages });

                    // 判断一下currentThreadId是否有值，如果没有，需要新建新的会话
                    if (_this.currentThreadId === void 0) {
                        let newThread = await _this.adapter.ThreadList.new(historyMessages);

                        if (!newThread) {
                            reject(new Error("新建会话失败"));
                            _this.isExecuting = false;
                            return;
                        }

                        await _this.runtime.ThreadList.append(newThread);
                        _this.activeThread(newThread.threadId, true);
                    }

                    _this.currentMessages.push(historyMessages);
                    _this.adapter.MessageHistory.append(_this.currentThreadId, historyMessages);

                    _this.isExecuting = false;
                    resolve();
                }
            }, err => {
                _this.isExecuting = false;
                reject(err);
            });
        })();

    });
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