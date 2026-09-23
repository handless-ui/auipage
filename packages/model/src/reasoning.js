// 解析 LLM 返回的推理内容（reasoning / reasoning_content）
// 将 <think>...</think> 形式的内容从 delta.content 中剥离出来
export default function parseReasoning(reasoning, content) {
    if (!/<\/think>/.test(reasoning)) return reasoning;

    const parts = reasoning.split("</think>");
    const thinkPart = parts[0].replace("<think>", "");
    return {
        reasoning: thinkPart,
        content: thinkPart[1] + (content || "")
    };
}
