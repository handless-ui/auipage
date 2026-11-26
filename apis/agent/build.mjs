// 把 apis/agent/src 打成浏览器可加载的一份 ESM：docs/assets/agent/app.js
// 四个 @auipage 包与 oipage 的 initOption 都会被内联，页面侧不新增任何依赖。
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const INPUT = path.join(HERE, "src/index.js");
const OUT = path.join(ROOT, "docs/assets/agent/app.js");

const bundle = await rollup({
    input: INPUT,
    plugins: [nodeResolve({ browser: true, preferBuiltins: false })],
    onwarn(warning, warn) {
        if (warning.code === "CIRCULAR_DEPENDENCY") return;
        warn(warning);
    }
});

const { output } = await bundle.generate({ format: "esm", generatedCode: "es2015" });
await bundle.close();

let code = "";
for (const item of output) {
    if (item.type === "chunk") code += item.code;
}

// 兜底：产物里不允许出现任何未解析的裸模块名
const bare = code.match(/from\s*["']([^"./][^"']*)["']/g);
if (bare) throw new Error("打包后仍有外部依赖：" + bare.join(", "));

fs.writeFileSync(OUT, "/* 由 apis/agent/build.mjs 生成，勿手改 */\n" + code);
const kb = (Buffer.byteLength(code) / 1024).toFixed(1);
console.log("已生成 " + path.relative(ROOT, OUT) + "（" + kb + " KB）");
