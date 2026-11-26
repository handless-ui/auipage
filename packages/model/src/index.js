import completions from "./completions.js";

// #doc:ctor
function Model(fields) {
    this.model = fields.model;
    this.apiKey = fields.apiKey;
    this.baseURL = fields.baseURL;
// #end
}

Model.prototype.completions = completions;

export { Model };
