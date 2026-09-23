import { ThreadListAdapter } from "@auipage/core";
import { $remote } from "./tool.js";

// 对话列表管理
export default new ThreadListAdapter({

    // 查询会话列表
    async list() {
        return $remote.get("/api/threads");
    },

    // 新建会话
    // 会根据messages内容生成标题，然后返回一个新的会话数据
    async new(messages) {
        return $remote.post("/api/threads", messages);
    },

    // 归档
    async archive(threadId) {
        return $remote.patch(`/api/threads/${threadId}`, {
            status: "archived"
        });
    },

    // 取消归档
    async unarchive(threadId) {
        return $remote.patch(`/api/threads/${threadId}`, {
            status: "regular"
        });
    },

    // 删除
    async delete(threadId) {
        return $remote.delete(`/api/threads/${threadId}`);
    }

});