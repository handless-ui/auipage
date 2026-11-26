/* auipage 文档站的智能体外壳（boot）：只做四件事 —— 悬浮球、拖拽、遮罩、按需加载。
   业务代码一行都不在这里，点击后才从 assets/agent/app.js 拉下来注入。 */
(function () {
    "use strict";

    var script = document.currentScript;
    var src = (script && script.src) || "";
    if (!src) return;

    var query = (src.match(/\?[^#]*/) || [""])[0];
    var base = src.replace(/assets\/agent\/boot\.js(\?[^#]*)?(#.*)?$/, "");
    var root = base + "assets/agent/";
    var SUFFIX = query ? query : "";
    window.__AGH_LOGO__ = base + "assets/img/logo.png";

    var POS_KEY = "auipage.docs.agent.v1.pos";
    var HINT_KEY = "auipage.docs.agent.v1.hint";

    var loaded = false;
    var loading = false;
    var appMod = null;
    var controller = null;

    var style = document.createElement("style");
    style.textContent = [
        ".agh-wrap{position:fixed;z-index:50;display:flex;flex-direction:column;align-items:center;gap:6px;",
        "  user-select:none;-webkit-user-select:none;touch-action:none;cursor:grab;}",
        ".agh-wrap.agh-drag{cursor:grabbing;}",
        ".agh-wrap:focus-visible{outline:2px solid #2b59ff;outline-offset:4px;border-radius:30px;}",
        ".agh-tip{font:500 11px/1.4 var(--sans,-apple-system,\"PingFang SC\",sans-serif);letter-spacing:.4px;color:#7b899f;",
        "  background:rgba(255,255,255,.72);border:1px solid #e2e8f2;border-radius:999px;padding:2px 8px;",
        "  transition:color .2s,border-color .2s,opacity .2s;opacity:.86;white-space:nowrap;}",
        ".agh-wrap:hover .agh-tip,.agh-wrap.agh-hint .agh-tip{color:#2b59ff;border-color:#b9c8ff;opacity:1;}",
        ".agh-ball{width:54px;height:54px;border-radius:50%;background:transparent;border:0;",
        "  display:flex;align-items:center;justify-content:center;overflow:visible;",
        "  transition:transform .18s ease,filter .18s ease;filter:drop-shadow(0 10px 18px rgba(29,52,110,.18));}",
        ".agh-ball img{width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;}",
        ".agh-ball b{font:700 16px/1 \"PingFang SC\",sans-serif;color:#2b59ff;width:46px;height:46px;border-radius:50%;",
        "  background:#fff;border:1px solid #dbe3f2;display:flex;align-items:center;justify-content:center;}",
        ".agh-wrap:hover .agh-ball{transform:translateY(-3px) scale(1.03);filter:drop-shadow(0 14px 26px rgba(29,52,110,.24));}",
        ".agh-wrap.agh-pulse .agh-ball{animation:agh-pulse 1.6s ease-in-out 3;}",
        "@keyframes agh-pulse{0%,100%{transform:none;}30%{transform:translateY(-5px) rotate(-5deg);}60%{transform:translateY(0) rotate(4deg);}}",
        ".agh-wrap.agh-nudge .agh-ball{animation:agh-nudge 1.2s cubic-bezier(.36,.07,.19,.97);}",
        "@keyframes agh-nudge{0%,100%{transform:none;}20%{transform:translateY(-4px) rotate(-6deg);}45%{transform:translateY(1px) rotate(5deg);}70%{transform:translateY(-2px) rotate(-2deg);}}",
        ".agh-mask{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;",
        "  background:rgba(244,247,252,.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}",
        ".agh-mask.agh-on{display:flex;}",
        ".agh-card{width:min(420px,86vw);background:#fff;border:1px solid #e2e8f2;border-radius:16px;",
        "  box-shadow:0 24px 60px rgba(16,32,66,.16);padding:26px 26px 20px;text-align:center;}",
        ".agh-spin{width:34px;height:34px;margin:0 auto 16px;border-radius:50%;",
        "  border:3px solid #e6ecf7;border-top-color:#2b59ff;animation:agh-spin .9s linear infinite;}",
        "@keyframes agh-spin{to{transform:rotate(360deg);}}",
        ".agh-title{font:700 15px/1.5 \"PingFang SC\",sans-serif;color:#0b1322;}",
        ".agh-desc{font:400 12px/1.7 var(--sans,-apple-system,sans-serif);color:#7b899f;margin-top:8px;}",
        ".agh-bar{height:4px;border-radius:4px;background:#eef2f8;overflow:hidden;margin:18px 0 0;}",
        ".agh-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2b59ff,#6f8dff);transition:width .25s;}",
        ".agh-btn{margin-top:18px;border:1px solid #c9d4e5;background:#fff;color:#46556b;border-radius:999px;",
        "  font:500 12px/1 \"PingFang SC\",sans-serif;padding:9px 20px;cursor:pointer;}",
        ".agh-btn:hover{border-color:#2b59ff;color:#2b59ff;}",
        "@media (prefers-reduced-motion:reduce){.agh-spin{animation:none}.agh-wrap.agh-pulse .agh-ball{animation:none}.agh-wrap.agh-nudge .agh-ball{animation:none}}",
        "@media (max-width:640px){.agh-wrap{transform:scale(.94);transform-origin:100% 100%;}}"
    ].join("\n");
    document.head.appendChild(style);

    /* ---------------------------------------------------------- 悬浮球 */

    var wrap = document.createElement("div");
    wrap.className = "agh-wrap";
    wrap.setAttribute("role", "button");
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("aria-label", "打开智能体对话");

    var tip = document.createElement("div");
    tip.className = "agh-tip";
    tip.textContent = "点击我，快速试一下";

    var ball = document.createElement("div");
    ball.className = "agh-ball";
    var img = document.createElement("img");
    img.src = base + "assets/img/logo.png";
    img.alt = "";
    img.onerror = function () {
        img.remove();
        var mark = document.createElement("b");
        mark.textContent = "A";
        ball.appendChild(mark);
    };
    ball.appendChild(img);

    wrap.appendChild(tip);
    wrap.appendChild(ball);

    function viewport() {
        return {
            w: document.documentElement.clientWidth,
            h: document.documentElement.clientHeight
        };
    }

    function clamp(left, top) {
        var v = viewport();
        var w = wrap.offsetWidth || 54;
        var h = wrap.offsetHeight || 78;
        return {
            x: Math.max(8, Math.min(v.w - w - 8, left)),
            y: Math.max(8, Math.min(v.h - h - 8, top))
        };
    }

    function applyPos(pos) {
        wrap.style.left = pos.x + "px";
        wrap.style.top = pos.y + "px";
    }

    function defaultPos() {
        var v = viewport();
        var w = wrap.offsetWidth || 54;
        var h = wrap.offsetHeight || 78;
        return clamp(v.w - w - 24, v.h - h - 24);
    }

    var saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    } catch (e) { saved = null; }
    applyPos(saved && typeof saved.x === "number" ? clamp(saved.x, saved.y) : defaultPos());

    var dragging = false;
    var moved = false;
    var start = null;

    wrap.addEventListener("pointerdown", function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        dragging = true;
        moved = false;
        start = { x: event.clientX, y: event.clientY, left: parseInt(wrap.style.left, 10), top: parseInt(wrap.style.top, 10) };
        wrap.classList.add("agh-drag");
        try { wrap.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    });

    wrap.addEventListener("pointermove", function (event) {
        if (!dragging) return;
        var dx = event.clientX - start.x;
        var dy = event.clientY - start.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (!moved) return;
        var pos = clamp(start.left + dx, start.top + dy);
        applyPos(pos);
    });

    function endDrag(event) {
        if (!dragging) return;
        dragging = false;
        wrap.classList.remove("agh-drag");
        if (moved) {
            try {
                localStorage.setItem(POS_KEY, JSON.stringify({
                    x: parseInt(wrap.style.left, 10),
                    y: parseInt(wrap.style.top, 10)
                }));
            } catch (e) { /* ignore */ }
            return;
        }
        trigger();
    }

    wrap.addEventListener("pointerup", endDrag);
    wrap.addEventListener("pointercancel", function () {
        dragging = false;
        wrap.classList.remove("agh-drag");
    });
    wrap.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            trigger();
        }
    });

    window.addEventListener("resize", function () {
        applyPos(clamp(parseInt(wrap.style.left, 10), parseInt(wrap.style.top, 10)));
    });

    try {
        if (!localStorage.getItem(HINT_KEY)) {
            wrap.classList.add("agh-pulse");
            localStorage.setItem(HINT_KEY, "1");
            setTimeout(function () { wrap.classList.remove("agh-pulse"); }, 10000);
        }
    } catch (e) { /* ignore */ }

    /* ---------------------------------------------------------- 遮罩 */

    var mask = document.createElement("div");
    mask.className = "agh-mask";
    var card = document.createElement("div");
    card.className = "agh-card";
    var spin = document.createElement("div");
    spin.className = "agh-spin";
    var title = document.createElement("div");
    title.className = "agh-title";
    title.textContent = "系统加载中，请耐心等待";
    var desc = document.createElement("div");
    desc.className = "agh-desc";
    desc.textContent = "正在下载智能体运行代码（仅首次需要）";
    var bar = document.createElement("div");
    bar.className = "agh-bar";
    var fill = document.createElement("i");
    bar.appendChild(fill);
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "agh-btn";
    cancel.textContent = "取消加载";

    card.appendChild(spin);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(bar);
    card.appendChild(cancel);
    mask.appendChild(card);

    function showMask() { mask.classList.add("agh-on"); }
    function hideMask() { mask.classList.remove("agh-on"); }
    function resetMask() {
        spin.style.display = "";
        title.textContent = "系统加载中，请耐心等待";
        desc.textContent = "正在下载智能体运行代码（仅首次需要）";
        bar.style.display = "";
        fill.style.width = "0%";
        cancel.textContent = "取消加载";
        cancel.onclick = abortLoad;
    }

    var appLoaded = false;

    function abortLoad() {
        if (controller) {
            try { controller.abort(); } catch (e) { /* ignore */ }
            controller = null;
        }
        loading = false;
        appLoaded = false;
        appMod = null;
        hideMask();
        resetMask();
    }

    cancel.onclick = abortLoad;

    function readText(url, signal, onProgress) {
        return fetch(url, { signal: signal, cache: "force-cache" }).then(function (res) {
            if (!res.ok) throw new Error("加载失败：HTTP " + res.status + "（" + url.split("/").pop() + "）");
            var total = Number(res.headers.get("Content-Length") || 0);
            if (!res.body || !onProgress || !total) {
                return res.text().then(function (text) {
                    if (onProgress) onProgress(1);
                    return text;
                });
            }
            var reader = res.body.getReader();
            var chunks = [];
            var received = 0;
            var decoder = new TextDecoder();
            var parts = [];

            function pump() {
                return reader.read().then(function (step) {
                    if (step.done) {
                        return parts.join("");
                    }
                    received += step.value.byteLength;
                    parts.push(decoder.decode(step.value, { stream: true }));
                    onProgress(Math.min(1, received / total));
                    return pump();
                });
            }
            return pump();
        });
    }

    function fail(message) {
        loading = false;
        appLoaded = false;
        appMod = null;
        spin.style.display = "none";
        bar.style.display = "none";
        title.textContent = "加载失败";
        desc.textContent = message;
        cancel.textContent = "关闭";
        cancel.onclick = function () {
            hideMask();
            resetMask();
        };
    }

    var nudgeTimer = null;
    function scheduleNudge() {
        clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(function () {
            if (!loading && !mask.classList.contains("agh-on") && !dragging) {
                wrap.classList.add("agh-nudge");
                setTimeout(function () { wrap.classList.remove("agh-nudge"); }, 1300);
            }
            scheduleNudge();
        }, 6000 + Math.random() * 5000);
    }
    scheduleNudge();

    function trigger() {
        if (loading) { showMask(); return; }
        if (appLoaded && appMod) {
            appMod.open();
            return;
        }

        loading = true;
        resetMask();
        showMask();

        controller = new AbortController();
        var signal = controller.signal;

        var cssJob = readText(root + "app.css" + SUFFIX, signal, null).then(function (text) {
            var tag = document.createElement("style");
            tag.id = "agh-app-style";
            tag.textContent = text;
            document.head.appendChild(tag);
        });

        var jsJob = readText(root + "app.js" + SUFFIX, signal, function (ratio) {
            fill.style.width = Math.round(ratio * 100) + "%";
        }).then(function (code) {
            var blob = new Blob([code], { type: "text/javascript" });
            var url = URL.createObjectURL(blob);
            return import(url).then(function (mod) {
                URL.revokeObjectURL(url);
                return mod;
            });
        });

        Promise.all([cssJob, jsJob]).then(function (list) {
            if (!loading) return;
            appMod = list[1];
            appLoaded = true;
            loading = false;
            controller = null;
            hideMask();
            resetMask();
            try {
                appMod.open();
            } catch (error) {
                fail((error && error.message) || String(error));
            }
        }).catch(function (error) {
            if (!loading) return;
            if (error && error.name === "AbortError") return;
            fail((error && error.message) || String(error));
        });
    }

    document.body.appendChild(wrap);
    document.body.appendChild(mask);

    // 尺寸要等进了 DOM 才准，重新夹一次，保证整块（含上方文案）都在视口里
    applyPos(saved && typeof saved.x === "number" ? clamp(saved.x, saved.y) : defaultPos());
})();
