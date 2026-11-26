// 构建期把 24 页正文切成「小节块」，生成浏览器端检索用的 index.json。
// 只依赖 Node 内置模块；词频规则与 src/tokenize.js 完全一致。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countTokens } from "./src/tokenize.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const GROUPS = { guide: "教程", read: "源码解读", packages: "参考" };

function walk(dir, out) {
    for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        if (stat.isDirectory()) {
            if (name === "assets") continue;
            walk(file, out);
        } else if (name.endsWith(".html")) {
            out.push(file);
        }
    }
    return out;
}

function decode(text) {
    return String(text)
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

function plain(html) {
    return decode(String(html)
        .replace(/<br\s*\/?>/g, "\n")
        .replace(/<\/p>/g, "\n")
        .replace(/<[^>]+>/g, ""))
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();
}

function clip(text, max) {
    if (text.length <= 0) return "";
    const flat = text.replace(/\s*\n\s*/g, " ");
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max);
    const stop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("；"), cut.lastIndexOf("？"), cut.lastIndexOf("！"));
    return stop > max * 0.5 ? cut.slice(0, stop + 1) : cut + "…";
}

function pageTitle(html) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) return plain(h1[1].replace(/<em[^>]*>[\s\S]*?<\/em>/g, "")).trim();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? decode(m[1]).trim() : "";
}

function sectionsOf(html) {
    const list = [];
    const re = /<section[^>]*class="[^"]*block[^"]*"[^>]*id="(s-\d+)"[^>]*>([\s\S]*?)<\/section>/g;
    for (const m of html.matchAll(re)) {
        const anchor = m[1];
        const inner = m[2];
        const head = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
        const title = head ? plain(head[1]) : "";
        const pres = [];
        inner.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, function (all, code) {
            pres.push(plain(code));
            return all;
        });
        const proseHtml = inner
            .replace(/<div[^>]*class="[^"]*block-head[^"]*"[\s\S]*?<\/div>/g, " ")
            .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, " ")
            .replace(/<div[^>]*class="[^"]*code-head[^"]*"[\s\S]*?<\/div>/g, " ")
            .replace(/<div[^>]*class="[^"]*copy[\s\S]*?<\/div>/g, " ");
        const text = clip(plain(proseHtml), 780);
        if (!text && !title) continue;
        const code = pres.join(" ").slice(0, 600);
        list.push({ a: anchor, h: title, x: text, k: terms(title, text, code) });
    }
    return list;
}

function terms(title, text, code) {
    const map = new Map();
    [title, title, text, code].forEach(function (piece) {
        countTokens(piece).forEach(function (count, token) {
            map.set(token, (map.get(token) || 0) + count);
        });
    });
    const top = Array.from(map.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 70);
    return top.flatMap(function (pair) { return [pair[0], pair[1]]; });
}

export function buildSearchIndex(options) {
    const docsDir = options && options.docsDir ? options.docsDir : path.join(ROOT, "docs");
    const outFile = options && options.outFile ? options.outFile : path.join(docsDir, "assets/agent/index.json");
    const pages = [];
    let blocks = 0;

    for (const file of walk(docsDir, [])) {
        const rel = path.relative(docsDir, file).split(path.sep).join("/");
        if (rel === "index.html") continue;
        const html = fs.readFileSync(file, "utf8");
        const sections = sectionsOf(html);
        if (!sections.length) continue;
        blocks += sections.length;
        const dir = rel.split("/")[0];
        pages.push({
            p: rel,
            t: pageTitle(html),
            g: GROUPS[dir] || "文档",
            s: sections
        });
    }

    const payload = { v: 1, n: pages.length, b: blocks, pages: pages };
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(payload));
    return { pages: pages.length, blocks: blocks, bytes: Buffer.byteLength(JSON.stringify(payload)), outFile: outFile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = buildSearchIndex();
    console.log("已生成 " + path.relative(ROOT, result.outFile) + "（" + result.pages + " 页 / " + result.blocks + " 节，" + (result.bytes / 1024).toFixed(1) + " KB）");
}
