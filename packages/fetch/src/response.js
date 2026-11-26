// Response：暴露 on/off 事件机制，承载 status / headers / 流式 data/end/error
import { Emitter } from './emitter.js';

class Response extends Emitter {
  constructor() {
    super();
    // #doc:state
    this.status = 0;
    this.headers = {};
    this.ok = false;
    this._done = false; // 标记是否已经 end/error，防止重复触发
    this._sseMode = false; // SSE 模式：按 \n\n 分割事件，提取 data: 字段原始字符串
    this._sseBuffer = ''; // SSE 缓冲区，处理 chunk 边界
    this._cancel = null; // 由 createFetch 注入，用于中断底层请求
    this._errorPending = null; // 消费者还没来得及注册时就发生的错误，注册后补发
    // #end
  }

  // 注册监听；error 是一次性终态，注册时若已发生则补发
  // #doc:replay
  on(event, listener) {
    super.on(event, listener);
    if (event === 'error' && this._errorPending) {
      const err = this._errorPending;
      this._errorPending = null;
      // 异步补发，避免在注册栈里同步回调
      queueMicrotask(() => this.emit('error', err));
    }
    return this;
  // #end
  }

  // 主动取消请求，失败统一从 error 事件返回
  cancel() {
    if (this._cancel) this._cancel();
    return this;
  }

  // 统一读取响应头：浏览器是 Headers 对象，Node 是普通对象
  header(name) {
    const headers = this.headers;
    if (!headers) return undefined;
    if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
    return headers[name];
  }

  // 提供一个统一入口让 adapter 推数据，屏蔽 Emitter 的细节
  _push(type, payload) {
    if (this._done && type !== 'error') return;

    // SSE 模式：缓冲 + 按 \n\n 分割，提取 data: 字段原始字符串
    // #doc:sse
    if (type === 'data' && this._sseMode) {
      this._sseBuffer += payload;

      // 按 \n\n 分割出完整事件，最后一段可能不完整
      const parts = this._sseBuffer.split(/\r{0,1}\n\r{0,1}\n/);
      this._sseBuffer = parts.pop();

      for (const part of parts) {
        const payload = this._extractSSEData(part);
        if (payload !== null) {
          this.emit('data', payload);
        }
      }
      return;
    // #end
    }

    if (type === 'end') {
      // SSE 模式下，flush 缓冲区残留
      if (this._sseMode && this._sseBuffer.trim()) {
        const payload = this._extractSSEData(this._sseBuffer);
        if (payload !== null) {
          this.emit('data', payload);
        }
        this._sseBuffer = '';
      }
      this._done = true;
    }
    if (type === 'error') {
      this._done = true;
      const listeners = this._events && this._events['error'];
      if (!listeners || listeners.length === 0) {
        // 消费者还没注册监听，先缓存，注册时补发
        this._errorPending = payload;
        return;
      }
    }

    this.emit(type, payload);
  }

  // 从一个 SSE 事件块中提取 data: 字段内容（去掉前缀，多行用 \n 拼接）
  // #doc:extract
  _extractSSEData(raw) {
    const dataLines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.replace(/^data:\s*/, '').replace(/\r$/, ''));
      }
    }
    if (dataLines.length === 0) return null;
    return dataLines.join('\n');
  // #end
  }
}

export { Response };
