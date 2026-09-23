import { Model } from "@auipage/model";
import runConversation from "./runConversation.js";
import CreateTool from "./createTool.js";

function Agent(option) {
    this.model = new Model(option.model);
    this.tools = option.tools || [];
    this.systemPrompt = option.systemPrompt || "";
    this.stream = option.stream || false;
}

Agent.prototype.generate = function (messages, logback, thinkback) {
    if (this.systemPrompt) messages.unshift({
        role: "system",
        content: this.systemPrompt
    });

    return runConversation(this, messages, logback, thinkback);
};

export { Agent, CreateTool };