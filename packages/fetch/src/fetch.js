// fetch 工厂：注入 adapter，返回对外的 fetch 函数
import { Response } from './response.js';

function createFetch(adapter) {
  return function fetch(options) {
    // 必须返回 Promise<response>，让调用方能 .then(res => res.on(...))
    return new Promise((resolve, reject) => {
      if (!options || !options.url) {
        reject(new Error('fetch: options.url is required'));
        return;
      }

      const response = new Response();

      // adapter 调用前先把 response 交出去，确保 .then(res => ...) 里能立刻 on(...) 注册监听
      // 用 queueMicrotask 推后一拍，避免同步 resolve 后用户立刻注册的监听错过首个 data
      queueMicrotask(() => resolve(response));

      adapter(options, {
        onResponse(meta) {
          if (meta && typeof meta.status === 'number') {
            response.status = meta.status;
            response.ok = meta.status >= 200 && meta.status < 300;
          }
          if (meta && meta.headers) {
            response.headers = meta.headers;

            // 自动检测 SSE：浏览器 Headers 对象用 get()，Node 的 plain object 用 []
            const contentType =
              (typeof meta.headers.get === 'function' && meta.headers.get('content-type')) ||
              meta.headers['content-type'] ||
              '';
            if (contentType.includes('text/event-stream')) {
              response._sseMode = true;
            }
          }
        },
        onData(chunk) {
          response._push('data', chunk);
        },
        onEnd() {
          response._push('end');
        },
        onError(err) {
          // 错误同时通过 error 事件 和 catch 暴露，避免遗漏
          response._push('error', err);
          reject(err);
        }
      });
    });
  };
}

export { createFetch };