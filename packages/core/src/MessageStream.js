import { EmptyFunction } from "./tools/enum.js";

function MessageStream(send, end) {
    this.send = send || EmptyFunction;
    this.end = end || EmptyFunction;
}

export default MessageStream;