// 面板装配：AuiPage + 四个适配器 + 输入区 + 模型切换
import { AuiPage } from "@auipage/core";
import { TOOLS } from "./tools.js";
import { createChatView } from "./views/chat.js";
import { createThreads } from "./views/thread.js";
import { createTransport } from "./transport.js";
import { createModel, describeProvider } from "./models.js";
import { loadProviders, activeProvider, setActive, isDemo, upsertProvider, removeProvider } from "./providers.js";
import { createSettings } from "./settings.js";

let instance = null;

function html(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function buildPanel() {
    const mask = html("div", "agt-mask");
    const panel = html("div", "agt-panel");

    const side = html("aside", "agt-side");
    const brand = html("div", "agt-brand");
    const logo = html("div", "agt-brand-logo");
    const logoUrl = window.__AGH_LOGO__ || "";
    if (logoUrl) {
        const mark = document.createElement("img");
        mark.src = logoUrl;
        mark.alt = "";
        mark.onerror = function () { mark.remove(); logo.textContent = "A"; };
        logo.appendChild(mark);
    } else {
        logo.textContent = "A";
    }
    brand.appendChild(logo);
    const brandText = html("div", "agt-brand-text");
    brandText.appendChild(html("b", "", "auipage 助手"));
    brandText.appendChild(html("span", "", "文档站内智能体"));
    brand.appendChild(brandText);
    side.appendChild(brand);

    const newBtn = html("button", "agt-new");
    newBtn.type = "button";
    newBtn.textContent = "+ 新对话";
    side.appendChild(newBtn);

    const threadList = html("div", "agt-threads");
    side.appendChild(threadList);

    const sideFoot = html("div", "agt-side-foot");
    sideFoot.textContent = "会话存在本机浏览器，可归档或删除";
    side.appendChild(sideFoot);
    panel.appendChild(side);

    const main = html("main", "agt-main");
    const head = html("header", "agt-head");
    const sideToggle = html("button", "agt-sidetoggle", "☰");
    sideToggle.type = "button";
    sideToggle.setAttribute("aria-label", "会话列表");
    head.appendChild(sideToggle);
    const title = html("div", "agt-title", "新对话");
    head.appendChild(title);

    const actions = html("div", "agt-actions");
    const setBtn = html("button", "agt-setbtn", "设置");
    setBtn.type = "button";
    const modelSelect = html("select", "agt-model");
    const closeBtn = html("button", "agt-close");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "×";
    actions.appendChild(setBtn);
    actions.appendChild(modelSelect);
    actions.appendChild(closeBtn);
    head.appendChild(actions);
    main.appendChild(head);
    panel.appendChild(main);

    // 手机上面板全屏，会话列表收成抽屉
    const scrim = html("div", "agt-scrim");
    panel.appendChild(scrim);
    function drawer(open) {
        side.classList.toggle("is-open", !!open);
        scrim.classList.toggle("is-on", !!open);
    }
    sideToggle.addEventListener("click", function () { drawer(!side.classList.contains("is-open")); });
    scrim.addEventListener("click", function () { drawer(false); });

    const notice = html("div", "agt-notice");
    const noticeText = html("span", "agt-notice-text");
    const noticeClose = html("button", "agt-notice-close");
    noticeClose.type = "button";
    noticeClose.textContent = "知道了";
    notice.appendChild(noticeText);
    notice.appendChild(noticeClose);
    main.appendChild(notice);

    const cors = html("div", "agt-cors");
    cors.innerHTML = "<b>需要跨域</b><span>浏览器直连该地址，服务端必须允许 CORS；本机 Ollama 可用 <code>OLLAMA_ORIGINS=*</code> 启动，或使用带 <code>--disable-web-security</code> 的浏览器临时访问。</span>";
    main.appendChild(cors);

    const chatBox = html("div", "agt-chat");
    const chatInner = html("div", "agt-chat-inner");
    chatBox.appendChild(chatInner);
    main.appendChild(chatBox);

    const compose = html("div", "agt-compose");
    const input = html("textarea", "agt-input");
    input.rows = 1;
    input.placeholder = "问点什么，比如「auipage 是什么」";
    compose.appendChild(input);

    const bar = html("div", "agt-compose-bar");
    const hint = html("span", "agt-hint", "Enter 发送 · Shift+Enter 换行");
    const sendBtn = html("button", "agt-send");
    sendBtn.type = "button";
    sendBtn.setAttribute("aria-label", "发送");
    sendBtn.textContent = "↑";
    const stopBtn = html("button", "agt-stop");
    stopBtn.type = "button";
    stopBtn.textContent = "停止";
    bar.appendChild(hint);
    bar.appendChild(stopBtn);
    bar.appendChild(sendBtn);
    compose.appendChild(bar);
    main.appendChild(compose);

    const status = html("footer", "agt-status");
    main.appendChild(status);

    mask.appendChild(panel);
    return {
        mask: mask,
        panel: panel,
        title: title,
        modelSelect: modelSelect,
        closeBtn: closeBtn,
        notice: notice,
        noticeText: noticeText,
        noticeClose: noticeClose,
        chatBox: chatInner,
        input: input,
        sendBtn: sendBtn,
        stopBtn: stopBtn,
        status: status,
        threadList: threadList,
        newBtn: newBtn,
        setBtn: setBtn,
        cors: cors,
        main: main
    };
}

function boot() {
    const ui = buildPanel();
    const state = loadProviders();

    let busy = false;

    ui.mask.addEventListener("click", function (event) {
        if (event.target === ui.mask) api.close();
    });
    ui.closeBtn.addEventListener("click", function () { api.close(); });

    const chatScope = { isDemo: function () { return isDemo(activeProvider(state)); } };
    const chat = createChatView(ui.chatBox, chatScope);
    chatScope.onAsk = function (text) {
        ui.input.value = text;
        submit();
    };
    chatScope.onFill = function (text) {
        ui.input.value = text;
        ui.input.focus();
        ui.input.setSelectionRange(text.length, text.length);
    };

    const threads = createThreads(ui.threadList, {
        onSelect: function (threadId) {
            if (busy) return;
            page.activeThread(threadId);
            drawer(false);
        },
        onTitle: function (text) {
            ui.title.textContent = text || "新对话";
        },
        onDelete: function (threadId) { page.deleteThread(threadId); },
        onArchive: function (threadId) { page.archiveThread(threadId); },
        onUnarchive: function (threadId) { page.unarchiveThread(threadId); }
    });

    const transport = createTransport({
        getProvider: function () { return activeProvider(state); },
        tools: TOOLS,
        createModel: createModel
    });

    const page = new AuiPage({
        adapter: {
            ChatTransport: transport,
            ThreadList: threads.adapter,
            MessageHistory: threads.messageHistory
        },
        runtime: {
            ThreadList: threads.runtime,
            ChatContent: chat.runtime
        },
        tools: TOOLS
    });

    const settings = createSettings({
        state: state,
        upsert: function (input) {
            upsertProvider(state, input);
            if (!state.list.some((item) => item.id === state.activeId)) setActive(state, "demo");
        },
        remove: function (id) { removeProvider(state, id); },
        activate: function (id) { setActive(state, id); },
        onChange: function () { paintProviders(); refreshStatus(); },
        onBack: function () { ui.input.focus(); }
    });
    ui.panel.appendChild(settings.root);

    function refreshStatus() {
        const provider = activeProvider(state);
        const demo = isDemo(provider);
        ui.status.textContent = (demo ? "● 演示模式 · 不联网" : "● " + describeProvider(provider)) + " · 数据只在本机浏览器";
        ui.status.classList.toggle("is-demo", demo);

        ui.notice.classList.toggle("is-on", demo);
        ui.cors.classList.toggle("is-on", !demo);
        if (demo) {
            ui.noticeText.textContent = "当前是本地演示模型：回答来自预置脚本，用于体验交互与工具流程；配置自己的模型后即为真实对话。";
        }
    }

    function paintProviders() {
        ui.modelSelect.innerHTML = "";
        state.list.forEach(function (provider) {
            const option = document.createElement("option");
            option.value = provider.id;
            option.textContent = provider.protocol === "demo" ? provider.name : provider.model;
            option.selected = provider.id === state.activeId;
            ui.modelSelect.appendChild(option);
        });
    }

    ui.setBtn.addEventListener("click", function () {
        ui.settingsOpen = true;
        settings.open();
    });

    ui.status.addEventListener("click", function () {
        settings.open();
    });

    ui.modelSelect.addEventListener("change", function () {
        if (busy) {
            paintProviders();
            return;
        }
        setActive(state, ui.modelSelect.value);
        paintProviders();
        refreshStatus();
    });

    function setBusy(value) {
        busy = value;
        ui.stopBtn.classList.toggle("is-on", value);
        ui.sendBtn.classList.toggle("is-off", value);
        ui.input.setAttribute("aria-busy", value ? "true" : "false");
    }

    function autoGrow() {
        ui.input.style.height = "auto";
        ui.input.style.height = Math.min(150, ui.input.scrollHeight) + "px";
    }

    ui.input.addEventListener("input", autoGrow);
    ui.input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit();
        }
    });

    ui.sendBtn.addEventListener("click", submit);
    ui.stopBtn.addEventListener("click", function () {
        page.stop();
    });
    ui.newBtn.addEventListener("click", function () {
        if (busy) return;
        page.newThread();
        drawer(false);
    });
    ui.noticeClose.addEventListener("click", function () {
        ui.notice.classList.remove("is-on");
    });

    function sendText(text) {
        text = String(text || "").trim();
        if (busy || !text) return;

        setBusy(true);

        page.sendMessage({
            role: "user",
            content: [{ type: "text", text: text }]
        }).then(function () {
            setBusy(false);
        }, function (error) {
            setBusy(false);
            const reason = typeof error === "string" ? error : ((error && error.message) || "发送失败");
            chat.runtime.append("assistant", { type: "text", text: "⚠ " + reason });
            chat.runtime.append("assistant", { type: "text", text: "如果是「Failed to fetch / 请求被拦住」，点右上角「设置 → 测试连接」看诊断结论。" });
        });
    }

    function submit() {
        if (busy) return;
        const text = (ui.input.value || "").trim();
        if (!text) return;

        ui.input.value = "";
        autoGrow();
        sendText(text);
    }

    page.on("task:end", function (payload) {
        setBusy(false);
        if (payload && payload.status === "cancelled") {
            chat.runtime.append("assistant", { type: "text", text: "_（本轮已取消）_" });
        } else if (payload && payload.status === "stopped") {
            chat.runtime.append("assistant", { type: "text", text: "_（已停止生成）_" });
        }
    });

    document.body.appendChild(ui.mask);

    paintProviders();
    refreshStatus();

    const api = {
        page: page,
        send: sendText,
        show: function () {
            ui.mask.classList.add("is-open");
            setTimeout(function () { ui.input.focus(); }, 60);
        },
        close: function () {
            if (busy) page.cancel();
            ui.mask.classList.remove("is-open");
        },
        state: state
    };

    window.__auipageAgent = api;
    return api;
}

export function open() {
    if (!instance) instance = boot();
    instance.show();
    return instance;
}

export function close() {
    if (instance) instance.close();
}
