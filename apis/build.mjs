#!/usr/bin/env node
/**
 * 文档生成器：apis/ -> docs/
 *
 * 零依赖，只用 Node 内置模块（Node 18+）。
 *
 *   npm run docs        生成 docs/ 下的静态页面
 *   npm run docs:dev    生成后起一个本地服务器，改 apis 自动重建
 *   node apis/build.mjs --check   只做链接检查
 *
 * 模板语法（够用就好，不引入第三方模板引擎）：
 *   {{ name }}                变量，来自 site.json、页面 front-matter 或内置变量
 *   {{> partial }}            引入 apis/partials/<partial>.html
 *   {{#if cond}} … {{else}} … {{/if}}
 *   {{#unless cond}} … {{/unless}}
 *   {{active:path}}           当前页面等于 path 时输出高亮 class
 *   {{in:section}}            当前页面属于 section 时输出高亮 class
 *   {{on:a|b}}                当前页面是列出的任意一个时输出高亮 class
 *
 * 内置变量：title、desc、base（相对站点根的路径前缀）、assetVer（资源指纹）、
 *          content（页面正文）、preMain（正文前插槽）、toc / tocRail（自动目录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SRC, '..');
const OUT = path.join(ROOT, 'docs');

const BANNER =
  '<!-- 本文件由 apis 生成，请勿直接编辑；改 apis 里的页面、模板或 site.json 后运行 npm run docs 重新生成。 -->';

const flag = (name) => {
  const args = process.argv.slice(2);
  // 同时支持 --port 20001 和 --port=20001
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx >= 0) {
    const next = args[idx + 1];
    return next && !next.startsWith('--') ? next : true;
  }
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(eq.indexOf('=') + 1);
  return null;
};

const problems = [];

/* ------------------------------------------------------------------ 工具函数 */

const read = (file) => fs.readFileSync(file, 'utf8');
const exists = (file) => fs.existsSync(file);
const posix = (p) => p.split(path.sep).join('/');

function walkHtml(dir, base = dir, out = []) {
  if (!exists(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkHtml(full, base, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** 去掉标签，保留文字，用于自动生成目录 */
function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把运行时依赖的第三方脚本拷进站点，保证 docs/ 单独发布也能用 */
function syncVendor() {
  const pairs = [
    ['node_modules/@oipage/shader/dist/shader.min.js', 'assets/vendor/shader.min.js'],
  ];
  for (const [from, to] of pairs) {
    const src = path.join(ROOT, from);
    if (!exists(src)) {
      console.warn(`  ! 找不到 ${from}，跳过拷贝（先执行 npm install）`);
      continue;
    }
    const dest = path.join(OUT, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/** 资源指纹：css / js 一改，所有页面的 ?v= 自动跟着变，省掉手改版本号 */
function assetVersion() {
  const dir = path.join(OUT, 'assets');
  const files = [];
  (function collect(d) {
    if (!exists(d)) return;
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) collect(full);
      else if (/\.(css|js)$/.test(name)) files.push(full);
    }
  })(dir);
  if (!files.length) return '0';
  const hash = crypto.createHash('sha1');
  for (const f of files) hash.update(fs.readFileSync(f));
  return hash.digest('hex').slice(0, 8);
}

/* --------------------------------------------------------------- 模板引擎部分 */

function lookup(ctx, expr) {
  const raw = expr.trim();

  const colon = raw.indexOf(':');
  if (colon > 0) {
    const fn = raw.slice(0, colon).trim();
    const arg = raw.slice(colon + 1).trim();
    if (fn === 'active') return ctx.__page.same(arg) ? ctx.activeClass : '';
    if (fn === 'in') return ctx.section === arg ? ctx.activeClass : '';
    if (fn === 'on') return arg.split('|').includes(ctx.rel) ? ctx.activeClass : '';
  }

  const value = raw.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), ctx);
  if (value === undefined) throw new Error(`模板里用到了未定义的变量：{{ ${raw} }}`);
  if (value === null || value === false) return '';
  return String(value);
}

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value) && value !== 'false';
}

function extractBlock(tpl, start, keyword) {
  const thenParts = [];
  const elseParts = [];
  let depth = 1;
  let inElse = false;
  let pos = start;
  const re = /\{\{([#/]?)\s*([^}]*?)\s*\}\}/g;
  re.lastIndex = start;

  let m;
  while ((m = re.exec(tpl))) {
    const sigil = m[1];
    const body = m[2].trim();
    const head = body.split(/\s+/)[0];

    if (sigil === '#' && head === keyword) {
      depth += 1;
      continue;
    }
    if (sigil === '/' && head === keyword) {
      depth -= 1;
      if (depth === 0) {
        (inElse ? elseParts : thenParts).push(tpl.slice(pos, m.index));
        return { then: thenParts.join(''), else: elseParts.join(''), end: re.lastIndex };
      }
      continue;
    }
    if (!sigil && body === 'else' && depth === 1) {
      (inElse ? elseParts : thenParts).push(tpl.slice(pos, m.index));
      inElse = true;
      pos = re.lastIndex;
    }
  }
  throw new Error(`{{#${keyword}}} 块没有闭合`);
}

function render(tpl, ctx, depth = 0) {
  if (depth > 8) throw new Error('片段嵌套太深，检查 partial 是否互相引用');

  let out = '';
  let pos = 0;
  const re = /\{\{([#/>]?)\s*([^}]*?)\s*\}\}/g;
  let m;

  while ((m = re.exec(tpl))) {
    out += tpl.slice(pos, m.index);
    pos = re.lastIndex;

    const sigil = m[1];
    const body = m[2];

    if (sigil === '#') {
      const keyword = body.split(/\s+/)[0];

      // {{#raw}} 里的内容原样输出，用来写「看起来就像模板语法」的示例代码
      if (keyword === 'raw') {
        const raw = extractBlock(tpl, pos, keyword);
        out += raw.then;
        pos = raw.end;
        re.lastIndex = pos;
        continue;
      }

      if (keyword !== 'if' && keyword !== 'unless') {
        throw new Error(`不支持的模板语句：{{#${keyword}}}`);
      }
      const cond = truthy(lookup(ctx, body.slice(keyword.length)));
      const block = extractBlock(tpl, pos, keyword);
      const pick = keyword === 'if' ? (cond ? block.then : block.else) : cond ? block.else : block.then;
      out += render(pick, ctx, depth + 1);
      pos = block.end;
      re.lastIndex = pos;
      continue;
    }

    if (sigil === '>') {
      const name = body.trim();
      const file = path.join(SRC, 'partials', `${name}.html`);
      if (!exists(file)) throw new Error(`找不到片段 partials/${name}.html`);
      out += render(read(file), ctx, depth + 1);
      continue;
    }

    if (sigil === '/') continue; // 闭合标签由 extractBlock 消费

    out += lookup(ctx, body);
  }

  return out + tpl.slice(pos);
}

/* ------------------------------------------------------------------ 页面组装 */

function parsePage(file) {
  const source = read(file);
  const metaMatch = /^\s*<!--meta\s*(\{[\s\S]*?\})\s*-->/m.exec(source);
  let meta = {};
  let rest = source;

  if (metaMatch && metaMatch.index === 0) {
    meta = JSON.parse(metaMatch[1]);
    rest = source.slice(metaMatch[0].length);
  }

  // 可选的分区标记：<!--#pre--> 正文前插槽、<!--#main--> 正文
  let preMain = '';
  if (rest.includes('<!--#pre-->')) {
    const [, afterPre] = rest.split('<!--#pre-->');
    const split = afterPre.split('<!--#main-->');
    preMain = (split.length > 1 ? split[0] : '').trim();
    rest = split.length > 1 ? split[1] : afterPre;
  } else if (rest.includes('<!--#main-->')) {
    rest = rest.split('<!--#main-->')[1];
  }

  return { meta, preMain, content: rest.trim() };
}

const TOC_MIN = 3;

/** 章节锚点：序号取 .idx / .no；锚点按序号生成（s-01），标题改了链接不会断 */
function indexSections(content) {
  const items = [];
  const out = content.replace(/<section\b([^>]*)>([\s\S]*?)<\/section>/g, (all, attrs, body) => {
    const num = /<span class="(?:idx|no)">([0-9]{1,2})<\/span>/.exec(body);
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(body);
    if (!num || !h2) return all;

    // 目录文案可以用 data-toc-label 覆盖；否则取 h2 文字并去掉序号 span
    const label = /data-toc-label="([^"]*)"/.exec(attrs);
    // 标题里的序号徽标与版本标签不进目录
    const clean = h2[1]
      .replace(/^\s*<span[^>]*>[\s\S]*?<\/span>/, '')
      .replace(/<span class="ver[^"]*">[\s\S]*?<\/span>/g, '');
    const text = label ? label[1] : stripTags(clean).trim();
    const hasId = /\sid="([^"]+)"/.exec(attrs);
    const id = hasId ? hasId[1] : `s-${num[1]}`;
    const nextAttrs = hasId ? attrs : `${attrs} id="${id}"`;

    items.push({ id, num: num[1], text });
    return `<section${nextAttrs}>${body}</section>`;
  });

  return { content: out, items };
}

function renderToc(items) {
  if (items.length < TOC_MIN) return { rail: '', chips: '', sub: '' };

  const item = (i, cls) => `<a class="${cls}" href="#${i.id}" data-toc="${i.id}"><i>${i.num}</i><span>${i.text}</span></a>`;

  return {
    rail: `<nav class="toc-rail" aria-label="本页目录">\n<div class="toc-rail-head"><span>本页目录</span><em>${items.length} 节</em></div>\n<ol>${items
      .map((i) => `<li>${item(i, 'toc-item')}</li>`)
      .join('')}</ol>\n<a class="toc-top" href="#main">↑ 回到顶部</a>\n</nav>`,
    chips: `<nav class="toc-chips" aria-label="本页目录"><i class="toc-chips-h">本页目录</i><div class="toc-chips-row">${items
      .map((i) => item(i, 'chip'))
      .join('')}</div></nav>`,
    sub: `<div class="sub">${items
      .map((i) => `<a href="#${i.id}" data-toc="${i.id}"><i>${i.num}</i><span>${i.text}</span></a>`)
      .join('')}</div>`,
  };
}

function sectionOf(rel) {
  const first = posix(path.dirname(rel));
  return first === '.' ? 'home' : first.split('/')[0];
}

function relativeBase(rel) {
  const depth = rel.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/** 页面里的站内链接，用于生成后的死链检查 */
function collectLinks(html) {
  const links = [];
  const re = /(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(href)) continue;
    links.push(href);
  }
  return links;
}

/* ---------------------------------------------------------------- 源码片段注入 */

/** 占位符前后缀：注入的代码先换成标记，避开模板引擎的 {{ }} */
const SRC_SLOT = "\u0000SRC";

/**
 * 抽取 packages 源码里 // #doc:名字 到 // #end 之间的片段。
 * 用标记而不是行号，源码移动、增删行都不会让文档错位。
 */
function readSnippet(spec) {
  const hash = spec.lastIndexOf("#");
  if (hash < 0) throw new Error(`{{src}} 要写成 路径#标记：${spec}`);

  const relPath = spec.slice(0, hash).trim();
  const name = spec.slice(hash + 1).trim();
  const file = path.join(ROOT, relPath);
  if (!exists(file)) throw new Error(`{{src}} 找不到文件：${relPath}`);

  const lines = read(file).split("\n");
  const open = new RegExp("\\/\\/ #doc:" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let from = -1;
  for (let i = 0; i < lines.length; i++) {
    if (open.test(lines[i])) {
      from = i + 1;
      break;
    }
  }
  if (from < 0) throw new Error(`{{src ${spec}}}：${relPath} 里没有 // #doc:${name}`);

  let to = -1;
  for (let i = from; i < lines.length; i++) {
    if (/\/\/ #end/.test(lines[i])) {
      to = i;
      break;
    }
  }
  if (to < 0) throw new Error(`{{src ${spec}}}：${relPath} 的 #doc:${name} 少了 // #end`);

  const raw = lines.slice(from, to);

  // 去掉整体缩进（标记常写在函数体内），相对缩进保留
  const widths = raw.filter(line => line.trim()).map(line => (/^\s*/.exec(line)[0] || "").length);
  const min = widths.length ? Math.min.apply(null, widths) : 0;

  return {
    file: relPath,
    line: from + 1,
    body: raw.map(line => line.slice(min)).join("\n"),
  };
}

/** 片段渲染成站点统一的代码块，文件名后面带上起始行号 */
function codeBlockOf(snippet) {
  const esc = snippet.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div class="code"><div class="code-head"><span class="file">${snippet.file}</span><span class="ln">:${snippet.line}</span><button data-copy="">复制</button></div><div class="code-body"><pre>${esc}</pre></div></div>`;
}

/** 把页面里的 {{src 路径#标记}} 换成占位符，渲染完再换回代码块 */
function protectSrc(body, slots) {
  return body.replace(/\{\{src\s+([^}]*)\}\}/g, (all, spec) => {
    slots.push(codeBlockOf(readSnippet(spec.trim())));
    return SRC_SLOT + (slots.length - 1) + "\u0000";
  });
}

function expandSrc(html, slots) {
  return html.replace(new RegExp(SRC_SLOT + "(\\d+)\\u0000", "g"), (all, i) => slots[Number(i)]);
}

/* ---------------------------------------------------------------- 生成 / 检查 */

function build() {
  const site = JSON.parse(read(path.join(SRC, 'site.json')));
  const pagesDir = path.join(SRC, 'pages');
  const layoutsDir = path.join(SRC, 'layouts');
  const files = walkHtml(pagesDir);

  syncVendor();
  const assetVer = assetVersion();
  const generated = [];

  if (!files.length) throw new Error(`没有在 ${path.relative(ROOT, pagesDir)} 找到页面`);

  for (const file of files) {
    const rel = posix(path.relative(pagesDir, file));
    const outFile = path.join(OUT, rel);
    const { meta, preMain, content } = parsePage(file);
    const layoutName = meta.layout || 'page';
    const layoutFile = path.join(layoutsDir, `${layoutName}.html`);
    if (!exists(layoutFile)) throw new Error(`找不到布局 layouts/${layoutName}.html（页面 ${rel}）`);

    const tocMode = meta.toc === undefined ? site.toc || false : meta.toc;
    // 不带目录的页面（如首页）也不动它的 section，避免留下用不上的锚点
    const indexed = tocMode === false ? { content, items: [] } : indexSections(content);
    const toc = tocMode === false ? { rail: '', chips: '', sub: '' } : renderToc(indexed.items);

    const ctx = {
      ...site,
      ...meta,
      title: meta.title || site.name,
      desc: meta.desc || site.desc || '',
      base: relativeBase(rel),
      assetVer,
      activeClass: site.activeClass || 'active',
      section: meta.section || sectionOf(rel),
      home: rel === 'index.html',
      content: '',
      preMain: '',
      tocRail: toc.rail,
      rel,
      __page: { rel, same: (p) => posix(p).replace(/^\.\//, '') === rel },
    };

    // chip 目录条插在 pagehead 之后、第一章之前
    let pageBody = indexed.content;
    if (toc.chips) {
      const at = pageBody.search(/<section\b/);
      pageBody = at < 0 ? `${pageBody}\n${toc.chips}` : `${pageBody.slice(0, at)}${toc.chips}\n${pageBody.slice(at)}`;
    }

    // 正文里也可以写模板变量（比如代码里的 {{base}}）
    // {{src 路径#标记}} 从源码抽片段：先占位，渲染完再换回，避免代码里的 {{ }} 被当成变量
    const srcSlots = [];
    ctx.content = expandSrc(render(protectSrc(pageBody, srcSlots), ctx), srcSlots);
    ctx.preMain = preMain ? expandSrc(render(protectSrc(preMain, srcSlots), ctx), srcSlots) : '';

    let html = render(read(layoutFile), ctx);

    // 左侧树（含手机抽屉）里，把当前页的小节挂在当前链接下面
    if (toc.sub) {
      const active = site.activeClass || 'active';
      html = html.replace(/<aside class="tree">([\s\S]*?)<\/aside>/g, (all, inner) => {
        const hit = new RegExp(`(<a href="[^"]*" class="${active}">[\\s\\S]*?<\\/a>)`);
        return all.replace(inner, inner.replace(hit, `$1${toc.sub}`));
      });
    }

    html = html.replace(/^(<!DOCTYPE html>\s*\n)/i, `$1${BANNER}\n`);
    if (!html.endsWith('\n')) html += '\n';

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, html);
    generated.push({ rel, outFile, html });
  }

  // 死链 + 孤立页面检查
  const targets = new Set(generated.map((g) => g.rel));
  const seen = new Set(['index.html']);

  for (const page of generated) {
    for (const href of collectLinks(page.html)) {
      const clean = href.split('#')[0].split('?')[0];
      if (!clean) continue;
      const target = posix(path.normalize(path.join(path.dirname(page.rel), clean)));
      if (!targets.has(target) && !exists(path.join(OUT, target))) {
        problems.push(`${page.rel} 里的链接指向了不存在的文件：${href}`);
      }
      if (targets.has(target)) seen.add(target);
    }
  }

  // 从首页顺着链接能走到的页面才算被收录，剩下的多半是忘了加进导航
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of generated) {
      if (!seen.has(page.rel)) continue;
      for (const href of collectLinks(page.html)) {
        const clean = href.split('#')[0].split('?')[0];
        if (!clean) continue;
        const target = posix(path.normalize(path.join(path.dirname(page.rel), clean)));
        if (targets.has(target) && !seen.has(target)) {
          seen.add(target);
          grew = true;
        }
      }
    }
  }
  for (const rel of targets) {
    if (!seen.has(rel)) problems.push(`${rel} 没有被任何页面的链接引用到，检查是否漏了导航项`);
  }

  return { site, generated };
}

function report(problemsList) {
  if (!problemsList.length) {
    console.log('链接检查通过。');
    return;
  }
  for (const p of problemsList) console.log(`  ! ${p}`);
  console.log(`共 ${problemsList.length} 处需要人工确认。`);
}

/* ---------------------------------------------------------------- 本地预览服务 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serve(port) {
  let building = false;
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (building) return;
      building = true;
      try {
        build();
        console.log('已重新生成 docs/');
      } catch (e) {
        console.error(`生成失败：${e.message}`);
      } finally {
        building = false;
      }
    }, 120);
  };

  fs.watch(SRC, { recursive: true }, rebuild);

  // 注意：以「仓库根目录」为服务器根，而不是 docs/。
  // 文档里的 demo 要取 ../dist 与 ../node_modules 下的真实构建产物，
  // 服务根设在 docs/ 会让这些请求落到 404（甚至被回退成 HTML，报 Unexpected token '<'）。
  http
    .createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/') {
        res.writeHead(302, { Location: '/docs/' });
        res.end();
        return;
      }
      let file = path.join(ROOT, path.normalize(url));
      if (!file.startsWith(ROOT) || file.startsWith(path.join(ROOT, 'apis'))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403');
        return;
      }
      if (url.endsWith('/')) file = path.join(file, 'index.html');
      if (exists(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!exists(file)) {
        if (url === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 ' + url);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file));
    })
    .on('error', (e) => {
      console.error(`预览启动失败：${e.message}（端口被占用就换一个：node apis/build.mjs --serve --port=20002）`);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`预览：http://localhost:${port}/docs/  （改 apis 会自动重建，Ctrl+C 退出）`);
    });
}

/* ------------------------------------------------------------------------ 入口 */

try {
  const result = build();
  const count = result.generated.length;
  if (flag('check')) {
    console.log(`已检查 ${count} 个页面。`);
    report(problems);
  } else {
    console.log(`已生成 ${count} 个页面到 docs/`);
    if (problems.length) report(problems);
    if (flag('serve')) serve(Number(flag('port')) || 20001);
  }
  if (flag('strict') && problems.length) process.exitCode = 1;
} catch (e) {
  console.error(`生成失败：${e.message}`);
  process.exitCode = 1;
}
