import parseString from "@auipage/model/src/parseString.js";
import parseReasoning from "@auipage/model/src/reasoning.js";
import handleChoices from "@auipage/model/src/streamHandler.js";

export default function ({ describe, it, expect }) {

    describe("parseString", () => {
        it("单行 JSON 解析为对象", () => {
            const obj = { choices: [{ delta: { content: "hi" } }] };
            const result = parseString(JSON.stringify(obj));
            expect(result).toEqual(obj);
        });

        it("剥离 'data: ' 前缀", () => {
            const obj = { choices: [{ delta: { content: "hi" } }] };
            const result = parseString("data: " + JSON.stringify(obj));
            expect(result).toEqual(obj);
        });

        it("末尾 'data: [DONE]' 返回空数组", () => {
            const result = parseString("data: [DONE]");
            expect(result).toEqual([]);
        });

        it("裸 '[DONE]' 返回空数组", () => {
            const result = parseString("[DONE]");
            expect(result).toEqual([]);
        });

        it("多 SSE 块以 \\n\\n 分隔返回数组，按顺序", () => {
            const a = { choices: [{ delta: { content: "a" } }] };
            const b = { choices: [{ delta: { content: "b" } }] };
            const value = "data: " + JSON.stringify(a) + "\n\ndata: " + JSON.stringify(b) + "\n\n";

            const result = parseString(value);
            expect(result).toEqual([a, b]);
        });

        it("\\r\\n 变体也能解析", () => {
            const a = { choices: [{ delta: { content: "a" } }] };
            const b = { choices: [{ delta: { content: "b" } }] };
            const value = "data: " + JSON.stringify(a) + "\r\n\r\ndata: " + JSON.stringify(b) + "\r\n\r\n";

            const result = parseString(value);
            expect(result).toEqual([a, b]);
        });

        it("result.error 字段存在时 throw", () => {
            const errObj = { error: { message: "rate limit" } };
            let caught = null;
            try {
                parseString(JSON.stringify(errObj));
            } catch (e) {
                caught = e;
            }
            expect(caught).not.toBeNull();
            expect(caught.message).toBe("rate limit");
        });
    });

    describe("parseReasoning", () => {
        it("不含 </think> 时返回原 reasoning", () => {
            const r = parseReasoning("纯推理片段", "正文");
            expect(r).toBe("纯推理片段");
        });

        it("包含 <think>...</think> 时拆分 reasoning 与 content", () => {
            // 源码逻辑：parts = reasoning.split("</think>")
            //         reasoning = parts[0].replace("<think>","")
            //         content   = parts[1] + (content || "")
            // parts[0]="<think>hello"，去掉 <think> 后 = "hello"
            // parts[1] = "后续推理"（</think> 之后的文本），拼上原 content "WORLD"
            const r = parseReasoning("<think>hello</think>后续推理", "WORLD");
            expect(r).toEqual({ reasoning: "hello", content: "后续推理" + "WORLD" });
        });

        it("content 为空时 content 字段只剩 </think> 之后的文本", () => {
            const r = parseReasoning("<think>abc</think>rest", "");
            // parts[0]="<think>abc" → "abc"; parts[1]="rest"; content = "rest" + ""
            expect(r).toEqual({ reasoning: "abc", content: "rest" });
        });
    });

    describe("handleChoices", () => {
        it("累加 delta.content 到 state.content 并触发 logback", () => {
            const state = { content: "", tool_calls: [] };
            const calls = [];
            handleChoices(
                [{ delta: { content: "foo" } }, { delta: { content: "bar" } }],
                { logback: (t) => calls.push(t) },
                state
            );
            expect(state.content).toBe("foobar");
            expect(calls).toEqual(["foo", "bar"]);
        });

        it("delta.reasoning 触发 thinkback", () => {
            const state = { content: "", tool_calls: [] };
            const think = [];
            handleChoices(
                [{ delta: { reasoning: "step1", reasoning_content: "step2" } }],
                { thinkback: (t) => think.push(t) },
                state
            );
            // 源码：reasoning = delta.reasoning || delta.reasoning_content
            expect(think).toEqual(["step1"]);
        });

        it("reasoning 含 <think>...</think> 时被剥离并写回 delta.content", () => {
            const state = { content: "", tool_calls: [] };
            const logs = [];
            const thinks = [];
            handleChoices(
                [{ delta: { reasoning: "<think>secret</think>tail", content: "X" } }],
                { logback: (t) => logs.push(t), thinkback: (t) => thinks.push(t) },
                state
            );
            // parseReasoning 返回 {reasoning:"secret", content:"tail" + "X" = "tailX"}
            // 然后 thinkback("secret")；delta.content 被改写为 "tailX" → logback
            expect(thinks).toEqual(["secret"]);
            expect(logs).toEqual(["tailX"]);
        });

        it("tool_calls 首块带 id 推入数组", () => {
            const state = { content: "", tool_calls: [] };
            handleChoices(
                [{ delta: { tool_calls: [{ id: "1", function: { name: "f", arguments: "{\"a\":" } }] } }],
                {},
                state
            );
            expect(state.tool_calls).toEqual([{ id: "1", function: { name: "f", arguments: "{\"a\":" } }]);
        });

        it("tool_calls 后续块 arguments 累加到最后一个", () => {
            const state = { content: "", tool_calls: [{ id: "1", function: { name: "f", arguments: "{\"a\":" } }] };
            handleChoices(
                [{ delta: { tool_calls: [{ function: { arguments: "1}" } }] } }],
                {},
                state
            );
            expect(state.tool_calls.length).toBe(1);
            expect(state.tool_calls[0].function.arguments).toBe("{\"a\":1}");
        });

        it("混合 content + tool_calls 一并处理", () => {
            const state = { content: "", tool_calls: [] };
            const logs = [];
            handleChoices(
                [{ delta: { content: "A", tool_calls: [{ id: "x", function: { name: "n", arguments: "1" } }] } }],
                { logback: (t) => logs.push(t) },
                state
            );
            expect(state.content).toBe("A");
            expect(state.tool_calls).toEqual([{ id: "x", function: { name: "n", arguments: "1" } }]);
            expect(logs).toEqual(["A"]);
        });
    });

};