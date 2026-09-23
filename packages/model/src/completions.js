import { fetch } from "@auipage/fetch";
import parseString from "./parseString.js";
import handleChoices from "./streamHandler.js";

export default function completions(params, logback, thinkback) {
    return new Promise((resolve, reject) => {

        const state = { content: "", tool_calls: [] };
        const callbacks = { logback, thinkback };

        let buffer = "";

        fetch({
            url: `${this.baseURL}/chat/completions`,
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
            })
        }).then(res => {

            // 数据流
            res.on("data", chunk => {
                if (params.stream) {
                    const parsed = parseString(chunk.toString());
                    if (Array.isArray(parsed)) {
                        for (const item of parsed) {
                            handleChoices(item.choices, callbacks, state);
                        }
                    } else {
                        handleChoices(parsed.choices, callbacks, state);
                    }
                } else {
                    buffer += chunk;
                }
            });

            // 结束
            res.on("end", () => {
                if (!params.stream) {
                    handleChoices(
                        [{ delta: parseString(buffer).choices[0].message }],
                        callbacks,
                        state
                    );
                }
                resolve({ content: state.content, tool_calls: state.tool_calls });
            });

            res.on("error", err => reject(err));
        }).catch(err => reject(err));

    });
}
