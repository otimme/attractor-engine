#!/usr/bin/env bun

/**
 * Tests the Dark Factory outer loop (dev → test → judge → repeat).
 * Makes the judge return FAIL for the first 2 iterations, SUCCESS on the 3rd.
 * Verifies the loop runs 3 times before routing to holdout.
 */

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
  createOutcome,
  stringAttr,
} from "./attractor/src/index.js";
import type { Node, Context } from "./attractor/src/index.js";

let judgeCallCount = 0;

const backend = new StubBackend({
  responseFn: (node: Node, prompt: string, context: Context) => {
    if (node.id === "judge") {
      judgeCallCount++;
      if (judgeCallCount < 3) {
        console.log(`  [judge] call #${judgeCallCount} → FAIL (not converged)`);
        return createOutcome({
          status: StageStatus.FAIL,
          failureReason: `Iteration ${judgeCallCount}: satisfaction score 0.${5 + judgeCallCount * 10} (below 0.8 threshold)`,
        });
      }
      console.log(`  [judge] call #${judgeCallCount} → SUCCESS (converged!)`);
      return `[stub] Judge converged on iteration ${judgeCallCount}`;
    }
    return `[stub] completed: ${node.id}`;
  },
});

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

const emitter = new PipelineEventEmitter();
const nodeLog: string[] = [];

(async () => {
  for await (const event of emitter.events()) {
    if (event.kind === PipelineEventKind.STAGE_COMPLETED) {
      const data = event.data as Record<string, unknown>;
      const nodeId = data["nodeId"] as string;
      nodeLog.push(nodeId);
    }
  }
})();

const dotPath = "pipelines/dark-factory/master.dot";
const dotSource = readFileSync(dotPath, "utf-8");
const graph = parse(dotSource);
graph.attributes.set("_prompt_base", stringAttr(dirname(dotPath)));

console.log("Testing Dark Factory outer loop (expect 3 judge calls)...\n");

const runner = new PipelineRunner({
  handlerRegistry: registry,
  eventEmitter: emitter,
  backend,
  logsRoot: "/tmp/dark-factory-loop-test",
});

const startTime = Date.now();
const result = await runner.run(graph);
const elapsed = Date.now() - startTime;

console.log();
console.log(`Result: ${result.outcome.status}`);
console.log(`Judge calls: ${judgeCallCount}`);
console.log(`Nodes completed: ${result.completedNodes.join(" → ")}`);
console.log(`Elapsed: ${elapsed}ms`);

// Verify expectations
const devCount = result.completedNodes.filter(n => n === "dev_agent_ios").length;
const testCount = result.completedNodes.filter(n => n === "test_agent").length;
const judgeCount = result.completedNodes.filter(n => n === "judge").length;
const holdoutCount = result.completedNodes.filter(n => n === "holdout").length;

console.log();
console.log("=== Verification ===");
console.log(`Dev agent runs: ${devCount} (expected: 3)`);
console.log(`Test agent runs: ${testCount} (expected: 3)`);
console.log(`Judge runs: ${judgeCount} (expected: 3)`);
console.log(`Holdout runs: ${holdoutCount} (expected: 1)`);

const pass = devCount === 3 && testCount === 3 && judgeCount === 3 && holdoutCount === 1 && result.outcome.status === StageStatus.SUCCESS;
console.log();
console.log(pass ? "PASS: Outer loop works correctly!" : "FAIL: Unexpected loop behavior");

if (!pass) {
  process.exit(1);
}
