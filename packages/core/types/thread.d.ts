/**
 * 会话（Thread）对象约定
 */

export interface Thread {
    /** 会话唯一 ID，AuiPage 内部依赖此字段 */
    threadId: string;
    /** 会话标题，通常取首轮用户消息的前缀 */
    title?: string;
    /** 是否归档 */
    archived?: boolean;
    /** 其它业务自定义字段 */
    [key: string]: unknown;
}
