/**
 * 极简事件发射器（on / off / emit），Response 的基类
 */

export type EventListener<TPayload = unknown> = (payload: TPayload) => void;

export declare class Emitter {
    /** 注册事件监听，返回 this 以便链式调用 */
    on<TPayload = unknown>(event: string, listener: EventListener<TPayload>): this;
    /** 移除事件监听，返回 this 以便链式调用 */
    off(event: string, listener: EventListener): this;
    /** 派发事件；无监听者时返回 false */
    emit(event: string, ...args: unknown[]): boolean;
}
