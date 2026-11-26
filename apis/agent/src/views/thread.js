// 会话列表：按日期分组（今天 / 昨天 / 具体日期 / 已归档），最近活跃的排在最上面。
// 列表、归档标记与消息历史都落 localStorage；写失败（隐私模式/配额）就退化成内存。
import { ThreadListAdapter, ThreadListRuntime, MessageHistoryAdapter } from "@auipage/core";

const THREAD_KEY = "auipage.docs.agent.v1.threads";
const HISTORY_KEY = "auipage.docs.agent.v1.history";
const MAX_THREADS = 30;
const MAX_GROUPS = 40;

function titleOf(group) {
    const messages = (group && group.messages) || [];
    for (const message of messages) {
        if (message.role !== "user") continue;
        const parts = Array.isArray(message.content) ? message.content : [];
        const text = parts.filter((p) => p && p.type === "text").map((p) => p.text).join("").trim();
        if (text) return text.length > 24 ? text.slice(0, 24) + "…" : text;
    }
    return "新对话";
}

function read(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        return false;
    }
}

function dayKey(ts) {
    const date = new Date(ts || 0);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(ts) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = dayKey(ts);
    if (day === today) return "今天";
    if (day === today - 86400000) return "昨天";
    const date = new Date(day);
    return (date.getMonth() + 1) + "月" + date.getDate() + "日";
}

function shortDate(ts) {
    const date = new Date(ts || 0);
    return (date.getMonth() + 1) + "/" + date.getDate();
}

function timeLabel(ts) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return dayKey(ts) === today ? clock(ts) : shortDate(ts);
}

function clock(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    const pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function stampOf(item) {
    return item.updatedAt || item.createdAt || 0;
}

function pageIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const body = document.createElementNS("http://www.w3.org/2000/svg", "path");
    body.setAttribute("d", "M7 3.5h6.4L19 9.1v10.1a1.4 1.4 0 0 1-1.4 1.4h-10A1.4 1.4 0 0 1 6.2 19.2V5.1A1.4 1.4 0 0 1 7.6 3.5Z");
    body.setAttribute("fill", "none");
    body.setAttribute("stroke", "currentColor");
    body.setAttribute("stroke-width", "1.4");
    body.setAttribute("stroke-linejoin", "round");
    const fold = document.createElementNS("http://www.w3.org/2000/svg", "path");
    fold.setAttribute("d", "M13.2 3.9v5.2h5.4");
    fold.setAttribute("fill", "none");
    fold.setAttribute("stroke", "currentColor");
    fold.setAttribute("stroke-width", "1.4");
    fold.setAttribute("stroke-linejoin", "round");
    svg.appendChild(body);
    svg.appendChild(fold);
    return svg;
}

export function createThreads(container, hooks) {
    const savedThreads = read(THREAD_KEY, []);
    const threads = Array.isArray(savedThreads) ? savedThreads.slice(0, MAX_THREADS) : [];
    const history = new Map();
    const savedHistory = read(HISTORY_KEY, {});
    Object.keys(savedHistory || {}).forEach(function (id) {
        if (Array.isArray(savedHistory[id])) history.set(id, savedHistory[id].slice(-MAX_GROUPS));
    });

    const items = new Map();     // threadId -> row
    const groupMap = new Map();  // dayKey(ts) -> group
    let activeId = null;
    let archGroup = null;

    function saveThreads() {
        write(THREAD_KEY, threads.slice(0, MAX_THREADS));
    }

    function saveHistory() {
        const plain = {};
        history.forEach(function (value, key) { plain[key] = value; });
        write(HISTORY_KEY, plain);
    }

    /* ---------------------------------------------------------- 分组 */

    function makeGroup(label) {
        const box = document.createElement("div");
        box.className = "agt-group";
        const head = document.createElement("div");
        head.className = "agt-group-head";
        head.textContent = label;
        const list = document.createElement("div");
        list.className = "agt-group-list";
        box.appendChild(head);
        box.appendChild(list);
        container.appendChild(box);
        return { box: box, head: head, list: list };
    }

    function ensureArchGroup() {
        if (!archGroup) {
            archGroup = makeGroup("已归档");
            archGroup.box.classList.add("is-arch");
            container.appendChild(archGroup.box);
        }
        return archGroup;
    }

    function ensureDayGroup(ts) {
        const key = dayKey(ts);
        if (groupMap.has(key)) return groupMap.get(key);
        const group = makeGroup(dayLabel(ts));
        group.box.dataset.day = String(key);
        groupMap.set(key, group);

        // 新日期组要插在「比它更早的日期组」之前、已归档组之前
        let before = archGroup ? archGroup.box : null;
        groupMap.forEach(function (other) {
            if (other === group) return;
            const day = parseInt(other.box.dataset.day, 10);
            if (day < key && (!before || before === archGroup.box || parseInt(before.dataset.day || "0", 10) < day)) {
                before = other.box;
            }
        });
        container.insertBefore(group.box, before);
        return group;
    }

    function groupOf(row) {
        const box = row && row.closest ? row.closest(".agt-group") : null;
        if (!box) return null;
        if (archGroup && box === archGroup.box) return archGroup;
        return groupMap.get(parseInt(box.dataset.day, 10)) || null;
    }

    function dropEmptyGroup(group) {
        if (!group) return;
        if (group === archGroup) {
            if (!group.list.children.length) {
                group.box.remove();
                archGroup = null;
            }
            return;
        }
        if (group.list.children.length) return;
        groupMap.delete(parseInt(group.box.dataset.day, 10));
        group.box.remove();
    }

    function insertRow(group, row, ts) {
        let before = null;
        Array.from(group.list.children).forEach(function (node) {
            if (before) return;
            const other = threads.find(function (t) { return t.threadId === node.dataset.id; });
            if (other && stampOf(other) < ts) before = node;
        });
        group.list.insertBefore(row, before);
    }

    function paintArchHead() {
        if (!archGroup) return;
        const count = archGroup.list.children.length;
        archGroup.head.textContent = count ? "已归档 · " + count : "已归档";
    }

    /* ---------------------------------------------------------- 行 */

    function closeMenus() {
        container.querySelectorAll(".agt-thread.is-menu").forEach(function (node) {
            node.classList.remove("is-menu");
        });
    }
    document.addEventListener("click", closeMenus);

    function menuItem(label, danger, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "agt-menu-item" + (danger ? " is-danger" : "");
        button.textContent = label;
        button.addEventListener("click", function (event) {
            event.stopPropagation();
            closeMenus();
            onClick();
        });
        return button;
    }

    function makeRow(item) {
        const row = document.createElement("div");
        row.className = "agt-thread";
        row.dataset.id = item.threadId;
        if (item.archived) row.classList.add("is-archived");

        const mark = document.createElement("span");
        mark.className = "agt-thread-icon";
        mark.appendChild(pageIcon());
        row.appendChild(mark);

        const main = document.createElement("button");
        main.type = "button";
        main.className = "agt-thread-main";
        const label = document.createElement("span");
        label.className = "agt-thread-title";
        label.textContent = item.title || "新对话";
        main.appendChild(label);
        main.addEventListener("click", function () {
            if (item.archived) return;
            if (hooks && hooks.onSelect) hooks.onSelect(item.threadId);
        });
        row.appendChild(main);

        const date = document.createElement("span");
        date.className = "agt-thread-date";
        date.textContent = timeLabel(item.createdAt);
        row.appendChild(date);

        const more = document.createElement("button");
        more.type = "button";
        more.className = "agt-thread-more";
        more.setAttribute("aria-label", "更多操作");
        more.textContent = "⋯";
        more.addEventListener("click", function (event) {
            event.stopPropagation();
            const open = row.classList.contains("is-menu");
            closeMenus();
            if (!open) row.classList.add("is-menu");
        });
        row.appendChild(more);

        const menu = document.createElement("div");
        menu.className = "agt-thread-menu";
        if (item.archived) {
            menu.appendChild(menuItem("恢复", false, function () {
                if (hooks && hooks.onUnarchive) hooks.onUnarchive(item.threadId);
            }));
        } else {
            menu.appendChild(menuItem("归档", false, function () {
                if (hooks && hooks.onArchive) hooks.onArchive(item.threadId);
            }));
        }
        menu.appendChild(menuItem("删除", true, function () {
            if (hooks && hooks.onDelete) hooks.onDelete(item.threadId);
        }));
        row.appendChild(menu);

        return row;
    }

    function paintActive() {
        items.forEach(function (node, id) {
            node.classList.toggle("is-active", id === activeId);
        });
        const current = threads.find((t) => t.threadId === activeId);
        if (hooks && hooks.onTitle) hooks.onTitle(current ? current.title : "新对话");
    }

    /* ---------------------------------------------------------- Runtime */

    function bumpThread(threadId) {
        const row = items.get(threadId);
        const item = threads.find((t) => t.threadId === threadId);
        if (!row || !item || item.archived) return;
        const from = groupOf(row);
        const before = stampOf(item);
        item.updatedAt = Date.now();
        row.querySelector(".agt-thread-date").textContent = shortDate(stampOf(item));
        if (dayKey(before) === dayKey(item.updatedAt)) {
            insertRow(from, row, stampOf(item));
        } else {
            row.remove();
            dropEmptyGroup(from);
            insertRow(ensureDayGroup(item.updatedAt), row, stampOf(item));
        }
        saveThreads();
    }

    const runtime = new ThreadListRuntime({
        init: function () {
            container.innerHTML = "";
            items.clear();
            groupMap.clear();
            archGroup = null;
            threads.slice().sort(function (a, b) { return stampOf(b) - stampOf(a); }).forEach(function (item) {
                runtime.append(item);
            });
            paintActive();
        },
        append: function (item) {
            if (!item || items.has(item.threadId)) return;
            const row = makeRow(item);
            const group = item.archived ? ensureArchGroup() : ensureDayGroup(stampOf(item));
            items.set(item.threadId, row);
            insertRow(group, row, stampOf(item));
            paintArchHead();
            paintActive();
        },
        active: function (threadId) {
            activeId = threadId;
            paintActive();
        },
        bump: bumpThread,
        delete: function (threadId) {
            const row = items.get(threadId);
            const group = row ? groupOf(row) : null;
            items.delete(threadId);
            history.delete(threadId);
            if (row) {
                row.classList.add("is-leaving");
                setTimeout(function () {
                    row.remove();
                    dropEmptyGroup(group);
                    paintArchHead();
                }, 160);
            }
        },
        archive: function (threadId) {
            const row = items.get(threadId);
            const item = threads.find((t) => t.threadId === threadId);
            if (!row || !item) return;
            const from = groupOf(row);
            const group = ensureArchGroup();
            row.remove();
            const fresh = makeRow(item);
            items.set(threadId, fresh);
            group.list.insertBefore(fresh, group.list.firstChild);
            dropEmptyGroup(from);
            paintArchHead();
            paintActive();
        },
        unarchive: function (threadId) {
            const row = items.get(threadId);
            const item = threads.find((t) => t.threadId === threadId);
            if (!row || !item) return;
            const from = groupOf(row);
            row.remove();
            const fresh = makeRow(item);
            items.set(threadId, fresh);
            insertRow(ensureDayGroup(stampOf(item)), fresh, stampOf(item));
            dropEmptyGroup(from);
            paintArchHead();
            paintActive();
        }
    });

    /* ---------------------------------------------------------- Adapter */

    runtime.bump = bumpThread;

    const adapter = new ThreadListAdapter({
        list: function () {
            return threads.slice();
        },
        new: function (group) {
            const now = Date.now();
            const item = {
                threadId: "t_" + now.toString(36) + Math.random().toString(36).slice(2, 5),
                title: titleOf(group),
                createdAt: now,
                updatedAt: now,
                archived: false
            };
            threads.unshift(item);
            if (threads.length > MAX_THREADS) threads.length = MAX_THREADS;
            saveThreads();
            return item;
        },
        delete: function (threadId) {
            const at = threads.findIndex((t) => t.threadId === threadId);
            if (at >= 0) threads.splice(at, 1);
            saveThreads();
            return true;
        },
        archive: function (threadId) {
            const item = threads.find((t) => t.threadId === threadId);
            if (item) item.archived = true;
            saveThreads();
            return true;
        },
        unarchive: function (threadId) {
            const item = threads.find((t) => t.threadId === threadId);
            if (item) item.archived = false;
            saveThreads();
            return true;
        }
    });

    const messageHistory = new MessageHistoryAdapter({
        load: function (threadId) {
            return (history.get(threadId) || []).slice();
        },
        append: function (threadId, group) {
            if (!history.has(threadId)) history.set(threadId, []);
            history.get(threadId).push(group);
            if (history.get(threadId).length > MAX_GROUPS) history.set(threadId, history.get(threadId).slice(-MAX_GROUPS));
            saveHistory();
            const item = threads.find((t) => t.threadId === threadId);
            if (item) {
                item.title = titleOf({ messages: [].concat.apply([], history.get(threadId).map(function (g) { return g.messages || []; })) });
                const row = items.get(threadId);
                if (row) row.querySelector(".agt-thread-title").textContent = item.title;
                bumpThread(threadId);
            }
            return true;
        }
    });

    return { adapter: adapter, runtime: runtime, messageHistory: messageHistory, threads: threads };
}
