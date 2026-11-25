import { ChatContentRuntime } from "@auipage/core";

// 片段 → 节点：取消时按 task:end 的 displayed 找出本次新增的节点
const partsMap = new WeakMap();

export default new ChatContentRuntime({

    // 初始化历史消息
    init(messages) {
        let rootEl = browserjs("#message-list-id");
        rootEl[0].innerHTML = "";

        messages.forEach(message => {
            message.content.forEach(content => {

                if (content.type === "text") {
                    browserjs("<div>" + content.text + "</div>").css({
                        padding: "12px 16px",
                        marginBottom: "8px",
                        borderRadius: message.role === "user" ? "10px 10px 0 10px" : "10px 10px 10px 0",
                        backgroundColor: message.role === "user" ? "#3b82f6" : "#f3f4f6",
                        color: message.role === "user" ? "white" : "black",
                        maxWidth: "70%",
                        width: "fit-content",
                        marginLeft: message.role === "user" ? "auto" : "0",
                    }).appendTo(rootEl).scrollTop();
                }

            });
        });
    },

    // 追加消息
    append(role, content) {
        let rootEl = browserjs("#message-list-id");
        let el;

        // 加载中
        if (content.type === "loading") {
            el = browserjs("<div class='must-last'>" + content.text + "</div>").css({
                padding: "10px",
                color: "gray"
            }).appendTo(rootEl).scrollTop();
        }

        // 思考中
        else if (content.type === "thinking") {
            el = browserjs("<div class='must-last'>" + content.text + "</div>").css({
                maxHeight: "100px",
                overflow: "auto",
                borderRadius: "10px",
                padding: "5px",
                color: "#3F51B5",
                fontSize: "14px"
            }).appendTo(rootEl).scrollTop();

            partsMap.set(content, el[0]);

            return function stream(text) {
                el[0].innerHTML += text;
                el[0].scrollTop = el[0].scrollHeight;
            };
        }

        // 文本消息
        else if (content.type === "text") {
            el = browserjs("<div>" + content.text + "</div>").css({
                padding: "12px 16px",
                marginBottom: "8px",
                borderRadius: role === "user" ? "10px 10px 0 10px" : "10px 10px 10px 0",
                backgroundColor: role === "user" ? "#3b82f6" : "#f3f4f6",
                color: role === "user" ? "white" : "black",
                maxWidth: "70%",
                width: "fit-content",
                marginLeft: role === "user" ? "auto" : "0",
            }).appendTo(rootEl).scrollTop();
        }

        // 工具
        else if (content.type === "tool-call") {
            return function stream(data) {

                // 有 render 的时候，需要 render 返回值
                if (data.render) {
                    return data.render(data);
                }

            };
        }

        if (el) partsMap.set(content, el[0]);
    },

    // 取消后按 displayed 移除本次新增的节点；要不要撤销、撤哪几条，由业务自己决定
    removeByParts(displayed) {
        (displayed || []).forEach(({ part }) => {
            const el = partsMap.get(part);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
    }

});
