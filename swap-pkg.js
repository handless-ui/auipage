import { join, dirname } from "path";
import { fileURLToPath } from 'url';
import { readJSON, writeJSON } from "oipage/nodejs/disk/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs(argv) {
    const arg = argv.find(a => typeof a === 'string' && a.startsWith('--mode='));
    return arg ? arg.split('=')[1] : null;
}

const pkgPath = join(process.cwd(), './package.json');
const pkgValue = readJSON(pkgPath);
const isPublish = parseArgs(process.argv.slice(2)) === "publish";

const version = readJSON(join(__dirname, "./package.json")).version;
for (let itemName in pkgValue.dependencies) {
    if (itemName.startsWith("@auipage/")) {
        pkgValue.dependencies[itemName] = isPublish ? "^" + version : "workspace:^";
    }
}

writeJSON(pkgPath, pkgValue);
