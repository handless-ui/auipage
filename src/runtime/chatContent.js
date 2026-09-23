import { ChatContentRuntime } from "@auipage/core";

// 对话内容视图
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

        // 加载中
        if (content.type === "loading") {
            browserjs("<div class='must-last'>" + content.text + "</div>").css({
                padding: "10px",
                color: "gray"
            }).appendTo(rootEl).scrollTop();
        }

        // 思考中
        else if (content.type === "thinking") {
            let thinkingEl = browserjs("<div class='must-last'>" + content.text + "</div>").css({
                maxHeight: "100px",
                overflow: "auto",
                borderRadius: "10px",
                padding: "5px",
                color: "#3F51B5",
                fontSize: "14px"
            }).appendTo(rootEl).scrollTop();

            return function stream(text) {
                thinkingEl[0].innerHTML += text;
                thinkingEl.scrollTop();

                thinkingEl[0].scrollTop = thinkingEl[0].scrollHeight;
            }

        }

        // 文本消息
        else if (content.type === "text") {
            browserjs("<div>" + content.text + "</div>").css({
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

            console.log(content);

            return function stream(data) {

                // 有render的时候，需要render返回值
                if(data.render){
                    return data.render(data);
                }

            };

        }

    }

});