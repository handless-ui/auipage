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

function buildToc(content) {
  const items = [];
  const re = /<section[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(content))) {
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(m[2]);
    if (!h2) continue;
    // 目录文案可以用 data-toc-label 覆盖；否则取 h2 文字并去掉序号 span
    const label = /data-toc-label="([^"]*)"/.exec(m[0].slice(0, m[0].indexOf('>')));
    const text = label ? label[1] : stripTags(h2[1].replace(/^\s*<span[^>]*>[\s\S]*?<\/span>/, ''));
    items.push({ id: m[1], text });
  }
  // 有些页面（比如更新日志）不按 section 分块：认带 data-toc-label 的锚点，再退一步认带 id 的 h2
  if (!items.length) {
    const marked = /<([a-z]+)[^>]*\sid="([^"]+)"[^>]*\sdata-toc-label="([^"]*)"/g;
    let m;
    while ((m = marked.exec(content))) items.push({ id: m[2], text: m[3] });
  }
  if (!items.length) {
    const h2re = /<h2[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g;
    let m;
    while ((m = h2re.exec(content))) items.push({ id: m[1], text: stripTags(m[2]) });
  }
  return items;
}

function renderToc(items, style) {
  if (!items.length) return { toc: '', tocRail: '' };
  const list = items.map((i) => `<a href="#${i.id}">${i.text}</a>`).join('\n');
  const rail = items.map((i) => `<a href="#${i.id}">${i.text}</a>`).join('');
  return {
    toc: `<div class="toc" data-toc>\n<h6>本页目录</h6>\n${list}\n</div>`,
    tocRail: `<nav class="toc-rail"><h6>本页目录</h6>${rail}</nav>`,
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
    const generatedToc = tocMode === false ? { toc: '', tocRail: '' } : renderToc(buildToc(content));

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
      toc: tocMode === 'inline' ? generatedToc.toc : '',
      tocRail: tocMode === 'rail' ? generatedToc.tocRail : '',
      rel,
      __page: { rel, same: (p) => posix(p).replace(/^\.\//, '') === rel },
    };

    // 正文里也可以写模板变量（比如正文中间的 {{toc}} 或代码里的 {{base}}）
    ctx.content = render(content, ctx);
    ctx.preMain = preMain ? render(preMain, ctx) : '';

    let html = render(read(layoutFile), ctx);
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
