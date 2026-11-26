// 会话三件套：Adapter 与 Runtime 之外，多一层本机持久化（localStorage）。
// 会话列表、归档标记与消息历史都落盘，刷新后还能看到；写失败（隐私模式/配额）就退化成内存。
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

function clock(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    const pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

export function createThreads(container, hooks) {
    const savedThreads = read(THREAD_KEY, []);
    const threads = Array.isArray(savedThreads) ? savedThreads.slice(0, MAX_THREADS) : [];
    const history = new Map();
    const savedHistory = read(HISTORY_KEY, {});
    Object.keys(savedHistory || {}).forEach(function (id) {
        if (Array.isArray(savedHistory[id])) history.set(id, savedHistory[id].slice(-MAX_GROUPS));
    });

    const items = new Map();
    let activeId = null;
    let archivedCount = 0;

    const archBox = document.createElement("div");
    archBox.className = "agt-arch";
    const archHead = document.createElement("button");
    archHead.type = "button";
    archHead.className = "agt-arch-head";
    const archList = document.createElement("div");
    archList.className = "agt-arch-list";
    archBox.appendChild(archHead);
    archBox.appendChild(archList);
    container.appendChild(archBox);

    function saveThreads() {
        write(THREAD_KEY, threads.slice(0, MAX_THREADS));
    }

    function saveHistory() {
        const plain = {};
        history.forEach(function (value, key) { plain[key] = value; });
        write(HISTORY_KEY, plain);
    }

    function paintArch() {
        archivedCount = threads.filter((t) => t.archived).length;
        archHead.textContent = "已归档 · " + archivedCount;
        archBox.classList.toggle("is-on", archivedCount > 0);
    }

    function makeRow(item) {
        const row = document.createElement("div");
        row.className = "agt-thread";
        row.dataset.id = item.threadId;

        const main = document.createElement("button");
        main.type = "button";
        main.className = "agt-thread-main";
        const label = document.createElement("span");
        label.className = "agt-thread-title";
        label.textContent = item.title || "新对话";
        const time = document.createElement("span");
        time.className = "agt-thread-time";
        time.textContent = clock(item.createdAt);
        main.appendChild(label);
        row.appendChild(main);
        row.appendChild(time);

        const acts = document.createElement("div");
        acts.className = "agt-thread-acts";

        if (!item.archived) {
            const archive = document.createElement("button");
            archive.type = "button";
            archive.className = "agt-thread-act";
            archive.title = "归档这条会话";
            archive.textContent = "归档";
            archive.addEventListener("click", function () {
                if (hooks && hooks.onArchive) hooks.onArchive(item.threadId);
            });
            acts.appendChild(archive);
        } else {
            const back = document.createElement("button");
            back.type = "button";
            back.className = "agt-thread-act";
            back.title = "恢复到会话列表";
            back.textContent = "恢复";
            back.addEventListener("click", function () {
                if (hooks && hooks.onUnarchive) hooks.onUnarchive(item.threadId);
            });
            acts.appendChild(back);
        }

        const del = document.createElement("button");
        del.type = "button";
        del.className = "agt-thread-act is-danger";
        del.title = "删除这条会话";
        del.textContent = "删除";
        del.addEventListener("click", function () {
            if (hooks && hooks.onDelete) hooks.onDelete(item.threadId);
        });
        acts.appendChild(del);
        row.appendChild(acts);

        main.addEventListener("click", function () {
            if (item.archived) return;
            if (hooks && hooks.onSelect) hooks.onSelect(item.threadId);
        });

        return row;
    }

    function paintActive() {
        items.forEach(function (node, id) {
            node.classList.toggle("is-active", id === activeId);
        });
        const current = threads.find((t) => t.threadId === activeId);
        if (hooks && hooks.onTitle) hooks.onTitle(current ? current.title : "新对话");
    }

    const runtime = new ThreadListRuntime({
        init: function (list) {
            container.querySelectorAll(".agt-thread").forEach(function (node) { node.remove(); });
            items.clear();
            const groups = threads.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
            groups.forEach(function (item) { runtime.append(item); });
            paintArch();
            paintActive();
        },
        append: function (item) {
            if (!item || items.has(item.threadId)) return;
            const row = makeRow(item);
            if (item.archived) archList.appendChild(row);
            else container.insertBefore(row, archBox);
            items.set(item.threadId, row);
            if (item.archived) row.classList.add("is-archived");
            paintArch();
            paintActive();
            archHead.classList.toggle("is-empty", !archivedCount);
        },
        active: function (threadId) {
            activeId = threadId;
            paintActive();
        },
        delete: function (threadId) {
            const row = items.get(threadId);
            if (row) {
                row.classList.add("is-leaving");
                setTimeout(function () { row.remove(); }, 160);
            }
            items.delete(threadId);
            history.delete(threadId);
            paintArch();
        },
        archive: function (threadId) {
            const row = items.get(threadId);
            if (!row) return;
            const item = threads.find((t) => t.threadId === threadId);
            row.classList.add("is-archived");
            row.querySelector(".agt-thread-acts").innerHTML = "";
            archList.appendChild(row);
            if (item) {
                const back = document.createElement("button");
                back.type = "button";
                back.className = "agt-thread-act";
                back.textContent = "恢复";
                back.addEventListener("click", function () {
                    if (hooks && hooks.onUnarchive) hooks.onUnarchive(threadId);
                });
                const del = document.createElement("button");
                del.type = "button";
                del.className = "agt-thread-act is-danger";
                del.textContent = "删除";
                del.addEventListener("click", function () {
                    if (hooks && hooks.onDelete) hooks.onDelete(threadId);
                });
                row.querySelector(".agt-thread-acts").appendChild(back);
                row.querySelector(".agt-thread-acts").appendChild(del);
            }
            paintArch();
        },
        unarchive: function (threadId) {
            const row = items.get(threadId);
            const item = threads.find((t) => t.threadId === threadId);
            if (!row || !item) return;
            row.classList.remove("is-archived");
            container.insertBefore(row, archBox);
            const acts = row.querySelector(".agt-thread-acts");
            acts.innerHTML = "";
            const archive = document.createElement("button");
            archive.type = "button";
            archive.className = "agt-thread-act";
            archive.textContent = "归档";
            archive.addEventListener("click", function () {
                if (hooks && hooks.onArchive) hooks.onArchive(threadId);
            });
            const del = document.createElement("button");
            del.type = "button";
            del.className = "agt-thread-act is-danger";
            del.textContent = "删除";
            del.addEventListener("click", function () {
                if (hooks && hooks.onDelete) hooks.onDelete(threadId);
            });
            acts.appendChild(archive);
            acts.appendChild(del);
            paintArch();
        }
    });

    archHead.addEventListener("click", function () {
        archBox.classList.toggle("is-open");
    });

    const adapter = new ThreadListAdapter({
        list: function () {
            return threads.slice();
        },
        new: function (group) {
            const item = {
                threadId: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                title: titleOf(group),
                createdAt: Date.now(),
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
            return true;
        }
    });

    paintArch();

    return { adapter: adapter, runtime: runtime, messageHistory: messageHistory, threads: threads };
}
