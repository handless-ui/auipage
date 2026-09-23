/**
 * generator：把 next / done / error 回调式异步流程转换为 AsyncGenerator
 */

/** 推送下一个值 */
export type StreamNext<T> = (value: T) => void;
/** 标记生产者结束 */
export type StreamDone = () => void;
/** 标记生产者异常 */
export type StreamError = (err: unknown) => void;

/** 生产者函数：立即执行，通过三个回调驱动数据流 */
export type StreamProducer<T> = (
    next: StreamNext<T>,
    done: StreamDone,
    error: StreamError
) => void;

/**
 * @param rawFun 生产者函数，接收 next / done / error 三个回调
 * @returns 按推送顺序产出值的异步生成器
 */
declare function generator<T>(
    rawFun: StreamProducer<T>
): AsyncGenerator<T, void, void>;

export default generator;
