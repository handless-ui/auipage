# apis：文档源码

`docs/` 下的 HTML 是生成出来的，**不要直接改**。改这里，然后跑一次生成命令。

## 文档分工

同一个事实只允许有一个权威位置，其他地方只放链接：

| 位置 | 只负责 | 不负责 |
| --- | --- | --- |
| 根 `README.md` | 门户：这是什么、凭什么信、30 秒看到什么、去哪深入 | 参数表、实现细节 |
| `packages/*/README.md` | 子包门户：痛点、最小例子、“不用它可以换成什么” | 完整 API、教程步骤 |
| `apis/` → `docs/`（本站） | 说明书：教程 + API 参考 + 边界条件 | 推销文案 |

事实冲突时，以代码和 `packages/*/types` 里的声明为准。

## 目录

```
apis/
├── site.json            站点常量：站点名、版本号、协议、仓库 / npm 链接、高亮 class 名
├── build.mjs            生成器（只用 Node 内置模块，另会把着色脚本拷进产物）
├── layouts/page.html    页面骨架：head、body 分区、主容器
├── partials/            每页共用的片段
│   ├── topbar.html        顶栏 / 左侧导航栏
│   ├── mobile.html        小屏抽屉（目录直接复用 sidebar）
│   ├── sidebar.html       文档目录树
│   ├── footer.html        页脚
│   └── scripts.html       页面底部脚本（着色库 + 交互）
└── pages/               每个页面只有自己的正文
    guide/start.html                        → docs/guide/start.html        跑起示例
    guide/zero-dep.html                     → docs/guide/zero-dep.html     一个包都不用
    guide/model.html                        → docs/guide/model.html        接真实模型
    guide/tool.html                         → docs/guide/tool.html         让模型做事
    guide/core.html                         → docs/guide/core.html         装框架
    guide/ui.html                           → docs/guide/ui.html           换界面
    index.html                              → docs/index.html              总览
    packages/fetch.html                     → docs/packages/fetch.html
    packages/model.html                     → docs/packages/model.html
    packages/agent.html                     → docs/packages/agent.html
    packages/core.html                      → docs/packages/core.html      核心层概览
    packages/core-auipage.html              → docs/packages/core-auipage.html
    packages/core-ports.html                → docs/packages/core-ports.html
    packages/core-utils.html                → docs/packages/core-utils.html
    read/index.html                          → docs/read/index.html         导读
```

## 教程的固定结构

`guide/` 下每一章都按同一顺序写，保证“可以随时停下”：

1. **场景**：这一章要做出什么，为什么上一章不够；
2. **最小可跑代码**：能直接复制运行，不依赖整条链路；
3. **装包版 / 手写版对照**：装包解决的是哪几件具体的事；
4. **“这一步你完全可以自己做”**：替代方案与什么时候不必用它；
5. **下一步**：只链到下一章。

## 改东西时去哪儿

| 想改的内容 | 改哪个文件 |
| --- | --- |
| 某页正文 | `pages/` 下对应文件 |
| 教程顺序、章节编号 | `partials/sidebar.html`，以及各页的 pager |
| 导航项、分组 | `partials/sidebar.html`（文档树）、`partials/topbar.html`（顶栏）；`mobile.html` 自动复用 sidebar |
| 页脚布局、生态外链 | `partials/footer.html` |
| 站点标题、描述、主题色、favicon | `layouts/page.html` 的 head 部分 |
| 版本号、协议、GitHub 仓库、npm 地址、站点名、高亮 class 名 | `site.json` |
| 页面样式 | `docs/assets/css/docs.css`（`assets/` 是手写的，不参与生成） |
| 代码着色脚本 | `docs/assets/js/docs.js`（着色入口）与 `apis/build.mjs`（拷贝 `@oipage/shader`） |

新增页面：在 `pages/` 下按输出路径建文件，再把链接加进 `partials/sidebar.html`（否则会被判为孤立页）。

## 命令

```bash
npm run docs                      # 生成 docs/
npm run docs:dev                  # 生成 + 本地预览：http://localhost:20001/docs/ （改 apis 自动重建）
node apis/build.mjs --check       # 只检查站内死链与孤立页，不动文件
```

预览必须以**仓库根目录**为服务器根：页面里的 demo 会去 `../dist`、`../node_modules` 取真实构建产物，
服务根设在 `docs/` 只会拿到 404（若服务器再把 404 兜底成 HTML，控制台就会报 `Unexpected token '<'`）。
`npm run docs:dev` 已经按这个前提起好了服务器；换工具的话，在仓库根跑 `oipage-cli serve -p 20001`
或 `python3 -m http.server 20001`，再打开 `/docs/index.html` 也一样。

## 页面写法

- 首行是 front-matter：`<!--meta { "title": "…", "desc": "…", "section": "guide", "demos": false }-->`
  - `section`：当前页属于哪一组导航，给 `{{in:…}}` 用
  - `demos`：是否需要底部演示脚本（`{{#if demos}}` 包住的 runtime.js）
  - `toc`：`"rail"` 生成页内目录、`false` 明确不要；不写时跟随 `site.json` 的全局值（现在是 `"rail"`）
- 正文里 `{{base}}` 表示「到站点根的相对前缀」，页面在第几级目录都不用改；
  资源的 `?v=` 由生成器算指纹，不用手写版本号。
- 目录自动生成，细节见下一节「页内目录」。
- 代码示例里出现 `{{ }}` 这种像模板的写法，用 `{{#raw}}…{{/raw}}` 包住，会原样输出。
- 想引用 `packages/` 里的真实源码，不用手抄，写 `{{src 路径#标记}}`，见下一节。

## 页内目录

一页有多个 `<section>` 时，生成器会自动做页内目录（统计顺序号、标题、锚点）：

- 锚点按章节序号生成，`01` → `id="s-01"`，所以改标题不会断链；section 自己写了 `id` 就沿用。
- 章节数量少于 3 个不生成，避免两三条还做目录。
- 目录文案默认取 `<h2>` 文字（会剥掉序号徽标和版本标签）；想更短就在 section 上加
  `data-toc-label="短名"`，这时 `h2` 可以继续写全。
- `h2` 里的序号写成 `<span class="idx">01</span>`（内容页）或 `<span class="no">01</span>`（首页式版块），
  没有序号 span 的 section 不会进目录。
- 首页在 `apis/pages/index.html` 里写了 `"toc": false`，不带目录，也不会被注入锚点。

同一个目录会按视口宽度换三种形态（样式在 `docs/assets/css/docs.css` 的「页内目录」段，
高亮与跳转在 `docs/assets/js/docs.js` 末尾）：

| 视口 | 形态 |
| --- | --- |
| ≥1200px | 右侧固定目录（`toc-rail`），随正文滚动高亮；左侧树里不再重复小节 |
| 641–1199px | 标题下的 chip 目录条（`toc-chips`）+ 左侧树当前页展开小节（`tree .sub`） |
| ≤640px | 同上，只是树换成了抽屉，小节在抽屉里当前页下面展开 |

三者共用 `aria-current="true"` 作为当前项标记，`data-toc="s-01"` 用来定位目标章节。

## 源码片段（{{src}}）

`read/` 这一组要求“文档里贴的就是源码里跑的”，所以代码块从源文件抽，不手抄：

```html
{{src packages/core/src/AuiPage.js#send-loop}}
```

- 源文件里用 `// #doc:标记` 开始、`// #end` 结束，把要展示的那一段夹在中间。
  标记本身只占一行，抽取时会去掉；片段整体缩进会被裁掉一层，相对缩进保留。
- 构建时会渲染成标准代码块，块头的 `文件:起始行` 自动计算，正文里不要手写行号——
  行号会漂，`#doc:标记` 不会。
- 标记名在同一文件里不要重名；找不到文件、标记没成对、缺 `#end`，构建会直接报错。
- 片段里的 `{{ }}` 不会被模板引擎吃掉：指令先换成占位符，渲染完再换回代码。

## 导航高亮

导航项的 class 三选一：

- `class="{{active:guide/start.html}}"`：只有这一页高亮
- `class="{{in:guide}}"`：`section` 为 `guide` 的页面都高亮
- `class="{{on:guide/a.html|guide/b.html}}"`：列出的页面高亮（不规则分组用这个）

## 代码着色

代码块的语言从 `.code-head .file` 的文件名推断：`.js/.ts/.mjs` 走 `javascript`，`.html` 走 `html`，
`.css`、`.json`、`.py`、`.sh`，`terminal` 走 `shell`。流程图、目录树这类不是代码的块，文件名不带扩展名，
自然保持原样。

着色由 [`@oipage/shader`](https://gitee.com/oi-contrib/oipage-shader) 完成：

- `apis/build.mjs` 每次生成时把 `node_modules/@oipage/shader/dist/shader.min.js` 拷到 `docs/assets/vendor/`，
  这样 `docs/` 单独发布也能用；
- `docs/assets/js/docs.js` 负责标记语言、调用 `Shader.shader()`，并配了一套与站点一致的浅色配色；
- 新增语言时，在 `docs.js` 的 `BY_EXT` / `BY_NAME` 里补映射即可，不需要改页面。

## 表格写法

规格表统一用 `<div class="table-wrap"><table class="spec">…</table></div>`：

- 两列表在手机上按 30% / 70% 分配列宽，正文自动换行，不横向滚动；
- 四列及以上放不下，给表格加 `wide`：`<table class="spec wide">`，手机上改成整表横向滚动，
  列宽按内容自适应，不会把 `sendMessage` 这种词拆成两行。

## 生成时还会做什么

- 每个产物顶部插一条「本文件由 apis 生成」的注释横幅。
- 把 `@oipage/shader` 的产物拷到 `docs/assets/vendor/`，供文档页着色使用。
- 检查站内 href / src 是否指向存在的文件、有没有从首页点不到的孤立页；
  `--strict` 下有告警以退出码 1 结束，可以挂进 CI。

## 发布前检查

1. `npm run docs` 重新生成，`docs/` 的改动一并提交；
2. `node apis/build.mjs --check` 必须通过；
3. 根 README 与各包 README 里的链接、示例代码，是否仍与当前 API 一致；
4. README 里的文档链接必须是发布地址 `https://handless-ui.github.io/auipage/...`，不要写 `./docs/*.html`；
