import { Model } from "@auipage/model";

new Model({
    baseURL: "http://localhost:11434/v1",
    apiKey: "",
    model: "qwen3.5",
}).completions({
    messages: [{
        role: "user",
        content: [{
            "type": "text",
            "text": "你是谁？",
        }]
    }],
    tools: [],
    stream: true,
}, void 0, function thinkback(text) {
    process.stdout.write("\x1b[34m" + text + "\x1b[0m");
}).then(function (result) {
    console.log("\n", result);
});
