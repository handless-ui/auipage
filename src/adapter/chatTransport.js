import { ChatTransportAdapter, generator, toModelMessages } from "@auipage/core";
import { fetch } from "@auipage/fetch";
import { $remote } from "./tool.js";

// 定义对话连接
export default new ChatTransportAdapter({

    /**
     * @param messages - 本次发送的页面消息数组
     * @param context - 比如 context.history（本会话历史）、context.tools（可用工具）等
     */
    // https://zxl20070701.github.io/notebook/index.html#/program/language/javascript/grammar/iterator-generator
    async *run({ messages, context }) {

        // 页面消息是富片段，需先转成模型消息，否则多轮对话没有上下文
        const history = toModelMessages(context.history);
        const current = toModelMessages(messages);

        // 显示思考状态
        yield { type: "loading", text: "思考中..." };

        yield* generator(function (callYield, callEnd, callError) {
            fetch({
                url: "/api/chat",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messages: history.concat(current),
                    tools: context.tools
                })
            }).then(res => {

                res.on('data', payload => {
                    let data = JSON.parse(payload);
                    callYield(data);
                });

                res.on('end', () => {
                    callEnd()
                });

                res.on('error', callError);

            }).catch(callError);
        });

    },

    // 响应智能体请求
    // 对于工具执行结果 name = "tool-result"
    response(name, data) {
        return $remote.post(`/api/chat/${name}`, data);
    }

});
