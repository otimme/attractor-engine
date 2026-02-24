import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import {
  parse,
  StageStatus,
  createOutcome,
  PipelineRunner,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  CodergenHandler,
  ConditionalHandler,
  StubBackend,
  PipelineEventEmitter,
  PipelineEventKind,
  stringAttr,
} from "../../src/index.js";
import { readFileSync } from "fs";
import { dirname } from "path";

const DOT_PATH = join(import.meta.dir, "../../../pipelines/dark-factory/dev-agent-web.dot");

function makeLogsRoot(): string {
  const dir = join(tmpdir(), "attractor-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function loadGraph() {
  const dot = readFileSync(DOT_PATH, "utf-8");
  const graph = parse(dot);
  graph.attributes.set("_prompt_base", stringAttr(dirname(DOT_PATH)));
  return graph;
}

function buildRunner(backend: StubBackend, logsRoot: string, emitter?: PipelineEventEmitter) {
  const registry = createHandlerRegistry();
  registry.register("start", new StartHandler());
  registry.register("exit", new ExitHandler());
  registry.register("codergen", new CodergenHandler(backend));
  registry.register("conditional", new ConditionalHandler());

  return new PipelineRunner({
    handlerRegistry: registry,
    backend,
    logsRoot,
    eventEmitter: emitter,
  });
}

function trackCompletions(emitter: PipelineEventEmitter): string[] {
  const completed: string[] = [];
  (async () => {
    for await (const event of emitter.events()) {
      if (event.kind === PipelineEventKind.STAGE_COMPLETED) {
        const data = event.data as Record<string, unknown>;
        completed.push(data["nodeId"] as string);
      }
    }
  })();
  return completed;
}

describe("dev-agent-web.dot graph traversal", () => {
  test("happy path: review clean, tests pass — no loops", async () => {
    const visitCount = new Map<string, number>();

    const backend = new StubBackend({
      responseFn: (node) => {
        const count = (visitCount.get(node.id) ?? 0) + 1;
        visitCount.set(node.id, count);

        // review returns success (no issues found) → skip fix_review
        if (node.id === "review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        // ux_review returns success (no visual issues) → skip fix_ux
        if (node.id === "ux_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        // unit_test returns success → skip fix
        if (node.id === "unit_test") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        return `done: ${node.id}`;
      },
    });

    const logsRoot = makeLogsRoot();
    const emitter = new PipelineEventEmitter();
    const completed = trackCompletions(emitter);
    const runner = buildRunner(backend, logsRoot, emitter);
    const graph = loadGraph();

    const result = await runner.run(graph);
    // Let event loop drain
    await new Promise((r) => setTimeout(r, 50));

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toEqual([
      "start", "read_spec", "architect", "ux_briefing", "build",
      "review", "ux_review", "unit_test",
    ]);
    // fix_review, fix_ux, and fix should never have been visited
    expect(visitCount.has("fix_review")).toBe(false);
    expect(visitCount.has("fix_ux")).toBe(false);
    expect(visitCount.has("fix")).toBe(false);
  });

  test("review finds issues → fix_review → re-review passes", async () => {
    const visitCount = new Map<string, number>();

    const backend = new StubBackend({
      responseFn: (node) => {
        const count = (visitCount.get(node.id) ?? 0) + 1;
        visitCount.set(node.id, count);

        if (node.id === "review") {
          if (count === 1) {
            // First review: issues found
            return createOutcome({ status: StageStatus.FAIL, failureReason: "6 issues found" });
          }
          // Second review: clean
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "fix_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "ux_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "unit_test") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        return `done: ${node.id}`;
      },
    });

    const logsRoot = makeLogsRoot();
    const runner = buildRunner(backend, logsRoot);
    const graph = loadGraph();

    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toEqual([
      "start", "read_spec", "architect", "ux_briefing", "build",
      "review", "fix_review", "review",  // review loop
      "ux_review", "unit_test",
    ]);
    expect(visitCount.get("review")).toBe(2);
    expect(visitCount.get("fix_review")).toBe(1);
  });

  test("unit_test fails → fix → retest passes", async () => {
    const visitCount = new Map<string, number>();

    const backend = new StubBackend({
      responseFn: (node) => {
        const count = (visitCount.get(node.id) ?? 0) + 1;
        visitCount.set(node.id, count);

        if (node.id === "review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "ux_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "unit_test") {
          if (count === 1) {
            // First run: 3 tests fail
            return createOutcome({ status: StageStatus.FAIL, failureReason: "3/9 tests failing" });
          }
          // Second run: all pass
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "fix") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        return `done: ${node.id}`;
      },
    });

    const logsRoot = makeLogsRoot();
    const runner = buildRunner(backend, logsRoot);
    const graph = loadGraph();

    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toEqual([
      "start", "read_spec", "architect", "ux_briefing", "build",
      "review", "ux_review",
      "unit_test", "fix", "unit_test",  // test loop
    ]);
    expect(visitCount.get("unit_test")).toBe(2);
    expect(visitCount.get("fix")).toBe(1);
  });

  test("both loops fire: review issues + test failures", async () => {
    const visitCount = new Map<string, number>();

    const backend = new StubBackend({
      responseFn: (node) => {
        const count = (visitCount.get(node.id) ?? 0) + 1;
        visitCount.set(node.id, count);

        if (node.id === "review") {
          if (count === 1) return createOutcome({ status: StageStatus.FAIL, failureReason: "issues" });
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "fix_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "ux_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "unit_test") {
          if (count === 1) return createOutcome({ status: StageStatus.FAIL, failureReason: "failures" });
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "fix") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        return `done: ${node.id}`;
      },
    });

    const logsRoot = makeLogsRoot();
    const runner = buildRunner(backend, logsRoot);
    const graph = loadGraph();

    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toEqual([
      "start", "read_spec", "architect", "ux_briefing", "build",
      "review", "fix_review", "review",       // review loop
      "ux_review",                             // ux review (passes)
      "unit_test", "fix", "unit_test",         // test loop
    ]);
  });

  test("fix_review fails → moves on to unit_test anyway", async () => {
    const visitCount = new Map<string, number>();

    const backend = new StubBackend({
      responseFn: (node) => {
        const count = (visitCount.get(node.id) ?? 0) + 1;
        visitCount.set(node.id, count);

        if (node.id === "review") {
          return createOutcome({ status: StageStatus.FAIL, failureReason: "issues" });
        }
        if (node.id === "fix_review") {
          // Can't fix → moves on to ux_review
          return createOutcome({ status: StageStatus.FAIL, failureReason: "couldn't fix" });
        }
        if (node.id === "ux_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "unit_test") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        return `done: ${node.id}`;
      },
    });

    const logsRoot = makeLogsRoot();
    const runner = buildRunner(backend, logsRoot);
    const graph = loadGraph();

    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toEqual([
      "start", "read_spec", "architect", "ux_briefing", "build",
      "review", "fix_review",  // review failed, fix failed → move on
      "ux_review", "unit_test",
    ]);
    // review should only be visited once (fix_review failed, so no re-review)
    expect(visitCount.get("review")).toBe(1);
  });

  test("fix gives up → pipeline exits with failure", async () => {
    const visitCount = new Map<string, number>();

    const backend = new StubBackend({
      responseFn: (node) => {
        const count = (visitCount.get(node.id) ?? 0) + 1;
        visitCount.set(node.id, count);

        if (node.id === "review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "ux_review") {
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        if (node.id === "unit_test") {
          return createOutcome({ status: StageStatus.FAIL, failureReason: "tests failing" });
        }
        if (node.id === "fix") {
          return createOutcome({ status: StageStatus.FAIL, failureReason: "can't fix it" });
        }
        return `done: ${node.id}`;
      },
    });

    const logsRoot = makeLogsRoot();
    const runner = buildRunner(backend, logsRoot);
    const graph = loadGraph();

    const result = await runner.run(graph);

    // fix failed → "give up" edge goes to exit, pipeline reports failure
    expect(result.completedNodes).toContain("fix");
    expect(result.outcome.status).toBe(StageStatus.FAIL);
  });
});
