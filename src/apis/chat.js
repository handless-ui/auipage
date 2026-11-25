import { Agent, CreateTool } from "@auipage/agent/src/index.js";
import { MessageStream } from "@auipage/core/src/index.js";
import readPlain from "../tools/readPlain.js";

export default {
    test: /^\/api\/chat/,
    handler: function (req, res) {
        if (req.method === "POST") {

            // 新任务
            if (req.url === "/api/chat") {

                // 和页面的消息发送对象
                let ms = new MessageStream(function (data) {
                    // 页面已断开（用户点了停止）时不再往关闭的连接写
                    if (res.writableEnded) return;
                    res.write("data: " + JSON.stringify(data) + "\n\n");
                }, function () {
                    if (res.writableEnded) return;
                    res.end();
                });

                // 页面断开就中断本轮模型请求，避免白跑
                const controller = new AbortController();
                res.on("close", () => controller.abort());

                let ct = new CreateTool(ms);

                let postData = ""
                req.on('data', (chunk) => { postData += chunk; });
                req.on('end', () => {
                    const data = JSON.parse(postData);
                    res.writeHead('200', {
                        'Access-Control-Allow-Origin': '*',
                        'Server': 'Powered by auipage',
                        'Content-type': 'text/event-stream;charset=utf-8'
                    });

                    new Agent({
                        stream: true,
                        model: {
                            baseURL: "http://localhost:11434/v1",
                            apiKey: "",
                            model: "qwen3.5",
                        },

                        // ct.create是一个用于创建工具的函数
                        // 只适合@auipage/agent使用
                        // 其余智能体需要自己实现工具的创建
                        tools: [

                            // 后端工具
                            ct.create(readPlain),

                            // 前端工具
                            ...data.tools.map((tool) => ct.create(tool))
                        ],
                        systemPrompt: "如果可以，请尽力用showPlain工具显示文本文件内容",

                        // 工具调用循环上限
                        maxSteps: 8,

                        // 取消信号：页面断开时中断模型请求
                        signal: controller.signal,
                    }).generate(data.messages, void 0, function thinkback(text) {
                        ms.send({
                            type: "thinking",
                            text,
                        });
                    }).then(function (result) {
                        if (controller.signal.aborted) return;
                        ms.send({
                            type: "text",
                            text: result,
                        });
                        ms.end();
                    }).catch(function (error) {
                        // 主动取消导致的 reject 不必回写
                        if (controller.signal.aborted) return;

                        // 出错也要结束 SSE，否则页面一直等到超时
                        ms.send({
                            type: "text",
                            text: "请求失败：" + (error && error.message ? error.message : error),
                        });
                        ms.end();
                    });

                });

            }

            // 前端工具调用相应
            else if (req.url === "/api/chat/tool-result") {
                let postData = ""
                req.on('data', (chunk) => { postData += chunk; });
                req.on('end', () => {
                    const data = JSON.parse(postData);
                    if (globalThis[data.id]) {
                        globalThis[data.id](data.result, data.status);
                        delete globalThis[data.id];
                    }

                    res.writeHead('200', {
                        'Access-Control-Allow-Origin': '*',
                        'Server': 'Powered by auipage',
                        'Content-type': 'application/javascript;charset=utf-8'
                    });
                    res.write(JSON.stringify({ success: true }));
                    res.end();
                });
            }
        }
    }
};