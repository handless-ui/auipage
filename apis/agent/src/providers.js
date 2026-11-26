// 模型服务配置：默认种子 + 本地持久化（增删改由设置页驱动）

const KEY = "auipage.docs.agent.v1.providers";

export const DEMO_ID = "demo";
export const OLLAMA_ID = "ollama-local";

function seed() {
    return {
        schema: 1,
        activeId: DEMO_ID,
        list: [
            {
                id: OLLAMA_ID,
                name: "Ollama 本地",
                protocol: "openai",
                builtin: false,
                readonly: false,
                baseURL: "http://localhost:11434/v1",
                model: "qwen3.5",
                apiKey: "",
                temperature: 0.7,
                topP: 1,
                maxTokens: 2048,
                timeout: 60000,
                tools: true,
                description: "本机推理，零数据外传"
            },
            {
                id: DEMO_ID,
                name: "本地模型（演示）",
                protocol: "demo",
                builtin: true,
                readonly: true,
                model: "auipage-demo",
                description: "无需联网与密钥，用预置脚本演示完整对话与工具流程"
            }
        ]
    };
}

function normalize(value) {
    if (!value || !Array.isArray(value.list) || !value.list.length) return seed();

    // 演示模型必须一直在：用户即使旧数据里没有它，也补回来
    if (!value.list.some((item) => item && item.id === DEMO_ID)) {
        value.list = value.list.concat(seed().list.filter((item) => item.id === DEMO_ID));
    }
    if (!value.list.some((item) => item && item.id === value.activeId)) {
        value.activeId = value.list[0].id;
    }
    value.schema = 1;
    return value;
}

export function loadProviders() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return seed();
        return normalize(JSON.parse(raw));
    } catch (e) {
        return seed();
    }
}

export function saveProviders(state) {
    try {
        localStorage.setItem(KEY, JSON.stringify(normalize(state)));
        return true;
    } catch (e) {
        // 隐私模式或配额满：不阻断对话，只在界面上提示
        return false;
    }
}

export function activeProvider(state) {
    const list = state.list || [];
    return list.find((item) => item.id === state.activeId) || list[0];
}

export function setActive(state, id) {
    if (!(state.list || []).some((item) => item.id === id)) return state;
    state.activeId = id;
    saveProviders(state);
    return state;
}

export function isDemo(provider) {
    return !!provider && provider.protocol === "demo";
}

export function newProviderId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 新增或就地更新一条配置（编辑时保留 id）
export function upsertProvider(state, input) {
    const item = {
        id: input.id || newProviderId(),
        name: String(input.name || "").trim() || "自定义模型",
        protocol: "openai",
        builtin: false,
        readonly: false,
        baseURL: String(input.baseURL || "").trim(),
        model: String(input.model || "").trim(),
        apiKey: String(input.apiKey || ""),
        temperature: Number(input.temperature) || 0,
        topP: Number(input.topP) || 1,
        maxTokens: Number(input.maxTokens) || 2048,
        timeout: Number(input.timeout) || 60000,
        tools: input.tools !== false,
        description: "浏览器直连的自定义服务"
    };

    const index = (state.list || []).findIndex((one) => one && one.id === item.id);
    if (index >= 0) {
        const old = state.list[index];
        if (old.readonly) return state;
        state.list[index] = item;
    } else {
        state.list.push(item);
    }
    saveProviders(state);
    return state;
}

export function removeProvider(state, id) {
    const target = (state.list || []).find((one) => one && one.id === id);
    if (!target || target.readonly) return state;
    state.list = state.list.filter((one) => one.id !== id);
    if (state.activeId === id) state.activeId = DEMO_ID;
    saveProviders(state);
    return state;
}
