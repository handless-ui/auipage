// 中文按「字级 bigram」切，英文/数字按单词切；构建期与浏览器共用同一套规则，保证索引与查询对得上。
const STOP = new Set([
    "的", "了", "是", "在", "和", "与", "也", "就", "都", "而", "及", "或", "一个", "这个", "那个",
    "怎么", "怎样", "如何", "什么", "为什么", "哪些", "哪一", "可以", "能否", "是否", "需要", "一下",
    "the", "a", "an", "of", "to", "and", "or", "is", "are", "in", "on", "for", "with", "how", "what"
]);

const CJK = /[\u4e00-\u9fa5]/;

function latinTokens(run, push) {
    // 驼峰与下划线拆开：handleChoices -> handle choices
    run.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-.]/g, " ")
        .split(/\s+/)
        .forEach(function (word) {
            const w = word.toLowerCase();
            if (w.length >= 2 && !STOP.has(w)) push(w);
        });
}

export function tokenize(source) {
    const tokens = [];
    const text = String(source == null ? "" : source).toLowerCase();
    const push = function (token) {
        if (token && !STOP.has(token)) tokens.push(token);
    };

    let run = "";
    let latin = true;
    const flush = function () {
        if (!run) return;
        if (latin) latinTokens(run, push);
        else {
            if (run.length === 1) push(run);
            for (let i = 0; i + 1 < run.length; i++) push(run.slice(i, i + 2));
        }
        run = "";
    };

    for (const ch of text) {
        const isCjk = CJK.test(ch);
        const isWord = /[a-z0-9]/.test(ch);
        if (isCjk) {
            if (run && latin) flush();
            latin = false;
            run += ch;
        } else if (isWord) {
            if (run && !latin) flush();
            latin = true;
            run += ch;
        } else {
            flush();
        }
    }
    flush();
    return tokens;
}

export function countTokens(source) {
    const map = new Map();
    tokenize(source).forEach(function (token) {
        map.set(token, (map.get(token) || 0) + 1);
    });
    return map;
}
