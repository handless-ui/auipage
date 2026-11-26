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
├── agent/               站内助手的源码与打包脚本（产物进 docs/assets/agent/）
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

## 站内助手（悬浮 logo + 对话面板）

`docs/` 每个页面右下角都有一个可拖拽的圆形 logo，点一下才懒加载站内助手；
加载时全屏提示「系统加载中，请耐心等待」，可以取消。助手本身是一个**真实**的
`@auipage/core` + `@auipage/agent` + `@auipage/model` + `@auipage/fetch` 示例，
不是另写的一套对话循环。

```
apis/agent/
├── build.mjs            rollup 打包：src/index.js → docs/assets/agent/app.js（ESM）
└── src/
    ├── index.js         面板装配：AuiPage + 三个适配器 + 输入区/设置页
    ├── transport.js     ChatTransportAdapter：Agent → MessageStream → CreateTool 桥
    ├── tools.js         page_info / list_pages 两个前端工具（真正在浏览器里执行）
    ├── providers.js     模型服务配置的种子、读写与增删改（localStorage）
    ├── probe.js         连接诊断：把跨域/密钥/404/超时翻译成人话
    ├── models.js        provider → Model 实例（demo 协议换成脚本模型）
    ├── demo.js          内置演示模型，契约与 Model 完全一致
    ├── settings.js      模型服务页：卡片 + 添加/编辑/测试/设为当前/删除
    ├── md.js            极简 markdown（流式渲染用）
    └── views/
        ├── chat.js      ChatContentRuntime：消息、思考、工具卡片、空态
        └── thread.js    ThreadList / MessageHistory 适配器（localStorage + 归档/删除）
```

产物都在 `docs/assets/agent/`：`boot.js`（外壳，手写，挂进 `partials/scripts.html`）、
`app.js`（打包产物）、`app.css`（面板样式）、`index.json`（本地检索索引，`apis/build.mjs` 生成）。

### 行为约定

- **懒加载**：`boot.js` 只在第一次点击时用 `fetch` 拉 `app.js` / `app.css`，再以 Blob URL 动态 `import`；
  中途取消是真 `AbortController.abort()`，不是假装隐藏。
- **模型服务**：用户自己填 OpenAI 兼容地址（增/删/改，同一时刻只有一条生效）。
  默认选中内置「本地模型（演示）」，让没配模型的人也能直接体验；换成自己的模型后即真实对话。配置存 `localStorage`
  （键 `auipage.docs.agent.v1.providers`，悬浮球位置在同前缀的 `.pos`）。
- **跨域**：浏览器直连第三方地址，对方必须允许 CORS，否则请求会被拦。
  「设置」是面板内的弹框：宽 780px、手机留 10px 边，点遮罩或右上角 × 关闭；弹框里有常驻说明，面板顶部也有提示条；本机 Ollama 可用 `OLLAMA_ORIGINS=* ollama serve` 放行。
  连不上时点「测试连接」会给出具体结论（跨域被拦 / 密钥被拒 / 404 / 超时）。
- **演示模型**：内置「本地模型（演示）」，`protocol` 为 `demo`、只读、不可删。
  它的 `completions(params, logback, thinkback)` 与 `Model` 同契约，所以 Agent 的工具循环、
  CreateTool 的两段式等待、AuiPage 的工具卡片全是真代码，只有 token 来源是本地脚本/检索。
  脚本没命中的问题会走本地检索：把 23 页正文切成 129 个小节，按中文 bigram + BM25 变体打分，
  取前 3–5 处原文句子拼成约 350 字的摘录式回答，末尾附可展开的「命中 n 处 · m 篇」清单与原文锚点链接；
  检索不到就明说，不给编造答案。索引随 `node apis/build.mjs` 自动重建。
  适合没配模型的人先体验；回答带「演示模式 · 不联网」状态条与须知。
- **可点击建议**：演示回答里用反引号包起来的示例问句会变成可点击的小按钮，点一下把问题填进输入框（不自动发送）。
- **会话**：列表按日期分组（今天 / 昨天 / M月D日 / 已归档 · n），最近活跃的排在最上面；
  每行是「文档图标 + 标题 + M/D」，hover 才露出 `⋯` 菜单（归档 / 恢复 / 删除），
  每发一轮消息都会刷新标题、时间并把该会话顶回「今天」第一位；归档后移入底部「已归档」组，可恢复或删除；
  删除当前会话时 AuiPage 会自动开一条新会话。列表与消息历史都持久化（键 `auipage.docs.agent.v1.threads` / `.history`），
  写 `localStorage` 失败（隐私模式/配额）时退化为内存。
- **手机**：面板铺满全屏（`100dvh`），会话列表收成左侧抽屉（顶栏 `☰` 打开、点遮罩关闭），
  会话的归档/删除在触屏上常显；输入区按钮放大到 34px，iOS 下 15px 字号避免聚焦缩放。
- **视觉**：左栏品牌、助手头像、悬浮球统一用站点 logo 图（`assets/img/logo.png`）；
  悬浮球整块 54px 完整显示（含天线），上方提示「点击我，快速试一下」，每隔 6–11 秒轻微动一下（`prefers-reduced-motion` 下关闭）。

### 命令

```bash
npm run docs:agent                # 只重打助手：docs/assets/agent/app.js
node apis/agent/build.mjs         # 同上
```

`npm run docs` / `npm run docs:dev` 已经先打助手再生成页面，改完 `apis/agent/src` 直接跑一次即可；
`apis/build.mjs` 算 `?v=` 指纹时会把 `app.js` / `app.css` / `boot.js` 一起算进去。

本地预览助手必须走 http（`file://` 下 `fetch` 拉 `app.js` 会被浏览器拦）。
