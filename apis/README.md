# apis：文档源码

`docs/` 下的 HTML 是生成出来的，**不要直接改**。改这里，然后跑一次生成命令。

## 目录

```
apis/
├── site.json            站点常量：站点名、版本号、协议、仓库 / npm 链接、高亮 class 名
├── build.mjs            生成器（零依赖，只用 Node 内置模块）
├── layouts/page.html    页面骨架：head、body 分区、主容器
├── partials/            每页共用的片段
│   ├── topbar.html        顶栏 / 左侧导航栏
│   ├── mobile.html        小屏抽屉
│   ├── sidebar.html       文档目录树
│   ├── footer.html        页脚
│   └── scripts.html       页面底部脚本
└── pages/               每个页面只有自己的正文
    guide/start.html                        → docs/guide/start.html
    index.html                              → docs/index.html
    packages/agent.html                     → docs/packages/agent.html
    packages/core.html                      → docs/packages/core.html
    packages/fetch.html                     → docs/packages/fetch.html
    packages/model.html                     → docs/packages/model.html
    packages/types.html                     → docs/packages/types.html
```

## 改东西时去哪儿

| 想改的内容 | 改哪个文件 |
| --- | --- |
| 某页正文 | `pages/` 下对应文件 |
| 导航项、顺序、分组 | `partials/sidebar.html`（文档树）、`partials/topbar.html`（顶栏）、`partials/mobile.html`（小屏抽屉，导航与顶栏同步） |
| 页脚布局、生态外链（框架 / 兄弟库） | `partials/footer.html` |
| 站点标题、描述、主题色、favicon | `layouts/page.html` 的 head 部分 |
| 版本号、协议、GitHub 仓库、npm 地址、站点名、高亮 class 名 | `site.json` |
| 页面样式 | `docs/assets/css/docs.css`（`assets/` 是手写的，不参与生成） |

新增页面：在 `pages/` 下按输出路径建文件，再把链接加进 `partials/sidebar.html`。

## 命令

```bash
npm run docs                      # 生成 docs/
npm run docs:dev                  # 生成 + 本地预览：http://localhost:20001/docs/ （改 apis 自动重建）
node apis/build.mjs --check       # 只检查站内死链，不动文件
```

预览必须以**仓库根目录**为服务器根：页面里的 demo 会去 `../dist`、`../node_modules` 取真实构建产物，
服务根设在 `docs/` 只会拿到 404（若服务器再把 404 兜底成 HTML，控制台就会报 `Unexpected token '<'`）。
`npm run docs:dev` 已经按这个前提起好了服务器；换工具的话，在仓库根跑 `oipage-cli serve -p 20001`
或 `python3 -m http.server 20001`，再打开 `/docs/index.html` 也一样。


## 页面写法

- 首行是 front-matter：`<!--meta { "title": "…", "desc": "…", "section": "guide", "demos": false }-->`
  - `section`：当前页属于哪一组导航，给 `{{in:…}}` 用
  - `demos`：是否需要底部演示脚本（`{{#if demos}}` 包住的 runtime.js）
  - `toc`：`"inline"` 正文里插目录、`"rail"` 正文右侧插目录、不写就不生成
- 正文里 `{{base}}` 表示「到站点根的相对前缀」，页面在第几级目录都不用改；
  资源的 `?v=` 由生成器算指纹，不用手写版本号。
- 目录自动生成：从每个 `<section id="…">` 里的 `<h2>` 取标题；
  目录文案想比标题短，就在 section 上加 `data-toc-label="短名"`。
- 代码示例里出现 `{{ }}` 这种像模板的写法，用 `{{#raw}}…{{/raw}}` 包住，会原样输出。

## 导航高亮

导航项的 class 三选一：

- `class="{{active:guide/installation.html}}"`：只有这一页高亮
- `class="{{in:guide}}"`：`section` 为 `guide` 的页面都高亮
- `class="{{on:guide/a.html|guide/b.html}}"`：列出的页面高亮（不规则分组用这个）

## 生成时还会做什么

- 每个产物顶部插一条「本文件由 apis 生成」的注释横幅。
- 检查站内 href / src 是否指向存在的文件、有没有从首页点不到的孤立页；
  `--strict` 下有告警以退出码 1 结束，可以挂进 CI。
