import { Agent } from "@auipage/agent";
import readPlain from "../src/tools/readPlain.js";

new Agent({
    stream: true,
    model: {
        baseURL: "http://localhost:11434/v1",
        apiKey: "",
        model: "qwen3.5",
    },
    tools: [readPlain],
    systemPrompt: "",
}).generate([{
    role: "user",
    content: [{
        "type": "text",
        "text": "告诉我 ./AUTHORS.txt 的内容",
    }],
}], void 0, function thinkback(text) {
    process.stdout.write("\x1b[34m" + text + "\x1b[0m");
}).then(function (result) {
    console.log(result);
});
