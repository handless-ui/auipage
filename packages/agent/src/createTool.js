import { initOption } from "oipage/web/option/index.js";

function CreateTool(ms) {
    this.ms = ms;
}

/**
 * 包装一个工具。
 *
 * @param {object} input description + 可选 execute（缺省即前端工具）
 * @param {object} [options] { timeout } 前端工具等待页面回传的超时毫秒数，0 表示不限制
 */
CreateTool.prototype.create = function ({ description, execute }, options) {
    let _this = this;
    const timeout = options && options.timeout > 0 ? options.timeout : 0;

    return {
        description,
        execute: async function (args) {
            let toolInfo = {
                type: "tool-call",
                status: "pending",
                id: Date.now().toString() + "_" + Math.random().toString(36).substring(2).toUpperCase(),
                name: description.function.name,
                caller: execute ? "backend" : "frontend",
                args
            };

            // 后端工具调用
            // #doc:backend
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

                // 失败继续抛出，由 callFuns 统一转成给模型的错误文本
                if (status === "error") throw result;

                return result;
            // #end
            }

            // 前端工具调用
            let settle = null;
            let timer = null;

            const done = () => {
                if (timer) { clearTimeout(timer); timer = null; }
                delete globalThis[toolInfo.id];
            };

            // 先建好 Promise 再推事件，避免页面同步回传时 _resolve 还不存在
            const waiting = new Promise((resolve, reject) => {
                settle = { resolve, reject };
            });

            globalThis[toolInfo.id] = function (result, status) {
                if (!settle) return;
                const current = settle;
                settle = null;
                done();
                if (status === "error") current.reject(result);
                else current.resolve(result);
            };

            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (!settle) return;
                    const current = settle;
                    settle = null;
                    done();
                    current.reject(new Error("前端工具调用超时：" + description.function.name));
                }, timeout);
            }

            try {
                _this.ms.send(toolInfo); // 开始调用工具
            } catch (error) {
                settle = null;
                done();
                throw error;
            }

            return waiting;
        }
    };
};

export default CreateTool;
