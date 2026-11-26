// ChatContentRuntime 的真实实现：把 AuiPage 推来的片段落成 DOM，并返回更新函数做流式增量
import { ChatContentRuntime } from "@auipage/core";
import { renderMarkdown, escapeHtml } from "../md.js";

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function prettyArgs(args) {
    try {
        const text = JSON.stringify(args || {}, null, 2);
        return text === "{}" ? "（无参数）" : text;
    } catch (e) {
        return String(args);
    }
}

function prettyResult(result) {
    if (result instanceof Error) return result.message;
    if (typeof result === "string") return result.slice(0, 600);
    try {
        return JSON.stringify(result, null, 2).slice(0, 600);
    } catch (e) {
        return String(result);
    }
}

const SUGGESTIONS = [
    "auipage 是什么",
    "我现在在看哪一篇",
    "工具是怎么被调用的",
    "模型地址连不上怎么办"
];

export function createChatView(container, scope) {
    let assistantTurn = null;
    let loadingEl = null;
    let emptyEl = null;

    function scrollToEnd() {
        // 同步贴一次，再在定时器里补一次：流式内容会在这一轮之后继续长高
        container.scrollTop = container.scrollHeight;
        setTimeout(function () {
            container.scrollTop = container.scrollHeight;
        }, 0);
    }

    function hideEmpty() {
        if (emptyEl) {
            emptyEl.remove();
            emptyEl = null;
        }
    }

    function showEmpty() {
        hideEmpty();
        emptyEl = el("div", "agt-empty");
        emptyEl.appendChild(el("h2", "", "你好，我是 auipage 助手"));
        emptyEl.appendChild(el("p", "", "可以问我这套文档里的任意一篇，也可以让我解释某个包的实现。回答会实时流式输出，工具调用也看得见。"));
        const box = el("div", "agt-chips");
        SUGGESTIONS.forEach(function (text) {
            const chip = el("button", "agt-chip", text);
            chip.type = "button";
            chip.addEventListener("click", function () {
                if (scope.onAsk) scope.onAsk(text);
            });
            box.appendChild(chip);
        });
        emptyEl.appendChild(box);
        container.appendChild(emptyEl);
    }

    function newTurn(role) {
        hideEmpty();
        const turn = el("div", "agt-turn agt-" + role);
        if (role === "assistant") {
            const avatar = el("div", "agt-ava");
            const logoUrl = window.__AGH_LOGO__ || "";
            if (logoUrl) {
                const mark = document.createElement("img");
                mark.src = logoUrl;
                mark.alt = "";
                mark.onerror = function () { mark.remove(); avatar.textContent = "AI"; };
                avatar.appendChild(mark);
            } else {
                avatar.textContent = "AI";
            }
            turn.appendChild(avatar);
        }
        const body = el("div", "agt-body");
        turn.appendChild(body);
        container.appendChild(turn);
        scrollToEnd();
        return { turn: turn, body: body };
    }

    function renderUser(part) {
        const spot = newTurn("user");
        const text = el("div", "agt-text");
        text.innerHTML = renderMarkdown(part.text || "");
        spot.body.appendChild(text);
        scrollToEnd();
    }

    function renderThinking(part) {
        const spot = assistantTurn || newTurn("assistant");
        if (loadingEl) {
            loadingEl.remove();
            loadingEl = null;
        }
        assistantTurn = spot;
        const box = el("details", "agt-think");
        const summary = el("summary", "");
        summary.textContent = "思考过程";
        box.appendChild(summary);
        const pre = el("div", "agt-think-body");
        box.appendChild(pre);
        pre.textContent = part.text || "";
        spot.body.appendChild(box);
        scrollToEnd();
        return function (delta) {
            pre.textContent += delta || "";
            scrollToEnd();
        };
    }

    function renderText(part) {
        const spot = assistantTurn || newTurn("assistant");
        assistantTurn = spot;
        if (loadingEl) {
            loadingEl.remove();
            loadingEl = null;
        }
        const block = el("div", "agt-text");
        spot.body.appendChild(block);

        let raw = part.text || "";
        let frame = null;
        block.innerHTML = renderMarkdown(raw);
        scrollToEnd();

        return function (delta) {
            raw += delta || "";
            if (frame) return;
            frame = setTimeout(function () {
                frame = null;
                block.innerHTML = renderMarkdown(raw);
                scrollToEnd();
            }, 16);
        };
    }

    function renderLoading() {
        const spot = assistantTurn || newTurn("assistant");
        assistantTurn = spot;
        if (loadingEl) return null;
        loadingEl = el("div", "agt-dots");
        loadingEl.innerHTML = "<i></i><i></i><i></i>";
        spot.body.appendChild(loadingEl);
        scrollToEnd();
        return null;
    }

    function renderToolCall(part) {
        const spot = assistantTurn || newTurn("assistant");
        assistantTurn = spot;
        if (loadingEl) {
            loadingEl.remove();
            loadingEl = null;
        }

        const card = el("div", "agt-tool");
        const head = el("div", "agt-tool-head");
        const dot = el("span", "agt-tool-dot");
        const name = el("code", "agt-tool-name");
        const status = el("span", "agt-tool-status");
        head.appendChild(dot);
        head.appendChild(name);
        head.appendChild(status);
        const body = el("div", "agt-tool-body");
        const pre = el("pre", "");
        body.appendChild(pre);
        card.appendChild(head);
        card.appendChild(body);
        spot.body.appendChild(card);

        const paint = function (value) {
            const state = value.status || "pending";
            card.dataset.status = state;
            name.textContent = value.name || "tool";
            status.textContent = state === "pending" ? "调用中" : (state === "success" ? "已完成" : "失败");
            pre.textContent = prettyArgs(value.args);
            if (state !== "pending") {
                const out = el("pre", "agt-tool-result");
                out.textContent = prettyResult(value.result);
                body.innerHTML = "";
                body.appendChild(pre);
                body.appendChild(out);
            }
        };

        paint(part);
        scrollToEnd();

        return function (value) {
            paint(value || {});
            scrollToEnd();
        };
    }

    const runtime = new ChatContentRuntime({
        init: function (messages) {
            container.innerHTML = "";
            assistantTurn = null;
            loadingEl = null;
            if (!(messages || []).length) showEmpty();
            (messages || []).forEach(function (message) {
                const parts = Array.isArray(message.content) ? message.content : [];
                if (message.role === "user") {
                    parts.forEach(function (part) {
                        if (part && part.type === "text") renderUser(part);
                    });
                    return;
                }
                parts.forEach(function (part) {
                    if (!part) return;
                    if (part.type === "text") renderText(part);
                    else if (part.type === "thinking") renderThinking(part);
                    else if (part.type === "tool-call") renderToolCall(part);
                });
            });
            assistantTurn = null;
            scrollToEnd();
        },
        append: function (role, part) {
            if (!part) return;
            if (role === "user") {
                assistantTurn = null;
                if (loadingEl) {
                    loadingEl.remove();
                    loadingEl = null;
                }
                renderUser(part);
                return;
            }
            if (part.type === "loading") return renderLoading();
            if (part.type === "thinking") return renderThinking(part);
            if (part.type === "tool-call") return renderToolCall(part);
            return renderText(part);
        }
    });

    showEmpty();

    return {
        runtime: runtime,
        showEmpty: showEmpty,
        isDemo: scope.isDemo,
        pushUser: function (text) {
            assistantTurn = null;
            renderUser({ type: "text", text: text });
        },
        reset: function () {
            container.innerHTML = "";
            assistantTurn = null;
            loadingEl = null;
        }
    };
}
