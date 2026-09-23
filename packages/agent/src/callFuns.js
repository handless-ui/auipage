/**
 * 根据模型返回的 tool_calls，依次在 _this.tools 中查找匹配的工具并执行，
 * 返回与 tool_calls 等长的结果数组（同步值/异步值都会被规范化）。
 *
 * @param {Object} _this Agent 实例
 * @param {Array}  tool_calls 模型返回的工具调用列表
 * @returns {Promise<Array>} 每个工具的执行结果，未匹配到的槽位会被填入错误说明字符串
 */
export default function callFuns(_this, tool_calls) {

    const tasks = tool_calls.map(call => {
        const tool = _this.tools.find(
            t => t.description.function.name === call.function.name
        );

        if (!tool) {
            return Promise.resolve("工具" + call.function.name + "不存在");
        }

        let result;
        try {
            result = tool.execute(JSON.parse(call.function.arguments));
        } catch (e) {
            return Promise.resolve("参数解析失败:" + e);
        }

        if (result instanceof Promise) {
            // 工具内部报错也不要阻断对话，转成字符串继续往下走
            return result.catch(e => "运行出错:" + e);
        }
        return Promise.resolve(result);
    });

    return Promise.all(tasks);
};