import { initOption } from "oipage/web/option/index.js";
import { EmptyFunction } from "./tools/enum.js";

const DEFAUTL_OPTIONS = {
    load: EmptyFunction,
    append: EmptyFunction
};

function MessageHistoryAdapter(options) {
    this.name="MessageHistoryAdapter";

    let value = initOption(options, { ...DEFAUTL_OPTIONS });
    for (let key in DEFAUTL_OPTIONS) {
        this[key] = value[key];
    }
}

export default MessageHistoryAdapter;