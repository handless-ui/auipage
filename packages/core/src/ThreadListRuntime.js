import { initOption } from "oipage/web/option/index.js";
import { EmptyFunction } from "./tools/enum.js";

const DEFAUTL_OPTIONS = {
    init: EmptyFunction,
    active: EmptyFunction,
    delete: EmptyFunction,
    archive: EmptyFunction,
    unarchive: EmptyFunction,
    append: EmptyFunction,
};

function ThreadListRuntime(options) {
    this.name="ThreadListRuntime";
    
    let value = initOption(options, { ...DEFAUTL_OPTIONS });
    for (let key in DEFAUTL_OPTIONS) {
        this[key] = value[key];
    }
}

export default ThreadListRuntime;
