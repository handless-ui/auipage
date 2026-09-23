import { fetch } from "@auipage/fetch";

let doit = (url, method, data) => {
    return new Promise(function (resolve, reject) {

        let options = {
            url,
            method,
            headers: {
                "Content-Type": "application/json",
            }
        };

        if (data) options.body = JSON.stringify(data);

        fetch(options).then(res => {
            let data = "";
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve(JSON.parse(data));
            });
        });
    });
};

export let $remote = {
    get(url) {
        return doit(url, "GET");
    },
    post(url, data) {
        return doit(url, "POST", data);
    },
    patch(url, data) {
        return doit(url, "PATCH", data);
    },
    delete(url) {
        return doit(url, "DELETE");
    }
};