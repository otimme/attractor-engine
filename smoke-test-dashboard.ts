#!/usr/bin/env bun

/**
 * Smoke test — starts the dashboard server with an expanded graph and
 * simulates pipeline events so you can see nodes light up in real time.
 *
 * Usage: bun smoke-test-dashboard.ts
 * Then open: http://localhost:3000/
 */

import { readFileSync } from "fs";
import {
  parse,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  PipelineEventEmitter,
  PipelineEventKind,
  StageStatus,
  createServer,
  WebInterviewer,
  expandDotForVisualization,
} from "./attractor/src/index.js";
import type { PipelineRecord } from "./attractor/src/index.js";

const dotPath = "pipelines/dark-factory/master-web.dot";
const dotSource = readFileSync(dotPath, "utf-8");
const expandedDotSource = expandDotForVisualization(dotSource, ".");

const registry = createHandlerRegistry();
registry.register("start", new StartHandler());
registry.register("exit", new ExitHandler());

const server = createServer({
  port: 3000,
  runnerConfig: { handlerRegistry: registry },
});

const emitter = new PipelineEventEmitter();
const pipelineId = "smoke-test";

const record: PipelineRecord = {
  id: pipelineId,
  status: "running",
  result: undefined,
  latestCheckpoint: undefined,
  dotSource: expandedDotSource,
  emitter,
  interviewer: new WebInterviewer(),
  abortController: new AbortController(),
};
server.pipelines.set(pipelineId, record);

console.log(`Dashboard: http://localhost:${server.port}/`);
console.log(`Pipeline ID: ${pipelineId}`);
console.log();
console.log("Simulating pipeline events... press Ctrl+C to stop.");
console.log();

// The node traversal order for the "happy path" through the expanded graph
const nodeSequence = [
  // Dev Agent (Web) sub-pipeline
  "dev_agent_web_read_spec",
  "dev_agent_web_architect",
  "dev_agent_web_ux_briefing",
  "dev_agent_web_build",
  "dev_agent_web_review",
  "dev_agent_web_ux_review",
  "dev_agent_web_unit_test",
  // Test Agent sub-pipeline
  "test_agent_read_scenarios",
  "test_agent_run_scenarios",
  "test_agent_report",
  // Judge
  "judge",
  // Holdout Gate sub-pipeline
  "holdout_run_holdout",
];

function emit(kind: string, data: Record<string, unknown>) {
  emitter.emit({
    kind: kind as any,
    timestamp: new Date(),
    pipelineId,
    data,
  });
}

// Simulate the pipeline running through nodes with realistic-ish delays
const STAGE_DELAY_MS = 2000; // Time each node stays "active"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function simulate() {
  emit(PipelineEventKind.PIPELINE_STARTED, { graphName: "dark_factory_web" });
  console.log("  Pipeline started");

  for (const nodeId of nodeSequence) {
    emit(PipelineEventKind.STAGE_STARTED, { nodeId });
    console.log(`  Started:   ${nodeId}`);

    await sleep(STAGE_DELAY_MS);

    emit(PipelineEventKind.STAGE_COMPLETED, { nodeId, status: StageStatus.SUCCESS });
    console.log(`  Completed: ${nodeId}`);

    // Update checkpoint so the checkpoint endpoint works
    record.latestCheckpoint = {
      pipelineId,
      timestamp: new Date().toISOString(),
      currentNode: nodeId,
      completedNodes: nodeSequence.slice(0, nodeSequence.indexOf(nodeId) + 1),
      nodeRetries: {},
      nodeOutcomes: Object.fromEntries(
        nodeSequence
          .slice(0, nodeSequence.indexOf(nodeId) + 1)
          .map((id) => [id, StageStatus.SUCCESS]),
      ),
      contextValues: {},
      logs: [],
    };

    await sleep(500); // Brief pause between nodes
  }

  emit(PipelineEventKind.PIPELINE_COMPLETED, {
    completedNodes: nodeSequence,
    status: StageStatus.SUCCESS,
  });

  record.status = "completed";
  console.log();
  console.log("  Pipeline completed! Dashboard will show final state.");
  console.log("  Press Ctrl+C to stop the server.");
}

simulate();
