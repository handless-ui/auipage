// Response：暴露 on/off 事件机制，承载 status / headers / 流式 data/end/error
import { Emitter } from './emitter.js';

class Response extends Emitter {
  constructor() {
    super();
    this.status = 0;
    this.headers = {};
    this.ok = false;
    this._done = false; // 标记是否已经 end/error，防止重复触发
    this._sseMode = false; // SSE 模式：按 \n\n 分割事件，提取 data: 字段原始字符串
    this._sseBuffer = ''; // SSE 缓冲区，处理 chunk 边界
  }

  // 提供一个统一入口让 adapter 推数据，屏蔽 Emitter 的细节
  _push(type, payload) {
    if (this._done && type !== 'error') return;

    // SSE 模式：缓冲 + 按 \n\n 分割，提取 data: 字段原始字符串
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
    if (type === 'error') this._done = true;

    this.emit(type, payload);
  }

  // 从一个 SSE 事件块中提取 data: 字段内容（去掉前缀，多行用 \n 拼接）
  _extractSSEData(raw) {
    const dataLines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.replace(/^data:\s*/, ''));
      }
    }
    if (dataLines.length === 0) return null;
    return dataLines.join('\n');
  }
}

export { Response };