// 字符串转JSON
// 适配LLM返回数据格式
export default function (value) {
    value = value.trim().replace(/^data: /, "").replace(/data: \[DONE\]$/, "");

    if (/\r{0,1}\n\r{0,1}\ndata: /.test(value)) {
        return JSON.parse("[" + (value.split(/\r{0,1}\n\r{0,1}\ndata: /)).join(",") + "]");
    } else if (value === "[DONE]") {
        return [];
    }

    let result = JSON.parse(value);
    if (result.error) throw result.error;

    return result;
};