#!/usr/bin/env bun

/**
 * Dark Factory — Production Runner
 *
 * Runs the full Dark Factory pipeline with ClaudeCodeBackend (Claude Code CLI).
 * Requires Claude Code installed with an active Max subscription.
 *
 * Usage: bun run-dark-factory.ts <project-name>
 *
 * Output is written to ../output/<project-name>/.
 * Logs are written to ../output/<project-name>/logs/.
 */

import { readFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import {
  parse,
  PipelineRunner,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  CodergenHandler,
  ConditionalHandler,
  WaitForHumanHandler,
  SubPipelineHandler,
  ClaudeCodeBackend,
  ConsoleInterviewer,
  PipelineEventEmitter,
  PipelineEventKind,
  StageStatus,
  stringAttr,
} from "./attractor/src/index.js";
import type { ClaudeUsageReport } from "./attractor/src/index.js";

// --- Parse arguments ---

const projectName = process.argv[2];
if (!projectName) {
  console.error("Usage: bun run-dark-factory.ts <project-name>");
  process.exit(1);
}

// --- Create output directories ---

const outputDir = join("..", "output", projectName);
mkdirSync(join(outputDir, "dev", "code"), { recursive: true });
mkdirSync(join(outputDir, "dev", "unit-tests"), { recursive: true });
mkdirSync(join(outputDir, "test", "scenario-results"), { recursive: true });
mkdirSync(join(outputDir, "judge"), { recursive: true });
mkdirSync(join(outputDir, "holdout"), { recursive: true });

console.log(`\n=== Dark Factory ===`);
console.log(`Project: ${projectName}`);
console.log(`Output:  ${outputDir}`);
console.log(`Backend: ClaudeCodeBackend (claude --print --output-format json)`);
console.log();

// --- Set up backend and handlers ---

const backend = new ClaudeCodeBackend();

const registry = createHandlerRegistry();
registry.register("start", new StartHandler());
registry.register("exit", new ExitHandler());
registry.register("codergen", new CodergenHandler(backend));
registry.register("conditional", new ConditionalHandler());
registry.register("wait.human", new WaitForHumanHandler(new ConsoleInterviewer()));
registry.register("sub_pipeline", new SubPipelineHandler({
  handlerRegistry: registry,
  backend: backend,
}));

// --- Load and prepare master pipeline ---

const dotPath = "pipelines/dark-factory/master.dot";
const dotSource = readFileSync(dotPath, "utf-8");
const graph = parse(dotSource);

// Set _prompt_base so PromptFileTransform resolves @ paths
graph.attributes.set("_prompt_base", stringAttr(dirname(dotPath)));

console.log(`Pipeline: ${graph.name} (${graph.nodes.size} nodes, ${graph.edges.length} edges)`);
console.log();

// --- Usage tracking ---

const logsRoot = join(outputDir, "logs");

interface UsageTotals {
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  nodes: number;
}

const totals: UsageTotals = {
  cost_usd: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
  nodes: 0,
};

function readNodeUsage(nodeId: string): ClaudeUsageReport | null {
  const usagePath = join(logsRoot, nodeId, "usage.json");
  if (!existsSync(usagePath)) return null;
  try {
    return JSON.parse(readFileSync(usagePath, "utf-8")) as ClaudeUsageReport;
  } catch {
    return null;
  }
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// --- Event logging ---

const emitter = new PipelineEventEmitter();
(async () => {
  for await (const event of emitter.events()) {
    switch (event.kind) {
      case PipelineEventKind.STAGE_STARTED: {
        const data = event.data as Record<string, unknown>;
        console.log(`  [${new Date().toISOString()}] Started: ${data["nodeId"]}`);
        break;
      }
      case PipelineEventKind.STAGE_COMPLETED: {
        const data = event.data as Record<string, unknown>;
        const nodeId = data["nodeId"] as string;
        console.log(`  [${new Date().toISOString()}] Completed: ${nodeId}`);

        // Read and report usage for this node
        const usage = readNodeUsage(nodeId);
        if (usage) {
          totals.cost_usd += usage.cost_usd;
          totals.input_tokens += usage.usage.input_tokens;
          totals.output_tokens += usage.usage.output_tokens;
          totals.cache_creation_input_tokens += usage.usage.cache_creation_input_tokens;
          totals.cache_read_input_tokens += usage.usage.cache_read_input_tokens;
          totals.duration_ms += usage.duration_ms;
          totals.duration_api_ms += usage.duration_api_ms;
          totals.num_turns += usage.num_turns;
          totals.nodes += 1;

          console.log(`    Cost: ${formatCost(usage.cost_usd)} | In: ${formatTokens(usage.usage.input_tokens)} | Out: ${formatTokens(usage.usage.output_tokens)} | Cache: ${formatTokens(usage.usage.cache_read_input_tokens)} read, ${formatTokens(usage.usage.cache_creation_input_tokens)} created | API: ${(usage.duration_api_ms / 1000).toFixed(1)}s | Turns: ${usage.num_turns}`);
        }
        break;
      }
      case PipelineEventKind.PIPELINE_COMPLETED:
        console.log(`  [${new Date().toISOString()}] Pipeline finished!`);
        break;
      case PipelineEventKind.PIPELINE_FAILED: {
        const data = event.data as Record<string, unknown>;
        console.log(`  [${new Date().toISOString()}] Pipeline FAILED: ${data["reason"]}`);
        break;
      }
    }
  }
})();

// --- Run ---

const startTime = Date.now();

const runner = new PipelineRunner({
  handlerRegistry: registry,
  eventEmitter: emitter,
  backend,
  logsRoot,
});

const result = await runner.run(graph);
const elapsed = Date.now() - startTime;
const minutes = Math.floor(elapsed / 60000);
const seconds = Math.floor((elapsed % 60000) / 1000);

console.log();
console.log(`=== Results ===`);
console.log(`Status: ${result.outcome.status}`);
console.log(`Nodes completed: ${result.completedNodes.join(" → ")}`);
console.log(`Elapsed: ${minutes}m ${seconds}s`);

if (result.outcome.status === StageStatus.FAIL) {
  console.log(`Failure: ${result.outcome.failureReason}`);
  process.exit(1);
}

// --- Usage summary ---

if (totals.nodes > 0) {
  console.log();
  console.log(`=== Token Usage ===`);
  console.log(`Nodes with usage data: ${totals.nodes}`);
  console.log(`Total cost:            ${formatCost(totals.cost_usd)}`);
  console.log(`Input tokens:          ${formatTokens(totals.input_tokens)}`);
  console.log(`Output tokens:         ${formatTokens(totals.output_tokens)}`);
  console.log(`Cache read tokens:     ${formatTokens(totals.cache_read_input_tokens)}`);
  console.log(`Cache created tokens:  ${formatTokens(totals.cache_creation_input_tokens)}`);
  console.log(`Total turns:           ${totals.num_turns}`);
  console.log(`Total API time:        ${(totals.duration_api_ms / 1000).toFixed(1)}s`);
  console.log(`Total wall time:       ${(totals.duration_ms / 1000).toFixed(1)}s`);
}

console.log();
console.log(`Output written to: ${outputDir}`);
console.log(`Logs written to: ${logsRoot}`);
