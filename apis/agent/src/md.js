// 极简 markdown 渲染：只支持这套文档/对话实际用到的语法，输出前统一转义
export function escapeHtml(text) {
    return String(text == null ? "" : text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return out;
}

export function renderMarkdown(source) {
    const lines = String(source == null ? "" : source).split("\n");
    const html = [];
    let inCode = false;
    let codeLines = [];
    let listTag = "";
    let para = [];

    const flushPara = function () {
        if (!para.length) return;
        html.push("<p>" + inline(para.join(" ")) + "</p>");
        para = [];
    };
    const closeList = function () {
        if (listTag) {
            html.push("</" + listTag + ">");
            listTag = "";
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^```/.test(line)) {
            if (inCode) {
                html.push('<pre><code>' + escapeHtml(codeLines.join("\n")) + "</code></pre>");
                inCode = false;
                codeLines = [];
            } else {
                flushPara();
                closeList();
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            continue;
        }
        if (!line.trim()) {
            flushPara();
            closeList();
            continue;
        }

        // 命中清单：结构化标记，由这里拼 HTML；流式没收尾时 JSON 解析失败就先不渲染
        if (/^%%HITS\s/.test(line.trim())) {
            let data = null;
            try {
                data = JSON.parse(line.trim().slice(6));
            } catch (e) {
                data = null;
            }
            if (data && Array.isArray(data.items)) {
                flushPara();
                closeList();
                const items = data.items.filter(function (item) {
                    if (!item || typeof item.href !== "string") return false;
                    if (/^[a-z][a-z0-9+.-]*:/i.test(item.href)) return /^https?:\/\//i.test(item.href);
                    return !/^\/\//.test(item.href);
                }).map(function (item) {
                    return '<li><a href="' + escapeHtml(item.href) + '">' + escapeHtml(item.label) + "</a></li>";
                }).join("");
                html.push('<div class="agt-hits"><button type="button" class="agt-hits-toggle" aria-expanded="false">' + escapeHtml(data.title || "") + '</button><ul hidden>' + items + "</ul></div>");
            }
            continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            flushPara();
            closeList();
            const level = Math.min(4, heading[1].length + 2);
            html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
            continue;
        }
        const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
        const bullet = line.match(/^\s*[-*]\s+(.+)$/);
        if (ordered || bullet) {
            flushPara();
            const want = ordered ? "ol" : "ul";
            if (listTag !== want) {
                closeList();
                html.push("<" + want + ">");
                listTag = want;
            }
            html.push("<li>" + inline((ordered || bullet)[1]) + "</li>");
            continue;
        }
        closeList();
        para.push(line);
    }

    if (inCode && codeLines.length) html.push('<pre><code>' + escapeHtml(codeLines.join("\n")) + "</code></pre>");
    flushPara();
    closeList();
    return html.join("");
}
