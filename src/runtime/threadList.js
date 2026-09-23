import { ThreadListRuntime } from "@auipage/core";

// 对话列表视图
export default new ThreadListRuntime({
    init(threads) {
        browserjs("#thread-list-id")[0].innerHTML = "";

        let threadId;
        for (let index = 0; index < threads.length; index++) {
            threadId = this.append(threads[index]) || threadId;
        }
        if (threadId) this.aui.activeThread(threadId);
    },
    active(threadId) {
        browserjs(".thread-item").removeClass("active");
        browserjs("#thread-" + threadId).addClass("active");
    },
    delete(threadId) {
        browserjs("#thread-" + threadId).remove();
    },
    archive(threadId) {
        browserjs("#thread-" + threadId).attr({
            status: "archived"
        });
    },
    unarchive(threadId) {
        browserjs("#thread-" + threadId).attr({
            status: "regular"
        });
    },
    append(thread) {
        let aui = this.aui;
        let rootEl = browserjs("#thread-list-id");

        let itemEl = browserjs(`<div class="thread-item" id="thread-${thread.threadId}">${thread.title}</div>`).attr({
            status: thread.status
        }).prependTo(rootEl);

        browserjs("<button>删除</button>").appendTo(itemEl).bind("click", function (event) {
            event.stopPropagation();
            aui.deleteThread(thread.threadId);
        });

        browserjs("<button>归档</button>").attr({
            class: "archived"
        }).appendTo(itemEl).bind("click", function (event) {
            event.stopPropagation();
            aui.archiveThread(thread.threadId);
        });

        browserjs("<button>取消归档</button>").attr({
            class: "unarchive"
        }).appendTo(itemEl).bind("click", function (event) {
            event.stopPropagation();
            aui.unarchiveThread(thread.threadId);
        });

        itemEl.bind("click", function () {
            if (itemEl.attr("status") === "regular") aui.activeThread(thread.threadId);
        });

        // 归档的不被选中
        if (thread.status === "regular") return thread.threadId;
    }
});