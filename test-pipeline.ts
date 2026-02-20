#!/usr/bin/env bun

import { readFileSync } from "fs";
import { dirname } from "path";
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
  StubBackend,
  AutoApproveInterviewer,
  PipelineEventEmitter,
  PipelineEventKind,
  StageStatus,
  stringAttr,
} from "./attractor/src/index.js";

const dotPath = process.argv[2];
if (!dotPath) {
  console.error("Usage: bun test-pipeline.ts <path-to-dot-file>");
  process.exit(1);
}

console.log(`Loading: ${dotPath}`);
const dotSource = readFileSync(dotPath, "utf-8");
const graph = parse(dotSource);

// Set _prompt_base so PromptFileTransform resolves @ paths relative to DOT file location
graph.attributes.set("_prompt_base", stringAttr(dirname(dotPath)));

console.log(`Parsed: ${graph.name} (${graph.nodes.size} nodes, ${graph.edges.length} edges)`);

// StubBackend returns a simple response per node
const backend = new StubBackend({
  responseFn: (node, prompt) => {
    const preview = prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt;
    console.log(`  [${node.id}] prompt: ${preview}`);
    return `[stub] completed: ${node.id}`;
  },
});

// Build handler registry with all handlers including sub-pipeline
const registry = createHandlerRegistry();
registry.register("start", new StartHandler());
registry.register("exit", new ExitHandler());
registry.register("codergen", new CodergenHandler(backend));
registry.register("conditional", new ConditionalHandler());
registry.register("wait.human", new WaitForHumanHandler(new AutoApproveInterviewer()));
registry.register("sub_pipeline", new SubPipelineHandler({
  handlerRegistry: registry,
  backend: backend,
}));

// Event logging
const emitter = new PipelineEventEmitter();
(async () => {
  for await (const event of emitter.events()) {
    if (event.kind === PipelineEventKind.STAGE_STARTED) {
      const data = event.data as Record<string, unknown>;
      console.log(`  -> Started: ${data["nodeId"]}`);
    }
    if (event.kind === PipelineEventKind.STAGE_COMPLETED) {
      const data = event.data as Record<string, unknown>;
      console.log(`  -> Completed: ${data["nodeId"]}`);
    }
    if (event.kind === PipelineEventKind.PIPELINE_COMPLETED) {
      console.log("  -> Pipeline finished!");
    }
    if (event.kind === PipelineEventKind.PIPELINE_FAILED) {
      const data = event.data as Record<string, unknown>;
      console.log(`  -> Pipeline FAILED: ${data["reason"]}`);
    }
  }
})();

// Run
const runner = new PipelineRunner({
  handlerRegistry: registry,
  eventEmitter: emitter,
  backend,
  logsRoot: "/tmp/dark-factory-test",
});

const startTime = Date.now();
const result = await runner.run(graph);
const elapsed = Date.now() - startTime;

console.log(`\nResult: ${result.outcome.status}`);
console.log(`Nodes completed: ${result.completedNodes.join(" → ")}`);
console.log(`Elapsed: ${elapsed}ms`);

if (result.outcome.status === StageStatus.FAIL) {
  console.log(`Failure: ${result.outcome.failureReason}`);
  process.exit(1);
}
