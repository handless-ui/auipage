// 设置页：模型服务的增删改、测试连接、切换当前使用（数据落在 localStorage）
import { probe } from "./probe.js";

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function field(labelText, input) {
    const wrap = el("label", "agt-field");
    wrap.appendChild(el("span", "", labelText));
    wrap.appendChild(input);
    return wrap;
}

function textInput(type, value, placeholder) {
    const input = el("input", "");
    input.type = type;
    input.value = value == null ? "" : value;
    if (placeholder) input.placeholder = placeholder;
    return input;
}

export function createSettings(options) {
    const state = options.state;
    const onChange = options.onChange || function () {};

    const root = el("section", "agt-settings");

    const head = el("div", "agt-set-head");
    const back = el("button", "agt-set-back");
    back.type = "button";
    back.textContent = "← 返回对话";
    const title = el("h2", "agt-set-title", "模型服务");
    head.appendChild(back);
    head.appendChild(title);
    root.appendChild(head);

    const note = el("div", "agt-set-note");
    note.innerHTML =
        "<p><b>浏览器直连需要跨域（CORS）</b>　这里填的地址是浏览器直接请求的，对方必须允许跨域，" +
        "否则会显示「请求被浏览器拦住」。本机 Ollama 可用 <code>OLLAMA_ORIGINS=* ollama serve</code> 放行；" +
        "临时体验也可以用带 <code>--disable-web-security</code> 的浏览器打开本站（仅调试用）。</p>";
    root.appendChild(note);

    const grid = el("div", "agt-set-grid");
    root.appendChild(grid);

    const editor = el("div", "agt-editor");
    const editorCard = el("div", "agt-editor-card");
    editor.appendChild(editorCard);
    root.appendChild(editor);

    let editingId = null;

    function closeEditor() {
        editor.classList.remove("is-open");
        editingId = null;
    }

    editor.addEventListener("click", function (event) {
        if (event.target === editor) closeEditor();
    });

    function openEditor(provider) {
        editingId = provider ? provider.id : null;
        editorCard.innerHTML = "";

        const heading = el("h3", "", provider ? "编辑模型服务" : "添加模型服务");
        editorCard.appendChild(heading);

        const form = el("div", "agt-editor-form");
        const name = textInput("text", provider ? provider.name : "", "例如 我的 qwen");
        const base = textInput("text", provider ? provider.baseURL : "", "http://localhost:11434/v1");
        const model = textInput("text", provider ? provider.model : "", "qwen3.5");
        const key = textInput("password", provider ? provider.apiKey : "", "本地服务通常留空");
        const temp = textInput("number", provider ? provider.temperature : 0.7, "0.7");
        const maxTokens = textInput("number", provider ? provider.maxTokens : 2048, "2048");
        const timeout = textInput("number", provider ? provider.timeout : 60000, "60000");

        form.appendChild(field("服务名称", name));
        form.appendChild(field("接口地址 baseURL", base));
        form.appendChild(field("模型名", model));
        form.appendChild(field("API Key", key));

        const row = el("div", "agt-editor-row");
        row.appendChild(field("温度", temp));
        row.appendChild(field("maxTokens", maxTokens));
        row.appendChild(field("超时 ms", timeout));
        form.appendChild(row);
        editorCard.appendChild(form);

        const tip = el("p", "agt-editor-tip", "协议固定为 OpenAI 兼容（POST /chat/completions）。");
        editorCard.appendChild(tip);

        const foot = el("div", "agt-editor-foot");
        const cancel = el("button", "agt-btn");
        cancel.type = "button";
        cancel.textContent = "取消";
        const save = el("button", "agt-btn agt-btn-main");
        save.type = "button";
        save.textContent = "保存";
        foot.appendChild(cancel);
        foot.appendChild(save);
        editorCard.appendChild(foot);

        cancel.addEventListener("click", closeEditor);
        save.addEventListener("click", function () {
            const baseValue = base.value.trim();
            if (!/^https?:\/\//.test(baseValue)) {
                tip.textContent = "接口地址需要以 http:// 或 https:// 开头。";
                tip.classList.add("is-bad");
                return;
            }
            if (!model.value.trim()) {
                tip.textContent = "模型名不能为空，例如 qwen3.5。";
                tip.classList.add("is-bad");
                return;
            }

            options.upsert({
                id: editingId,
                name: name.value,
                baseURL: baseValue,
                model: model.value,
                apiKey: key.value,
                temperature: temp.value,
                maxTokens: maxTokens.value,
                timeout: timeout.value
            });
            closeEditor();
            paint();
            onChange();
        });

        editor.classList.add("is-open");
        setTimeout(function () { base.focus(); }, 30);
    }

    function card(provider) {
        const box = el("article", "agt-card");
        const top = el("div", "agt-card-top");
        const name = el("b", "", provider.name);
        top.appendChild(name);
        if (provider.readonly) {
            const badge = el("span", "agt-badge", "内置 · 只读");
            top.appendChild(badge);
        }
        if (provider.id === state.activeId) {
            const badge = el("span", "agt-badge agt-badge-on", "当前使用");
            top.appendChild(badge);
        }
        box.appendChild(top);

        box.appendChild(el("div", "agt-card-line", provider.protocol === "demo"
            ? "不联网 · 预置脚本回答"
            : provider.baseURL));
        box.appendChild(el("div", "agt-card-line is-dim", provider.protocol === "demo"
            ? "演示模型 · auipage-demo"
            : "模型 " + provider.model + (provider.apiKey ? " · 已填密钥" : " · 无密钥")));

        const result = el("p", "agt-card-result");
        box.appendChild(result);

        const actions = el("div", "agt-card-actions");

        const test = el("button", "agt-btn");
        test.type = "button";
        test.textContent = "测试连接";
        test.addEventListener("click", function () {
            test.disabled = true;
            result.className = "agt-card-result";
            result.textContent = "正在请求 " + (provider.protocol === "demo" ? "演示模型" : provider.baseURL) + " …";
            probe(provider, Math.min(provider.timeout || 8000, 10000)).then(function (report) {
                result.className = "agt-card-result is-" + report.level;
                result.textContent = report.message;
                test.disabled = false;
            });
        });
        actions.appendChild(test);

        if (!provider.readonly) {
            const edit = el("button", "agt-btn");
            edit.type = "button";
            edit.textContent = "编辑";
            edit.addEventListener("click", function () { openEditor(provider); });
            actions.appendChild(edit);
        }

        if (provider.id !== state.activeId) {
            const use = el("button", "agt-btn");
            use.type = "button";
            use.textContent = "设为当前";
            use.addEventListener("click", function () {
                options.activate(provider.id);
                paint();
                onChange();
            });
            actions.appendChild(use);
        }

        if (!provider.readonly) {
            const del = el("button", "agt-btn is-danger");
            del.type = "button";
            del.textContent = "删除";
            del.addEventListener("click", function () {
                options.remove(provider.id);
                paint();
                onChange();
            });
            actions.appendChild(del);
        }

        box.appendChild(actions);
        return box;
    }

    function paint() {
        grid.innerHTML = "";
        (state.list || []).forEach(function (provider) {
            grid.appendChild(card(provider));
        });

        const add = el("button", "agt-card agt-card-add");
        add.type = "button";
        add.appendChild(el("span", "", "＋ 添加模型服务"));
        add.appendChild(el("small", "", "填一个允许跨域的 OpenAI 兼容地址"));
        add.addEventListener("click", function () { openEditor(null); });
        grid.appendChild(add);
    }

    back.addEventListener("click", function () {
        root.classList.remove("is-open");
        options.onBack && options.onBack();
    });

    paint();

    return {
        root: root,
        open: function () {
            paint();
            root.classList.add("is-open");
        },
        close: function () {
            root.classList.remove("is-open");
        }
    };
}
