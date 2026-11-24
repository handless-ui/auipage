/**
 * 根据模型返回的 tool_calls，依次在 _this.tools 中查找匹配的工具并执行，
 * 返回与 tool_calls 等长的结果数组（同步值/异步值都会被规范化）。
 *
 * @param {Object} _this Agent 实例
 * @param {Array}  tool_calls 模型返回的工具调用列表
 * @returns {Promise<Array>} 每个工具的执行结果，未匹配到的槽位会被填入错误说明字符串
 */
export default function callFuns(_this, tool_calls) {

    const tasks = (tool_calls || []).map(call => {
        const fn = (call && call.function) || {};
        const tool = (_this.tools || []).find(
            t => t.description.function.name === fn.name
        );

        if (!tool) {
            return Promise.resolve("工具" + fn.name + "不存在");
        }

        if (typeof tool.execute !== "function") {
            return Promise.resolve("工具" + fn.name + "缺少 execute");
        }

        let args;
        try {
            // 无参工具：arguments 为空字符串或缺失时按 {} 处理
            args = typeof fn.arguments === "string" && fn.arguments.trim() ? JSON.parse(fn.arguments) : {};
        } catch (e) {
            return Promise.resolve("参数解析失败:" + e);
        }

        try {
            // 工具内部报错（含同步抛错）也不要阻断对话，转成字符串继续往下走
            return Promise.resolve(tool.execute(args)).catch(e => "运行出错:" + e);
        } catch (e) {
            return Promise.resolve("运行出错:" + e);
        }
    });

    return Promise.all(tasks);
};
