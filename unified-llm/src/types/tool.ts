import type { Message } from "./message.js";

export interface ToolExecutionContext {
  messages: ReadonlyArray<Message>;
  abortSignal?: AbortSignal;
  toolCallId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute?: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<unknown> | unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
}

export interface ToolResult {
  toolCallId: string;
  content: string | Record<string, unknown> | unknown[];
  isError: boolean;
}

export type ToolChoice =
  | { mode: "auto" }
  | { mode: "none" }
  | { mode: "required" }
  | { mode: "named"; toolName: string };
