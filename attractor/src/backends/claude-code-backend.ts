import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Node } from "../types/graph.js";
import type { Outcome } from "../types/outcome.js";
import type { BackendRunOptions } from "../types/handler.js";
import { getStringAttr } from "../types/graph.js";
import { CliAgentBackend } from "./cli-backend.js";
import type { CliAgentConfig } from "./cli-backend.js";

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClaudeUsageReport {
  nodeId: string;
  cost_usd: number;
  usage: ClaudeUsage;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
}

export class ClaudeCodeBackend extends CliAgentBackend {
  /**
   * Maps thread IDs to Claude Code session IDs.
   * First node in a thread starts a new session; subsequent nodes resume it via --resume.
   */
  private readonly sessionsByThread = new Map<string, string>();

  constructor(config?: Partial<CliAgentConfig>) {
    super({
      command: config?.command ?? "claude",
      defaultArgs: config?.defaultArgs ?? ["--print", "--output-format", "json"],
      env: config?.env,
      timeoutMs: config?.timeoutMs,
      cwd: config?.cwd,
    });
  }

  protected buildArgs(
    _prompt: string,
    node: Node,
    options?: BackendRunOptions,
  ): string[] {
    const args = [...(this.config.defaultArgs ?? [])];

    const model = getStringAttr(node.attributes, "llm_model");
    if (model !== "") {
      args.push("--model", model);
    }

    // Resume an existing session if this thread already has one
    if (options?.threadId) {
      const existingSessionId = this.sessionsByThread.get(options.threadId);
      if (existingSessionId) {
        args.push("--resume", existingSessionId);
      }
    }

    return args;
  }

  protected override parseResponse(
    stdout: string,
    stderr: string,
    node: Node,
    options?: BackendRunOptions,
  ): string | Outcome {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      // If JSON parsing fails, fall back to treating stdout as plain text
      return stdout;
    }

    // Extract the text result
    const result = typeof parsed["result"] === "string" ? parsed["result"] : stdout;

    // Capture session ID for thread continuity (--resume on subsequent nodes)
    const sessionId = typeof parsed["session_id"] === "string" ? parsed["session_id"] : undefined;
    if (sessionId && options?.threadId) {
      this.sessionsByThread.set(options.threadId, sessionId);
    }

    // Extract usage data and write to disk
    const usage = parsed["usage"] as ClaudeUsage | undefined;
    const costUsd = typeof parsed["total_cost_usd"] === "number" ? parsed["total_cost_usd"] : 0;
    const durationMs = typeof parsed["duration_ms"] === "number" ? parsed["duration_ms"] : 0;
    const durationApiMs = typeof parsed["duration_api_ms"] === "number" ? parsed["duration_api_ms"] : 0;
    const numTurns = typeof parsed["num_turns"] === "number" ? parsed["num_turns"] : 0;

    if (options?.logsRoot) {
      const stageDir = join(options.logsRoot, node.id);
      mkdirSync(stageDir, { recursive: true });

      const report: ClaudeUsageReport = {
        nodeId: node.id,
        cost_usd: costUsd,
        usage: usage ?? { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        duration_ms: durationMs,
        duration_api_ms: durationApiMs,
        num_turns: numTurns,
      };

      writeFileSync(join(stageDir, "usage.json"), JSON.stringify(report, null, 2));
    }

    return result;
  }
}
