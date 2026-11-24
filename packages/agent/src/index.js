import { Model } from "@auipage/model/src/index.js";
import runConversation from "./runConversation.js";
import CreateTool from "./createTool.js";

function Agent(option) {
    option = option || {};

    this.model = new Model(option.model);
    this.tools = option.tools || [];
    this.systemPrompt = option.systemPrompt || "";
    this.stream = option.stream || false;

    // 工具调用循环上限，0 表示不限制
    this.maxSteps = option.maxSteps > 0 ? option.maxSteps : 0;
}

Agent.prototype.generate = function (messages, logback, thinkback) {
    if (!Array.isArray(messages)) messages = [];

    // 注入 system 提示词；首条已是同内容时跳过，避免复用同一数组时累积（原地修改，保持契约）
    if (this.systemPrompt) {
        let first = messages[0];
        if (!first || first.role !== "system" || first.content !== this.systemPrompt) {
            messages.unshift({
                role: "system",
                content: this.systemPrompt
            });
        }
    }

    return runConversation(this, messages, logback, thinkback);
};

export { Agent, CreateTool };
