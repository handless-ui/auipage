import { initOption } from "oipage/web/option/index.js";

function CreateTool(ms) {
    this.ms = ms;
}

CreateTool.prototype.create = function ({ description, execute }) {
    let _this = this;
    return {
        description,
        execute: async function (args) {
            let toolInfo = {
                type: "tool-call",
                status: "pending",
                id: Date.now().toString()+"_"+Math.random().toString(36).substring(2).toUpperCase(),
                name: description.function.name,
                caller: execute ? "backend" : "frontend",
                args
            };

            // 后端工具调用
            if (execute) {
                _this.ms.send(toolInfo); // 开始调用工具

                let result, status;
                try {
                    result = await execute(args);
                    status = "success"; // 调用成功
                } catch (error) {
                    result = error;
                    status = "error"; // 调用失败
                }

                _this.ms.send(initOption({ // 结束调用工具
                    status,
                    result
                }, toolInfo));

                return result;
            }

            // 前端工具调用
            else {
                let _resolve = null;
                globalThis[toolInfo.id] = function (result) {
                    _resolve(result);
                    delete globalThis[toolInfo.id];
                };

                _this.ms.send(toolInfo); // 开始调用工具

                return new Promise((resolve, reject) => {
                    _resolve = resolve;
                });
            }
        }
    };
};

export default CreateTool;