/**
 * 模型服务配置，由 @auipage/model 透传给大模型服务。
 */
export interface ModelConfig {
    /** 模型名称，例如 "gpt-4o-mini"、"deepseek-chat" */
    model: string;
    /** 模型服务签发的 API Key */
    apiKey: string;
    /** 模型服务基础地址，请求时拼接 /chat/completions，例如 "https://api.openai.com/v1" */
    baseURL: string;
}
