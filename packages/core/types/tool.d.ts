/**
 * 页面侧（前端）工具定义
 */
import type {
    MaybePromise,
    ToolCallStatus,
    ToolDescription,
    ToolExecutor
} from "@auipage/types";

/** render 收到的数据：入参、execute 的执行结果与状态，以及工具事件上的其它字段 */
export interface ToolRenderData {
    /** 模型解析出的入参 */
    args: Record<string, unknown>;
    /** execute 的执行结果（异常时为错误对象） */
    result: unknown;
    /** execute 的执行状态 */
    status: ToolCallStatus;
    [key: string]: unknown;
}

/**
 * UI 交互函数：execute 完成后调用，可在页面上完成弹窗、表单补充等交互；
 * 其返回值（可 Promise）才是最终回传给模型的结果。
 */
export type ToolRender = (data: ToolRenderData) => MaybePromise<unknown>;

/**
 * 注册到 AuiPage 的工具。
 * execute / render 均可缺省，但缺省 execute 的工具只有在
 * @auipage/agent 的 CreateTool 前后端桥接场景下才能正常工作。
 */
export interface Tool {
    description: ToolDescription;
    execute?: ToolExecutor;
    render?: ToolRender;
}

/** defineTool 的平铺入参 */
export interface DefineToolOptions {
    /** 工具名，对应 description.function.name */
    name: string;
    /** 给模型看的功能描述 */
    description: string;
    /** 入参 JSON Schema */
    parameters: Record<string, unknown>;
    /** 页面侧执行函数 */
    execute?: ToolExecutor;
    /** UI 交互函数 */
    render?: ToolRender;
}
