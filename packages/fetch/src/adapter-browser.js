// 浏览器环境适配器：基于原生 fetch + ReadableStream
// adapter 协议：(options, { onData, onEnd, onError, onResponse }) => void
function browserAdapter(options, { onData, onEnd, onError, onResponse }) {
  const { url, method = 'GET', headers = {}, body } = options;

  if (typeof fetch !== 'function') {
    onError(new Error('Global fetch is not available in this environment'));
    return;
  }

  fetch(url, { method, headers, body })
    .then(async (res) => {
      if (typeof onResponse === 'function') {
        onResponse({
          status: res.status || 0,
          headers: res.headers || {}
        });
      }

      // 没有 body（例如 204）直接结束
      if (!res.body) {
        onEnd();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');

      // 循环读取流直到 done
      // 用 async IIFE 形式启动，错误统一走 onError
      (async () => {
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              onEnd();
              return;
            }
            // value 是 Uint8Array，解码为字符串
            onData(decoder.decode(value, { stream: true }));
          }
        } catch (err) {
          onError(err);
        }
      })();
    })
    .catch((err) => onError(err));
}

export { browserAdapter };