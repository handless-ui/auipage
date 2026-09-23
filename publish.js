// publish.js
// 用法:
//   npm run prepublishOnly  -> node publish.js --mode=error     阻止用户误用 npm publish
//   npm run publish         -> node publish.js --mode=publish   依次发布 packages/ 下的子包

import { spawn, spawnSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// 简单的 sleep（避免引入 setTimeout 套 Promise 的样板）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 工具函数 ----------

// 解析 --mode=xxx
function getMode() {
    const arg = process.argv.slice(2).find(a => typeof a === 'string' && a.startsWith('--mode='));
    return arg ? arg.split('=')[1] : null;
}

// 彩色输出
const c = {
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// 同步执行命令并返回 { status, stdout }
function runSync(cmd, args) {
    return spawnSync(cmd, args, { encoding: 'utf8', shell: true });
}

// 异步执行命令并把 stdio 直接透传给当前终端；同时识别 npm web 验证 URL 并高亮显示
function runInteractive(cmd, args, options = {}) {
    return new Promise(resolve => {
        const child = spawn(cmd, args, {
            stdio: ['inherit', 'inherit', 'inherit'],
            shell: true,
            env: process.env,
            ...options,
        });

        // npm CLI 在 web 验证模式下通常会输出类似:
        //   Open the following URL in a browser to authenticate:
        //   https://www.npmjs.com/auth/cli/xxxxxxx
        // 通过拦截 process.stdout / stderr.write 扫描 chunk 来识别，无需接管子进程流。
        const urlRegex = /https?:\/\/(?:www\.)?npmjs?(?:\.com|\.org)?\/[^\s\r\n]+/gi;
        const printed = new Set();

        function wrap(stream) {
            const origWrite = stream.write.bind(stream);
            stream.write = function (chunk, enc, cb) {
                const text = typeof chunk === 'string' ? chunk : chunk.toString();
                const ret = origWrite(chunk, enc, cb);
                let m;
                urlRegex.lastIndex = 0;
                while ((m = urlRegex.exec(text)) !== null) {
                    if (!printed.has(m[0])) {
                        printed.add(m[0]);
                        highlightUrl(m[0]);
                    }
                }
                return ret;
            };
            return origWrite;
        }
        const restoreOut = wrap(process.stdout);
        const restoreErr = wrap(process.stderr);

        child.on('close', code => {
            // 还原 stdout/stderr.write，避免污染后续 readline 交互
            process.stdout.write = restoreOut;
            process.stderr.write = restoreErr;
            resolve(code);
        });
        child.on('error', err => {
            process.stdout.write = restoreOut;
            process.stderr.write = restoreErr;
            console.error(c.red(`\n  spawn 异常: ${err.message}`));
            resolve(1);
        });
    });
}

// 高亮显示 npm web 验证 URL
function highlightUrl(url) {
    process.stdout.write('\n' + c.cyan('═'.repeat(60)) + '\n');
    process.stdout.write(c.yellow('👉  请复制下面 URL 到浏览器完成 npm 验证：') + '\n');
    process.stdout.write(c.green(c.bold('    ' + url)) + '\n');
    process.stdout.write(c.cyan('═'.repeat(60)) + '\n\n');
}

// 轮询 registry 直到指定包版本已发布（最长等待 timeoutMs 毫秒）
async function waitForPublished(name, version, timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (isVersionPublished(name, version)) return true;
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

// 检查某个包的某个版本是否已发布到 npm registry
// 直接查 npm registry 的 HTTP 文档：/{encodedName}/{version}
// 比 npm view CLI 更稳，绕开 dist-tag 解析和 CLI notice 污染 stdout 的坑
function isVersionPublished(name, version) {
    // @scope/pkg -> @scope%2fpkg
    const encoded = encodeURIComponent(name).replace(/^%40/, '@').replace('@', '%40');
    const url = `https://registry.npmjs.org/${encoded}/${version}`;
    try {
        const r = runSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', url]);
        const code = (r.stdout || '').trim();
        return code === '200';
    } catch {
        return false;
    }
}

// 没有任何手动交互的版本：单纯 sleep，配合下方的提示语刷屏，足以让用户看清日志
function waitOrSkip(msg, ms) {
    console.log(msg);
    return sleep(ms);
}

// ---------- mode=error：阻止用户直接执行 npm publish ----------

const mode = getMode();
if (mode === 'error') {
    console.error('\n' + c.red('✖ [错误] 请勿直接执行 npm publish！'));
    console.error('请使用 ' + c.cyan('npm run publish') + ' 来发布项目子包。\n');
    process.exit(1);
}

if (mode !== 'publish') {
    console.error(c.red('✖ 用法: node publish.js --mode=error | --mode=publish'));
    process.exit(1);
}

// ---------- 主流程 ----------
(async () => {
    // 1. 预检查 npm 登录态
    console.log(c.cyan('▶ 预检查 npm 登录态...'));
    const who = runSync('npm', ['whoami']);
    if (who.status !== 0) {
        console.error(c.red('\n✖ 未登录 npm，请先执行: npm login\n'));
        process.exit(1);
    }
    console.log(c.green('✔ 已登录 npm 账号: ') + who.stdout.trim() + '\n');

    // 2. 收集 packages/ 下的子包
    const packagesDir = './packages';
    let pkgDirs;
    try {
        pkgDirs = readdirSync(packagesDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
    } catch (e) {
        console.error(c.red(`✖ 无法读取目录 ${packagesDir}: ${e.message}`));
        process.exit(1);
    }

    // name -> dirName + 依赖关系
    const nameToDir = new Map();
    const depsOf = new Map();
    for (const dir of pkgDirs) {
        let pkg;
        try {
            pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
        } catch (e) {
            console.error(c.red(`✖ 解析 packages/${dir}/package.json 失败: ${e.message}`));
            process.exit(1);
        }
        if (!pkg.name) {
            console.error(c.red(`✖ packages/${dir}/package.json 缺少 name 字段`));
            process.exit(1);
        }
        nameToDir.set(pkg.name, dir);
        const deps = new Set();
        for (const depName of Object.keys(pkg.dependencies || {})) {
            if (depName.startsWith('@auipage/')) deps.add(depName);
        }
        depsOf.set(pkg.name, deps);
    }

    if (nameToDir.size === 0) {
        console.error(c.red('✖ packages/ 下未找到任何子包'));
        process.exit(1);
    }

    // 3. 拓扑排序（Kahn 算法，按依赖层次发布，同层按名字字母序）
    const indeg = new Map();
    for (const name of nameToDir.keys()) {
        let deg = 0;
        for (const dep of depsOf.get(name) || []) {
            if (nameToDir.has(dep)) deg++;
        }
        indeg.set(name, deg);
    }

    const order = [];
    const ready = [...nameToDir.keys()].filter(n => indeg.get(n) === 0).sort();
    while (ready.length) {
        // 同一层取字母序最前的，保证输出稳定
        ready.sort();
        const name = ready.shift();
        order.push(name);
        // 找出谁依赖了 name
        for (const other of nameToDir.keys()) {
            const deps = depsOf.get(other);
            if (deps && deps.has(name)) {
                const left = indeg.get(other) - 1;
                indeg.set(other, left);
                if (left === 0) ready.push(other);
            }
        }
    }

    if (order.length !== nameToDir.size) {
        const remaining = [...nameToDir.keys()].filter(n => !order.includes(n));
        console.error(c.red(`✖ 检测到循环依赖，未排完的包: ${remaining.join(', ')}`));
        process.exit(1);
    }

    console.log(c.cyan('▶ 即将按以下顺序发布子包:'));
    order.forEach((n, i) => {
        console.log(`   ${String(i + 1).padStart(2)}. ${n}  (packages/${nameToDir.get(n)})`);
    });
    console.log();

    // 4. 依次发布
    for (let i = 0; i < order.length; i++) {
        const name = order[i];
        const dir = nameToDir.get(name);
        const pkgPath = join(packagesDir, dir, 'package.json');
        const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

        console.log(c.yellow(`\n▶ [${i + 1}/${order.length}] 准备发布: ${name}@${version}  (packages/${dir})`));

        // 跳过已发布的版本（便于中途失败后重试）
        if (isVersionPublished(name, version)) {
            console.log(c.green(`  ⏭ ${name}@${version} 已发布过，自动跳过。`));
            continue;
        }

        // 每个包之间留出浏览器完成 Web 验证 URL 的时间；2 秒后自动开始下一个
        const prompt = i < order.length - 1
            ? c.cyan('  ▶ 即将发布下一个包，2 秒后自动开始...')
            : c.cyan('  ▶ 即将发布最后一个包，2 秒后自动开始...');
        await waitOrSkip(prompt, 2000);

        // 根据 version 自动决定 npm tag：X.Y.Z 用 latest（不加 --tag），X.Y.Z-xxx.N 用 prerelease 的第一段作为 tag
        const prereleaseMatch = /^\d+\.\d+\.\d+[-+]/.exec(version);
        const distTag = prereleaseMatch ? version.split('-')[1].split('+')[0].split('.')[0] : null;
        const publishArgs = ['publish', '--auth-type=web', '--access', 'public'];
        if (distTag) publishArgs.push('--tag', distTag);

        const tagDesc = distTag ? `--tag ${distTag}` : '(默认 latest)';
        console.log(c.yellow(`  执行: npm publish --auth-type=web --access public ${tagDesc}  (cd packages/${dir})\n`));

        const code = await runInteractive('npm', publishArgs, { cwd: join(packagesDir, dir) });

        if (code !== 0) {
            console.error(c.red(`\n✖ ${name} 发布失败（退出码 ${code}），流程终止。`));
            console.error(c.red(`  重新执行 ${c.cyan('npm run publish')} 即可，已发布的子包会自动跳过。`));
            process.exit(code);
        }

        // 兜底：轮询 registry 确认版本已发布，避免 npm CLI 返回非零但其实已发成功的边界情况
        if (!await waitForPublished(name, version)) {
            console.error(c.red(`\n✖ ${name}@${version} 在 5 分钟内未在 registry 出现，请手动确认。`));
            process.exit(1);
        }
        console.log(c.green(`✔ ${name}@${version} 已确认发布`));
    }

    // 5. 收尾
    console.log('\n' + c.green(c.bold('🎉 所有子包发布完成！')));
})();