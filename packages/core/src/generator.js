export default async function* (rawFun) {

    // 已产出但尚未被消费的值缓冲
    const queue = [];
    // 当前等待消费者请求的 Promise 控制器；同时最多一个
    let pending = null;
    // 生产者是否已结束
    let ended = false;
    // 生产者是否已报错；一旦设置，后续 next/done 调用被忽略
    let errored = null;

    // 启动生产者，三个回调驱动数据流
    rawFun(
        // next：推送下一个值
        (value) => {
            if (errored) return;
            if (pending) {
                // 有等待中的消费者，立刻交值
                pending.resolve({ value, done: false });
                pending = null;
            } else {
                // 否则入队缓存
                queue.push(value);
            }
        },
        // done：结束
        () => {
            if (errored) return;
            ended = true;
            if (pending) {
                pending.resolve({ value: void 0, done: true });
                pending = null;
            }
        },
        // error：异常
        (err) => {
            errored = err;
            if (pending) {
                pending.reject(err);
                pending = null;
            }
        }
    );

    // 消费者主循环
    while (true) {
        if (errored) throw errored;
        // 优先消费缓冲
        if (queue.length) {
            yield queue.shift();
            continue;
        }
        // 缓冲空且生产者已结束 → 终止迭代
        if (ended) return;
        // 缓冲空且未结束 → 挂起等待生产者回调唤醒
        const result = await new Promise((resolve, reject) => {
            pending = { resolve, reject };
        });
        // 被唤醒后再判一次 error，防止回调已设 errored 但未分发
        if (errored) throw errored;
        if (result.done) return;
        yield result.value;
    }
}
