/**
 * toModelMessages：把页面侧历史消息（富片段）转换为模型线上消息
 */
import type { ChatMessage } from "@auipage/types";
import type { ChatContentMessage, HistoryMessageGroup } from "./message.js";

/**
 * @param input 历史消息组数组或消息数组
 * @returns 可直接作为 completions.messages 的数组
 */
declare function toModelMessages(
    input: Array<HistoryMessageGroup | ChatContentMessage>
): ChatMessage[];

export default toModelMessages;
