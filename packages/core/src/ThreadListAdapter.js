import { initOption } from "oipage/web/option/index.js";
import { EmptyFunction } from "./tools/enum.js";

const DEFAUTL_OPTIONS = {
    list: EmptyFunction,
    new: EmptyFunction,
    archive: EmptyFunction,
    unarchive: EmptyFunction,
    delete: EmptyFunction
};

function ThreadListAdapter(options) {
    this.name="ThreadListAdapter";

    let value = initOption(options, { ...DEFAUTL_OPTIONS });
    for (let key in DEFAUTL_OPTIONS) {
        this[key] = value[key];
    }
}

export default ThreadListAdapter;