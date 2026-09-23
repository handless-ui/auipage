export default function (value) {

    let messages = [], index = -1;
    for (let message of value.messages) {

        if (index != -1 && messages[index].role === message.role) {
            messages[index].content.push(...message.content);
        } else {
            messages.push(message);
            index = messages.length - 1;
        }
    }

    value.messages = messages;
    return value;
}