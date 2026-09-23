import { readdirSync } from "fs";
import { readJSON, writeJSON, copyDisk } from "oipage/nodejs/disk/index.js";

const version = readJSON("./package.json").version;
readdirSync("./packages").forEach(function (pkgName) {
    if ([".DS_Store"].indexOf(pkgName) !== -1) {
        return;
    }

    const content = readJSON("./packages/" + pkgName + "/package.json");
    content.version = version;

    writeJSON("./packages/" + pkgName + "/package.json", content);

    ["AUTHORS.txt", "CHANGELOG", ".mailmap"].forEach(function (fileName) {
        copyDisk("./" + fileName, "./packages/" + pkgName + "/" + fileName, true);
    });
});
