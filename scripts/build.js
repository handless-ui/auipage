const { readdirSync } = require("fs");
const { join } = require("path");
const { readJSON, writeJSON,writePlain } = require("oipage/nodejs/disk/index.js");
const { rollup } = require("rollup");
const rollupConfig = require("./rollup.config.js");

for (let pkgName of readdirSync(join(__dirname, "../packages"))) {
    const pkgJSON = readJSON(join(__dirname, `../packages/${pkgName}/package.json`));
    if (pkgJSON.main) {

        rollup({
            input: join(__dirname, `../packages/${pkgName}/src/index.js`),
            plugins: rollupConfig.plugins
        }).then(bundle => {

            bundle.write({
                name: "auipage_" + pkgName,
                format: rollupConfig.output.format,
                banner: `/*! @auipage/${pkgName} v${pkgJSON.version} */`,
                file: join(__dirname, `../packages/${pkgName}/dist/index.js`)
            });

            writeJSON(join(__dirname, `../packages/${pkgName}/dist/package.json`), {
                "type": "commonjs"
            });

            writePlain(join(__dirname, `../packages/${pkgName}/dist/index.d.ts`), `export * from '../types/index'`);
        });

    }
}