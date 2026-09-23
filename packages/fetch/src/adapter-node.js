// Node 环境适配器：基于 http / https，天然流式输出
// adapter 协议：(options, { onData, onEnd, onError, onResponse }) => void
// 运行时不通过顶层 import 静态拉取 node 内置模块，而是 await import 按需加载，
// 避免在浏览器 / bundler 解析阶段触发对 'http' / 'https' / 'url' 的静态分析。
async function nodeAdapter(options, { onData, onEnd, onError, onResponse }) {
  const [{ default: http }, { default: https }, { URL }] = await Promise.all([
    import('http'),
    import('https'),
    import('url')
  ]);

  const { url, method = 'GET', headers = {}, body } = options;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    onError(e);
    return;
  }

  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  const reqOptions = {
    method,
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers
  };

  const req = lib.request(reqOptions, (res) => {
    // 把 status / headers 同步给 Response（若上游关心）
    if (typeof onResponse === 'function') {
      onResponse({
        status: res.statusCode || 0,
        headers: res.headers || {}
      });
    }

    res.setEncoding('utf8');
    res.on('data', (chunk) => onData(chunk));
    res.on('end', () => onEnd());
    res.on('error', (err) => onError(err));
  });

  req.on('error', (err) => onError(err));

  if (body != null) {
    req.write(body);
  }
  req.end();
}

export { nodeAdapter };
