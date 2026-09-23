/**
 * Agent 直接执行的工具形态
 */
import type { ToolDescription, ToolExecutor } from "@auipage/types";

export interface AgentTool {
    /** 符合模型 tools 规范的描述对象 */
    description: ToolDescription;
    /**
     * 工具执行函数。
     * 注意：普通工具必须提供；只有经 CreateTool 桥接的“前端工具”
     * 才允许在创建时缺省（由 CreateTool.create 补齐 execute）。
     */
    execute: ToolExecutor;
}
