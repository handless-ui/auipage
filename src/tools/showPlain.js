import { defineTool } from "@auipage/core";

export default defineTool({
    name: "showPlain",
    description: "显示文本文件中的内容",
    parameters: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "需要显示的文本文件内容",
            }
        },
        required: ["content"],
    },
    execute: async function (args) {
        return args.content;
    },
    render: async function ({ result, status }) {
        console.log("render", result, status);

        alert(result);
        return "显示成功";
    }
});