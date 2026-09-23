import { initOption } from "oipage/web/option/index.js";
import { EmptyFunction } from "./tools/enum.js";

const DEFAUTL_OPTIONS = {
    init: EmptyFunction,
    append: EmptyFunction,
};

function ChatContentRuntime(options) {
    this.name="ChatContentRuntime";

    let value = initOption(options, { ...DEFAUTL_OPTIONS });
    for (let key in DEFAUTL_OPTIONS) {
        this[key] = value[key];
    }
}

export default ChatContentRuntime;
