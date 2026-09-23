/**
 * defineTool：工具工厂，把平铺参数组装为标准工具对象
 */
import type { DefineToolOptions, Tool } from "./tool.js";

/**
 * @example
 * defineTool({
 *     name: "showPlain",
 *     description: "显示文本文件中的内容",
 *     parameters: { type: "object", properties: { ... }, required: ["content"] },
 *     execute: async (args) => args.content,
 *     render: async ({ result }) => { alert(result); return "显示成功"; }
 * });
 */
declare function defineTool(options: DefineToolOptions): Tool;

export default defineTool;
