import { EmptyFunction } from "./tools/enum.js";

// #doc:ctor
function MessageStream(send, end) {
    this.send = send || EmptyFunction;
    this.end = end || EmptyFunction;
}
// #end

export default MessageStream;