/**
 * 适配器（Adapter）类型入口：负责对接模型 / 存储等外部世界
 */

export {
    ChatTransportAdapter,
    type ChatTransportAdapterOptions,
    type ChatTransportRun,
    type ChatTransportRunParams,
    type ChatTransportResponse
} from "./chat-transport.js";

export {
    MessageHistoryAdapter,
    type MessageHistoryAdapterOptions,
    type MessageHistoryLoad,
    type MessageHistoryAppend
} from "./message-history.js";

export {
    ThreadListAdapter,
    type ThreadListAdapterOptions,
    type ThreadListList,
    type ThreadListNew,
    type ThreadIdHandler
} from "./thread-list.js";
