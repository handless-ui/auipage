// 工具注册表：全部是「前端工具」——定义在 Agent 侧（只有 description），
// 真正执行发生在页面（AuiPage.tools_execute），结果再经 ChatTransport.response 回传。
import { defineTool } from "@auipage/core/src/index.js";

const pageInfo = defineTool({
    name: "page_info",
    description: "读取用户当前正在阅读的文档页：标题、分组、地址。用户问『我在看哪一篇』时调用。",
    parameters: {
        type: "object",
        properties: {},
        required: []
    },
    execute: function () {
        const heading = document.querySelector(".pagehead h1");
        const crumbs = document.querySelector(".pagehead .crumbs");
        return {
            title: (heading && heading.textContent || document.title || "").trim(),
            section: (crumbs && crumbs.textContent || "").replace(/\s+/g, " ").trim(),
            url: location.pathname.split("/").slice(-3).join("/")
        };
    }
});

const listPages = defineTool({
    name: "list_pages",
    description: "列出文档站当前已有的分组与页数，用于回答『文档里都有什么』。",
    parameters: {
        type: "object",
        properties: {},
        required: []
    },
    execute: function () {
        const links = Array.from(document.querySelectorAll(".tree a"));
        const groups = Array.from(document.querySelectorAll(".tree .group")).map((el) => el.textContent.trim());
        return {
            count: links.length,
            groups: groups,
            first: links.slice(0, 3).map((a) => a.textContent.trim())
        };
    }
});

export const TOOLS = [pageInfo, listPages];

// Agent 侧只需要 description；没有 execute 即代表「前端工具」，交给 AuiPage 执行
export function agentTools() {
    return TOOLS.map((tool) => ({ description: tool.description }));
}
