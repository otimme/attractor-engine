import type { ToolDefinition } from "unified-llm";
import type { ExecutionEnvironment } from "../types/index.js";
import type { ProviderProfile } from "../types/index.js";
import { ToolRegistry } from "../types/index.js";
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createShellTool,
  createGrepTool,
  createGlobTool,
} from "../tools/core-tools.js";
import { ANTHROPIC_BASE_PROMPT } from "./prompts/anthropic-base.js";
import {
  buildEnvironmentContext,
  buildSystemPrompt,
} from "./system-prompt.js";

export function createAnthropicProfile(model: string): ProviderProfile {
  const registry = new ToolRegistry();
  registry.register(createReadFileTool());
  registry.register(createWriteFileTool());
  registry.register(createEditFileTool());
  registry.register(
    createShellTool({ defaultTimeoutMs: 120_000, maxTimeoutMs: 600_000 }),
  );
  registry.register(createGrepTool());
  registry.register(createGlobTool());

  return {
    id: "anthropic",
    model,
    toolRegistry: registry,

    buildSystemPrompt(
      environment: ExecutionEnvironment,
      projectDocs: string,
    ): string {
      const envContext = buildEnvironmentContext(environment);
      const toolDescs = registry
        .definitions()
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
      return buildSystemPrompt(
        ANTHROPIC_BASE_PROMPT,
        envContext,
        toolDescs,
        projectDocs,
      );
    },

    tools(): ToolDefinition[] {
      return registry.definitions();
    },

    providerOptions(): Record<string, Record<string, unknown>> | null {
      return null;
    },

    supportsReasoning: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    contextWindowSize: 200_000,
  };
}
