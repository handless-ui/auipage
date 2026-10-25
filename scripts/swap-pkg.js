const { join } = require("path");
const { readJSON, writeJSON } = require("oipage/nodejs/disk/index.js");

function parseArgs(argv) {
    const arg = argv.find(a => typeof a === 'string' && a.startsWith('--mode='));
    return arg ? arg.split('=')[1] : null;
}

const pkgPath = join(process.cwd(), './package.json');
const pkgValue = readJSON(pkgPath);
const isPublish = parseArgs(process.argv.slice(2)) === "publish";

const version = readJSON(join(__dirname, "../package.json")).version;
for (let itemName in pkgValue.dependencies) {
    if (itemName.startsWith("@auipage/")) {
        pkgValue.dependencies[itemName] = isPublish ? "^" + version : "workspace:^";
    }
}

writeJSON(pkgPath, pkgValue);
