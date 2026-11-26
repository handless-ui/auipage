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
        if (window.innerWidth > 850) close();
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
        // 代码块头可能带行号后缀（路径:12），取扩展名之前先剥掉
        name = name.replace(/:\d+(?::\d+)?$/, "");
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

/* ------------------------------------------------------------ 页内目录：滚动高亮与跳转 */

(function () {
    "use strict";

    var links = [].slice.call(document.querySelectorAll("[data-toc]"));
    var secs = [].slice.call(document.querySelectorAll("section[id]"));
    if (!links.length || !secs.length) return;

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var OFFSET = 96;
    var current = "";

    function setActive(id) {
        if (!id || id === current) return;
        current = id;
        for (var i = 0; i < links.length; i++) {
            var on = links[i].getAttribute("data-toc") === id;
            if (on) links[i].setAttribute("aria-current", "true");
            else links[i].removeAttribute("aria-current");
        }
        var row = document.querySelector(".toc-chips-row");
        var chip = row && row.querySelector('[aria-current="true"]');
        if (row && chip) {
            var left = chip.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
            var target = left - (row.clientWidth - chip.offsetWidth) / 2;
            if (target < row.scrollLeft || target + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
                row.scrollLeft = Math.max(0, target);
            }
        }
    }

    function scan() {
        var best = secs[0].id;
        for (var i = 0; i < secs.length; i++) {
            if (secs[i].getBoundingClientRect().top - OFFSET <= 0) best = secs[i].id;
            else break;
        }
        // 滚到底时，最后一个章节可能永远进不了判定线，兜底指向末节
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
            best = secs[secs.length - 1].id;
        }
        setActive(best);
    }

    var ticking = false;
    function onScroll() {
        if (ticking) return;
        ticking = true;
        // 用定时器节流而不是 rAF：切到后台标签页时 rAF 会停，高亮会卡在旧章节
        setTimeout(function () {
            ticking = false;
            scan();
        }, 16);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("load", scan);
    // 代码块着色会改变章节位置，等它画完再校准一次
    setTimeout(scan, 400);
    scan();

    document.addEventListener("click", function (e) {
        var a = e.target.closest ? e.target.closest("[data-toc]") : null;
        if (!a) return;

        var id = a.getAttribute("data-toc");
        var el = document.getElementById(id);
        if (!el) return;

        e.preventDefault();
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        if (history.replaceState) history.replaceState(null, "", "#" + id);
        setActive(id);

        // 抽屉里的目录点完顺手收起抽屉
        var inDrawer = a.closest(".drawer");
        var closer = inDrawer && inDrawer.querySelector('[data-drawer="close"]');
        if (closer) closer.click();
    });
}());

/* ------------------------------------------------------------ 目录自动滚动到选中项 */
/*
   左栏与右栏都是自己的滚动容器，页面滚动不会带着它们走。
   所以“当前页 / 当前章节”如果落在容器可视区之外，必须主动把它挪进来，
   否则打开第 24 篇时左栏还停在第 8 篇。
*/
(function () {
    "use strict";

    var PAD = 14;

    // center=true：把目标放到容器正中；false：最少位移（已在可视区就不动）
    function reveal(box, target, center) {
        if (!box || !target) return;
        if (!box.clientHeight) return;                      // 抽屉里那份是隐藏的，跳过
        if (box.scrollHeight - box.clientHeight <= 2) return; // 本来就不用滚

        var b = box.getBoundingClientRect();
        var t = target.getBoundingClientRect();
        if (!t.height) return;

        if (center) {
            // 两端会被浏览器自动夹到 [0, max]，所以首尾项自然贴边，不会留白
            box.scrollTop = box.scrollTop + (t.top - b.top) - (b.height - t.height) / 2;
            return;
        }

        // 已经在可视区（留出上下 PAD）就不动，避免无谓跳动
        if (t.top >= b.top + PAD && t.bottom <= b.bottom - PAD) return;

        var delta;
        if (t.height > b.height - PAD * 2) {
            delta = t.top - b.top - PAD;                    // 单项比可视区还高，对齐顶部
        } else if (t.top < b.top + PAD) {
            delta = t.top - b.top - PAD;
        } else {
            delta = t.bottom - b.bottom + PAD;
        }
        box.scrollTop = Math.max(0, box.scrollTop + delta);
    }

    // 桌面是 .tree 自己滚；手机抽屉是外层 .drawer-tree 滚，所以往上找真正的滚动容器
    function scrollerOf(el) {
        var node = el.parentElement;
        while (node && node !== document.body) {
            var oy = getComputedStyle(node).overflowY;
            if ((oy === "auto" || oy === "scroll") &&
                node.clientHeight > 0 &&
                node.scrollHeight - node.clientHeight > 2) return node;
            node = node.parentElement;
        }
        return null;
    }

    function revealLeft(center) {
        var trees = document.querySelectorAll(".tree");
        for (var i = 0; i < trees.length; i++) {
            var tree = trees[i];
            var active = tree.querySelector("a.on") || tree.querySelector('[aria-current="true"]');
            if (!active) continue;
            reveal(scrollerOf(active), active, center);
        }
    }

    function revealRight(center) {
        var rail = document.querySelector(".toc-rail");
        if (!rail) return;
        reveal(rail, rail.querySelector('[aria-current="true"]'), center);
    }

    function revealAll() {
        revealLeft(true);
        revealRight(true);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", revealAll);
    } else {
        revealAll();
    }
    window.addEventListener("load", revealAll);

    // 着色 / 字体替换会改变条目高度，画完再校准一次
    setTimeout(revealAll, 400);

    var timer = 0;
    window.addEventListener("resize", function () {
        clearTimeout(timer);
        timer = setTimeout(revealAll, 120);
    });

    // 手机抽屉很晚才出现（display 由 hidden 切换），展开后补一次
    var drawer = document.getElementById("drawer");
    if (drawer && window.MutationObserver) {
        new MutationObserver(function () {
            if (drawer.classList.contains("open")) setTimeout(function () { revealLeft(true); }, 280);
        }).observe(drawer, { attributes: true, attributeFilter: ["class"] });
    }

    // 点右侧目录：跳转后把那一条摆到正中
    document.addEventListener("click", function (e) {
        var a = e.target.closest ? e.target.closest("[data-toc]") : null;
        if (!a) return;
        setTimeout(function () { revealRight(true); }, 80);
    });

    // 右栏跟着当前章节走：只在选中项跑出可视区时才动，不打断阅读
    var rail = document.querySelector(".toc-rail");
    if (rail && window.MutationObserver) {
        new MutationObserver(function () { revealRight(false); }).observe(rail, {
            subtree: true,
            attributes: true,
            attributeFilter: ["aria-current"]
        });
    }
}());
