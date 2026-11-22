/* 文档交互：代码复制 */
(function () {
    "use strict";

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) { }
        document.body.removeChild(ta);
        return Promise.resolve();
    }

    document.addEventListener("click", function (event) {
        var btn = event.target.closest("[data-copy]");
        if (!btn) return;

        var text = btn.getAttribute("data-copy");
        if (!text) {
            var scope = btn.closest(".install, .code");
            var codeEl = scope && scope.querySelector("code, pre");
            text = codeEl ? codeEl.innerText : "";
        }

        copyText(text).then(function () {
            var label = btn.textContent;
            btn.textContent = "已复制";
            setTimeout(function () { btn.textContent = label; }, 1200);
        });
    });
})();

/* ------------------------------------------------------------ 明 / 暗 / 跟随系统 */

/* ------------------------------------------------------------ 手机抽屉 */

(function () {
    var drawer = document.getElementById("drawer");
    var scrim = document.querySelector(".scrim");
    var burger = document.querySelector(".m-burger");
    if (!drawer) return;

    function open() {
        drawer.hidden = false;
        if (scrim) scrim.hidden = false;
        requestAnimationFrame(function () {
            drawer.classList.add("open");
            document.body.classList.add("drawer-open");
        });
        drawer.setAttribute("aria-hidden", "false");
        if (burger) burger.setAttribute("aria-expanded", "true");
    }

    function close() {
        drawer.classList.remove("open");
        document.body.classList.remove("drawer-open");
        drawer.setAttribute("aria-hidden", "true");
        if (burger) burger.setAttribute("aria-expanded", "false");
        setTimeout(function () {
            if (!drawer.classList.contains("open")) {
                drawer.hidden = true;
                if (scrim) scrim.hidden = true;
            }
        }, 260);
    }

    document.addEventListener("click", function (e) {
        var t = e.target.closest ? e.target.closest("[data-drawer]") : null;
        if (!t) return;
        if (t.getAttribute("data-drawer") === "open") open();
        else close();
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") close();
    });

    window.addEventListener("resize", function () {
        if (window.innerWidth > 640) close();
    });
})();

/* 首页标记：用于 PC 单栏大气版与移动端抽屉的差异化布局 */
(function () {
    var path = location.pathname;
    if (/\/docs\/(index\.html)?$/.test(path)) {
        document.body.classList.add("home");
    }
}());

/* ------------------------------------------------------------ 代码着色（@oipage/shader） */

(function () {
    var Shader = window.Shader;
    if (!Shader) return;

    /* 浅底代码面板：深色文字保住对比度，蓝绿紫只落在关键字、字符串与函数名上 */
    var LIGHT = {
        text: "#1c2740", annotation: "#78869c", insign: "#5f6f86",
        key: "#0b5ed7", string: "#087a52", funName: "#155fc4", execName: "#0f766e",
        node: "#155fc4", attrKey: "#9a5b00", attrValue: "#087a52", selector: "#155fc4",
        number: "#b45309", keyword: "#7135d6", command: "#155fc4", option: "#9a5b00",
        argument: "#087a52", variable: "#a21caf"
    };

    var BY_EXT = {
        js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
        ts: "javascript", tsx: "javascript", vue: "html", svelte: "html",
        html: "html", htm: "html", css: "css", json: "json",
        py: "python", sh: "shell", bash: "shell"
    };

    var BY_NAME = { terminal: "shell", shell: "shell", bash: "shell", sse: "json" };

    function pickLang(name) {
        if (!name) return "";
        var base = name.split("/").pop().toLowerCase();
        if (BY_NAME[base]) return BY_NAME[base];
        var dot = base.lastIndexOf(".");
        if (dot < 0) return "";
        return BY_EXT[base.slice(dot + 1)] || "";
    }

    var blocks = document.querySelectorAll(".code .code-body pre");
    if (!blocks.length) return;

    for (var i = 0; i < blocks.length; i++) {
        var pre = blocks[i];
        var box = pre.closest(".code");
        var label = box && box.querySelector(".code-head .file");
        var lang = pickLang(label ? label.textContent.trim() : "");
        if (!lang) continue;

        // 原始源码只留纯文本，重复着色时从这里恢复
        pre._code = pre.textContent;
        pre.setAttribute("tag", lang);
    }

    function paint() {
        var root = document.querySelector("main") || document.body;
        for (var j = 0; j < blocks.length; j++) {
            if (blocks[j]._code !== undefined) blocks[j].textContent = blocks[j]._code;
        }
        Shader.shader(root, { colors: LIGHT });
    }

    paint();
}());
