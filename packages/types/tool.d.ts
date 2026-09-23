/**
 * 工具（Function Calling）协议。
 *
 * 模型通过 ToolDescription 感知工具；运行时的工具对象 Tool 还可以携带
 * execute（执行）与 render（页面交互），被 @auipage/agent、@auipage/core 共同消费。
 */

import type { MaybePromise } from "./basic.js";

/** 入参 JSON Schema，结构遵循模型侧 tools 规范，这里保持宽松 */
export type JsonSchema = Record<string, unknown>;

/** tools[].function 的描述结构 */
export interface FunctionDescriptor {
    /** 工具名，模型据此发起调用，需全局唯一 */
    name: string;
    /** 告诉模型工具做什么、什么场景下使用 */
    description: string;
    /** 入参 JSON Schema */
    parameters: JsonSchema;
}

/** 提交给模型的工具描述（请求体 tools 数组的一项） */
export interface ToolDescription {
    type: "function";
    function: FunctionDescriptor;
}

/**
 * 工具执行函数：接收模型解析后的入参对象，
 * 返回任意可序列化值，也可以返回 Promise。
 */
export type ToolExecutor<
    TArgs extends Record<string, unknown> = Record<string, unknown>,
    TResult = unknown
> = (args: TArgs) => MaybePromise<TResult>;

/** 一次工具执行的终态（不存在 pending） */
export type ToolResultStatus = "success" | "error";

/** render 回调的入参：execute 的执行结果及其状态 */
export interface ToolRenderContext {
    /** 模型解析出的原始入参 */
    args: Record<string, unknown>;
    /** execute 的返回值；执行抛错时为错误对象 */
    result: unknown;
    /** execute 的执行状态 */
    status: ToolResultStatus;
}

/**
 * 页面交互函数：execute 完成后调用，可在页面上弹窗、补充表单等。
 * 返回值（可 Promise）才是最终回传给模型的结果。
 */
export type ToolRenderFunction = (context: ToolRenderContext) => MaybePromise<unknown>;

/**
 * 跨包共享的工具基类协议：仅约束 description 与可选 execute / render。
 *
 * 各消费方在本地有更细化的类型，不直接复用本接口：
 * - @auipage/agent 用本地 `AgentTool`（execute 必填，无 render）；
 * - @auipage/core 的 `defineTool` 返回本地 `Tool`（render 用 core 自定义的 `ToolRender`）；
 * - @auipage/agent 的 `CreateTool.create` 入参用本地 `CreateToolInput`（无 render 字段）。
 *
 * 这里的 `Tool` / `ToolRenderFunction` / `ToolRenderContext` 仅作为跨包参考协议保留，
 * 真正约束各消费方的类型以各包 `types/` 目录为准。
 */
export interface Tool {
    description: ToolDescription;
    execute?: ToolExecutor;
    render?: ToolRenderFunction;
}
