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

import { readFileSync, mkdirSync } from "fs";
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
console.log(`Backend: ClaudeCodeBackend (claude --print)`);
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
        console.log(`  [${new Date().toISOString()}] Completed: ${data["nodeId"]}`);
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
  logsRoot: join(outputDir, "logs"),
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

console.log();
console.log(`Output written to: ${outputDir}`);
console.log(`Logs written to: ${join(outputDir, "logs")}`);
