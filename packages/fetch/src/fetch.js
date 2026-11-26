// fetch 工厂：注入 adapter，返回对外的 fetch 函数
import { Response } from './response.js';

// 只有普通对象才自动 JSON 序列化，ArrayBufferView / Blob / FormData 等保持原样
function isPlainBody(body) {
  return Object.prototype.toString.call(body) === '[object Object]';
}

function createFetch(adapter) {
  // #doc:factory
  return function fetch(options) {
    // 必须返回 Promise<response>，让调用方能 .then(res => res.on(...))
    return new Promise((resolve, reject) => {
      if (!options || !options.url) {
        reject(new Error('fetch: options.url is required'));
        return;
      }

      // 请求体是普通对象时自动序列化，避免 Node 端 req.write(object) 抛 TypeError
      if (isPlainBody(options.body)) {
        options = Object.assign({}, options, { body: JSON.stringify(options.body) });
      }

      const response = new Response();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer = null;
      let failed = false;

      response._cancel = () => { if (controller) controller.abort(); };

      // adapter 调用前先把 response 交出去，确保 .then(res => ...) 里能立刻 on(...) 注册监听
      // 用 queueMicrotask 推后一拍，避免同步 resolve 后用户立刻注册的监听错过首个 data
      queueMicrotask(() => resolve(response));
  // #end

      const clearTimer = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      // #doc:hooks
      const hooks = {
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

          // 非 2xx 单独通知：不占用 error 事件、不锁 _done，错误体照常投递
          if (response.status >= 400) {
            response.emit('http-error', { status: response.status, headers: response.headers });
          }
        },
        onData(chunk) {
          response._push('data', chunk);
        },
        onEnd() {
          clearTimer();
          response._push('end');
        },
        onError(err) {
          if (failed) return;
          failed = true;
          clearTimer();
          // 错误同时通过 error 事件 和 catch 暴露，避免遗漏
          response._push('error', err);
          reject(err);
        }
      };
      // #end

      // #doc:abort
      const abortWith = (err) => {
        if (controller) controller.abort();
        hooks.onError(err);
      };

      // 超时：到点先中断底层请求，再走统一错误通道
      if (options.timeout > 0) {
        timer = setTimeout(() => {
          timer = null;
          abortWith(new Error('fetch: 请求超时（' + options.timeout + 'ms）'));
        }, options.timeout);
      }

      // 外部 signal
      if (options.signal) {
        if (options.signal.aborted) {
          abortWith(new Error('fetch: 请求已取消'));
          return;
        }
        options.signal.addEventListener('abort', () => {
          abortWith(new Error('fetch: 请求已取消'));
        });
      }

      // 把内部 controller 的 signal 交给 adapter，adapter 可据此中断底层请求
      const requestOptions = controller ? Object.assign({}, options, { signal: controller.signal }) : options;

      let ret;
      try {
        ret = adapter(requestOptions, hooks);
      } catch (err) {
        hooks.onError(err);
        return;
      }
      // adapter 允许返回 Promise，失败也要走同一条错误通道
      if (ret && typeof ret.then === 'function') ret.then(null, hooks.onError);
      // #end
    });
  };
}

export { createFetch };
