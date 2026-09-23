import { initOption } from "oipage/web/option/index.js";
import { EmptyFunction } from "./tools/enum.js";

const DEFAUTL_OPTIONS = {
    run: EmptyFunction,
    response: EmptyFunction,
};

function ChatTransportAdapter(options) {
    this.name="ChatTransportAdapter";

    let value = initOption(options, { ...DEFAUTL_OPTIONS });
    for (let key in DEFAUTL_OPTIONS) {
        this[key] = value[key];
    }
}

export default ChatTransportAdapter;