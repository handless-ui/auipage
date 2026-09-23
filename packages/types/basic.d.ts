/**
 * 通用基础类型，与具体业务协议无关。
 */

/** 可被 JSON 序列化的值 */
export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

/** 键为字符串、值为 JSON 可序列化类型的对象 */
export interface JsonObject {
    [key: string]: JsonValue;
}

/** 同步值或 Promise：工具执行、适配器回调等场景两者都允许 */
export type MaybePromise<T> = T | Promise<T>;
