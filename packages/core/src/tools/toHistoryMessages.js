export default function (value) {

    let messages = [], index = -1;
    for (let message of value.messages || []) {

        if (index != -1 && messages[index].role === message.role) {
            // 复制内容数组，避免改写入参消息对象
            messages[index].content.push(...message.content);
        } else {
            messages.push(Object.assign({}, message, { content: (message.content || []).slice() }));
            index = messages.length - 1;
        }
    }

    value.messages = messages;
    return value;
}
