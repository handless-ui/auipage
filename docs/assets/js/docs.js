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
        if (window.innerWidth > 1080) close();
    });
})();

/* 首页标记：用于 PC 单栏大气版与移动端抽屉的差异化布局 */
(function () {
    var path = location.pathname;
    if (/\/docs\/(index\.html)?$/.test(path)) {
        document.body.classList.add("home");
    }
}());
