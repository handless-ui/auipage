const pluginNodeResolve = require("@rollup/plugin-node-resolve")
const pluginCommonjs = require("@rollup/plugin-commonjs")

module.exports = {
    output: {
        format: "umd"
    },
    plugins: [
        pluginNodeResolve(),
        pluginCommonjs()
    ]
}
