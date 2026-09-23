import completions from "./completions.js";

function Model(fields) {
    this.model = fields.model;
    this.apiKey = fields.apiKey;
    this.baseURL = fields.baseURL;
}

Model.prototype.completions = completions;

export { Model };
