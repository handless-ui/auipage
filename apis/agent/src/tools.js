// 工具注册表：
// - 前端工具：Agent 侧只有 description，真正执行在 AuiPage.tools_execute，结果经 ChatTransport.response 回传；
// - 适配器侧工具（scope: "adapter"）：execute 在 transport 内执行，用来演示 CreateTool 的 backend 分支；
// - DEMO_ONLY_TOOLS：只在演示模式挂载，避免真实模型误调用。
import { defineTool } from "@auipage/core/src/index.js";
import { loadIndex } from "./search.js";

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

// 适配器侧执行：不依赖页面 DOM，execute 在 transport 里跑
const docStats = defineTool({
    name: "doc_stats",
    description: "读取当前构建的文档索引统计：页数、小节数、索引体积。回答『索引有多大/收录了多少』时调用。",
    parameters: {
        type: "object",
        properties: {},
        required: []
    },
    execute: async function () {
        const index = await loadIndex();
        if (!index) return { pages: 0, sections: 0, version: "missing" };
        const pages = new Set(index.docs.map(function (doc) { return doc.page; })).size;
        return {
            pages: pages,
            sections: index.docs.length,
            version: "build"
        };
    }
});
docStats.scope = "adapter";

// 自定义工具卡：execute 只返回上下文，真正的交互在 render 里
const deepDive = defineTool({
    name: "deep_dive",
    description: "当用户想继续展开某个小节时，弹一张确认卡，让用户决定是否继续深挖。",
    parameters: {
        type: "object",
        properties: {
            topic: { type: "string", description: "要展开的小节或问题" }
        },
        required: ["topic"]
    },
    execute: function (args) {
        return { topic: String((args && args.topic) || "当前小节") };
    },
    render: function (data) {
        return data;
    }
});

// 仅演示模式挂载：让「工具失败」这条路径也能被看见
const demoFail = defineTool({
    name: "demo_fail",
    description: "仅用于演示：这个工具会故意抛错，用来观察工具失败卡与错误回灌。",
    parameters: {
        type: "object",
        properties: {},
        required: []
    },
    execute: function () {
        throw new Error("演示工具失败：这是刻意抛出的错误");
    }
});

export const TOOLS = [pageInfo, listPages, docStats, deepDive];
export const DEMO_ONLY_TOOLS = [demoFail];
export const ALL_TOOLS = TOOLS.concat(DEMO_ONLY_TOOLS);

// Agent 侧只需要 description；没有 execute 即代表「前端工具」，交给 AuiPage 执行
export function agentTools() {
    return TOOLS.map((tool) => ({ description: tool.description }));
}
