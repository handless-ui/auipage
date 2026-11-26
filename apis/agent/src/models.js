// 模型工厂：真实配置走 @auipage/model 的 Model，演示配置走本地 DemoModel
import { Model } from "@auipage/model/src/index.js";
import { DemoModel } from "./demo.js";

export function createModel(provider) {
    if (provider && provider.protocol === "demo") return new DemoModel(provider);
    return new Model({
        model: provider.model,
        apiKey: provider.apiKey,
        baseURL: provider.baseURL
    });
}

export function describeProvider(provider) {
    if (!provider) return "未配置模型";
    if (provider.protocol === "demo") return "演示模式 · 不联网";
    return provider.model + " · " + shortHost(provider.baseURL);
}

function shortHost(url) {
    try {
        return new URL(url).host;
    } catch (e) {
        return String(url || "").replace(/^https?:\/\//, "").split("/")[0];
    }
}
