import { initOption } from "oipage/web/option/index.js";
import { EmptyFunction } from "./tools/enum.js";

// #doc:ctor
const DEFAUTL_OPTIONS = {
    run: EmptyFunction,
    response: EmptyFunction,
};

// #end

function ChatTransportAdapter(options) {
    this.name="ChatTransportAdapter";

    // #doc:merge
    let value = initOption(options, { ...DEFAUTL_OPTIONS });
    for (let key in DEFAUTL_OPTIONS) {
        this[key] = value[key];
    }
    // #end
}

export default ChatTransportAdapter;