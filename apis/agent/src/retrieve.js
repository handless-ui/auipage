// 把检索结果拼成「摘录式」回答：只用原文句子，附命中清单，不生成新事实。
import { loadIndex, rank } from "./search.js";
import { tokenize } from "./tokenize.js";

const MAX_BODY = 350;

// 只覆盖文档里真实出现的说法，不做通用近义词猜测
const ALIASES = [
    [/零依赖|不用装|无依赖|不装依赖/, "一个包都不用 npm install 依赖"],
    [/会话历史|历史消息|消息历史/, "会话 历史 message history toModelMessages"],
    [/一轮对话|一轮/, "一轮对话 runConversation"],
    [/前端工具|后端工具/, "前端工具 后端工具 CreateTool"] ,
    [/跨域|连不上|CORS/, "跨域 CORS"],
    [/流式|SSE/, "流式 SSE 解析"]
];

export function expand(query) {
    let text = String(query || "");
    ALIASES.forEach(function (pair) {
        if (pair[0].test(text)) text += " " + pair[1];
    });
    return text;
}

function docsBase() {
    return window.__AGH_DOCS_BASE__ || "";
}

function pageRel() {
    return window.__AGH_PAGE__ || "";
}

function escapeHtml(text) {
    return String(text == null ? "" : text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function sentences(text) {
    const list = String(text || "")
        .split(/(?<=[。！？；])/)
        .map(function (item) { return item.trim(); })
        .filter(Boolean);
    return list.length ? list : String(text || "").trim() ? [String(text).trim()] : [];
}

function cut(text, max) {
    const flat = String(text || "").replace(/\s+/g, " ");
    if (flat.length <= max) return flat;
    return flat.slice(0, max - 1) + "…";
}

function bestSentence(section, query) {
    const parts = sentences(section.text);
    if (!parts.length) return "";
    const tokens = Array.from(new Set(tokenize(query)));
    let best = parts[0];
    let bestScore = -1;
    parts.forEach(function (part, index) {
        let hits = 0;
        tokens.forEach(function (token) {
            if (part.toLowerCase().includes(token)) hits += 1;
        });
        const score = hits * 2 - index * 0.2;
        if (score > bestScore) {
            bestScore = score;
            best = part;
        }
    });
    return best;
}

function directAnswer(section, query) {
    const parts = sentences(section.text);
    if (!parts.length) return "";
    let answer = bestSentence(section, query);
    const next = parts[parts.indexOf(answer) + 1];
    if (answer.length < 50 && next && answer.length + next.length <= 120) answer += next;
    if (answer.length <= 128) return answer;
    const head = answer.slice(0, 126);
    const comma = Math.max(head.lastIndexOf("，"), head.lastIndexOf("；"), head.lastIndexOf("、"));
    return (comma > 60 ? head.slice(0, comma) : head) + "…";
}

function pointOf(section, query) {
    return cut(bestSentence(section, query), 78);
}

function hitsHtml(results) {
    const top = results.slice(0, 5);
    const pages = new Set(top.map(function (item) { return item.page; })).size;
    const items = top.map(function (item) {
        return {
            href: docsBase() + item.page + "#" + item.anchor,
            label: "《" + item.pageTitle + "》" + (item.heading ? " · " + item.heading : "")
        };
    });
    // 结构化标记交给渲染层拼 DOM，避免把模型输出当 HTML 直接塞进页面
    return "%%HITS " + JSON.stringify({
        title: "命中 " + top.length + " 处 · " + pages + " 篇",
        items: items
    });
}

export function buildAnswer(query, results) {
    const top = results[0];
    const answer = directAnswer(top, query);
    const lines = ["关于「" + cut(query, 22) + "」：", "", answer];
    let bodyLength = answer.length + 12;

    const used = new Set([top.page + "#" + top.anchor]);
    const points = [];
    results.slice(1).forEach(function (item) {
        if (points.length >= 2) return;
        const id = item.page + "#" + item.anchor;
        if (used.has(id)) return;
        const point = pointOf(item, query);
        if (!point || point === answer) return;
        const line = "- " + point + "（" + item.pageTitle + " · " + item.heading + "）";
        if (bodyLength + line.length > 330) return;
        used.add(id);
        bodyLength += line.length;
        points.push(line);
    });

    if (points.length) {
        lines.push("", "这几处也相关：");
        points.forEach(function (line) { lines.push(line); });
    }
    lines.push("", hitsHtml(results));
    return lines.join("\n");
}

export async function retrieveAnswer(query) {
    const index = await loadIndex();
    if (!index) return { ok: false, text: "", think: "", results: [] };

    const results = rank(expand(query), { pageRel: pageRel() });
    const top = results[0];
    if (!top || top.score < 10) {
        return { ok: false, text: "", think: "文档里没有足够接近的内容。", results: results.slice(0, 3) };
    }

    const pages = new Set(results.slice(0, 5).map(function (item) { return item.page; })).size;
    return {
        ok: true,
        text: buildAnswer(query, results),
        think: "在 " + (index.docs.length || 0) + " 节文档里检索，命中 " + Math.min(results.length, 5) + " 处（" + pages + " 篇），按原文整理回答。",
        results: results
    };
}

export function noHitAnswer(query, results) {
    const near = results && results.length
        ? "比较接近的是《" + results[0].pageTitle + "》里的「" + results[0].heading + "」，但没有直接对应这句话的段落。"
        : "这套文档里暂时没有相关内容。";
    return [
        "文档里没有直接写到「" + cut(query, 20) + "」。",
        "",
        near,
        "",
        "可以换成文档里的说法再问一次：",
        "",
        "- `流式解析怎么做`",
        "- `工具是前端跑还是后端跑`",
        "- `零依赖是怎么做到的`"
    ].join("\n");
}
