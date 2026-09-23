// 极简 EventEmitter：on / off / emit，供 Response 复用
class Emitter {
  constructor() {
    this._events = Object.create(null);
  }

  on(event, listener) {
    if (typeof listener !== 'function') return this;
    const list = this._events[event] || (this._events[event] = []);
    list.push(listener);
    return this;
  }

  off(event, listener) {
    const list = this._events[event];
    if (!list) return this;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) delete this._events[event];
    return this;
  }

  emit(event, ...args) {
    const list = this._events[event];
    if (!list || list.length === 0) return false;
    // 复制一份再触发，避免 off 回调过程中影响本次派发
    for (const fn of list.slice()) {
      try {
        fn.apply(null, args);
      } catch (e) {
        // 单个监听器异常不影响其它监听器
        // 用 queueMicrotask 抛到全局，避免污染 emit 调用栈
        queueMicrotask(() => { throw e; });
      }
    }
    return true;
  }
}

export { Emitter };