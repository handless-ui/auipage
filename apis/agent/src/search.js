// 本地检索：构建期生成 index.json，这里按需加载 + BM25 变体打分，不联网、不引入向量库。
import { tokenize } from "./tokenize.js";

const K1 = 1.2;
const B = 0.62;

let loading = null;
let state = null;

function root() {
    if (window.__AGH_ROOT__) return window.__AGH_ROOT__;
    return "assets/agent/";
}

export function loadIndex() {
    if (state) return Promise.resolve(state);
    if (loading) return loading;
    loading = fetch(root() + "index.json", { cache: "no-cache" })
        .then(function (res) {
            if (!res.ok) throw new Error("index " + res.status);
            return res.json();
        })
        .then(function (json) {
            return installIndex(json);
        })
        .catch(function () {
            loading = null;
            return null;
        });
    return loading;
}

export function installIndex(json) {
    const docs = [];
    (json.pages || []).forEach(function (page) {
        (page.s || []).forEach(function (section) {
            const k = section.k || [];
            const counts = new Map();
            for (let i = 0; i + 1 < k.length; i += 2) counts.set(k[i], k[i + 1]);
            docs.push({
                page: page.p,
                pageTitle: page.t,
                group: page.g,
                anchor: section.a,
                heading: section.h,
                text: section.x || "",
                counts: counts,
                titleTokens: new Set(tokenize(page.t + " " + section.h)),
                len: (section.x || "").length
            });
        });
    });

    const postings = new Map();
    let totalLen = 0;
    docs.forEach(function (doc, id) {
        totalLen += doc.len;
        doc.id = id;
        doc.counts.forEach(function (tf, token) {
            let list = postings.get(token);
            if (!list) postings.set(token, list = []);
            list.push(id, tf);
        });
    });

    state = { docs: docs, postings: postings, avg: totalLen / Math.max(1, docs.length) };
    return state;
}

function idf(df) {
    const n = state.docs.length;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export function rank(query, options) {
    if (!state) return [];
    const opts = options || {};
    const tokens = tokenize(query);
    if (!tokens.length) return [];

    const weights = new Map();
    tokens.forEach(function (token) {
        weights.set(token, (weights.get(token) || 0) + 1);
    });

    const scores = new Map();
    weights.forEach(function (weight, token) {
        const list = state.postings.get(token);
        if (!list) return;
        const df = list.length / 2;
        const tokenIdf = idf(df);
        for (let i = 0; i < list.length; i += 2) {
            const id = list[i];
            const tf = list[i + 1];
            const doc = state.docs[id];
            const norm = 1 - B + B * doc.len / Math.max(1, state.avg);
            let score = tokenIdf * (tf * (K1 + 1)) / (tf + K1 * norm) * weight;
            if (doc.titleTokens.has(token)) score *= 2.2;
            scores.set(id, (scores.get(id) || 0) + score);
        }
    });

    const parts = String(query || "").split(/\s+/)
        .map(function (part) { return part.replace(/[？?。，,]/g, ""); })
        .filter(function (part) { return part.length >= 3; });
    const results = [];
    scores.forEach(function (score, id) {
        const doc = state.docs[id];
        parts.forEach(function (part) {
            if (doc.heading.replace(/\s/g, "").includes(part)) score += 5;
            if (doc.pageTitle.replace(/\s/g, "").includes(part)) score += 12;
            if (doc.text.replace(/\s/g, "").includes(part)) score += 3;
        });
        if (opts.pageRel && doc.page === opts.pageRel) score *= 1.45;
        results.push({
            page: doc.page,
            pageTitle: doc.pageTitle,
            group: doc.group,
            anchor: doc.anchor,
            heading: doc.heading,
            text: doc.text,
            score: score
        });
    });

    return results.sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
}
