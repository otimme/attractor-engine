/**
 * End-to-end tests for the attractor pipeline engine.
 *
 * These tests exercise the scenarios described in USAGE.md:
 * - Simple linear pipeline
 * - Branching with conditions
 * - Human-in-the-loop gate
 * - Retries and goal gates
 * - Event streaming
 * - Context flowing through stages
 */
import { describe, expect, test } from "bun:test";
import {
  parse,
  PipelineRunner,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  CodergenHandler,
  ConditionalHandler,
  WaitForHumanHandler,
  ToolHandler,
  StubBackend,
  AutoApproveInterviewer,
  QueueInterviewer,
  PipelineEventEmitter,
  PipelineEventKind,
  StageStatus,
  createAnswer,
  createOutcome,
} from "../attractor/src/index.js";
import type { PipelineRunnerConfig, PipelineEvent } from "../attractor/src/index.js";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

function tempLogsRoot(): string {
  return join(tmpdir(), "attractor-e2e-" + randomUUID());
}

function buildRunner(config: Partial<PipelineRunnerConfig> & Pick<PipelineRunnerConfig, "handlerRegistry">): PipelineRunner {
  return new PipelineRunner({
    logsRoot: tempLogsRoot(),
    ...config,
  });
}

describe("simple linear pipeline", () => {
  test("parses DOT and runs start -> task -> task -> exit", async () => {
    const dot = `
      digraph Simple {
        graph [goal="Run tests and report"]

        start     [shape=Mdiamond, label="Start"]
        exit      [shape=Msquare, label="Exit"]
        run_tests [label="Run Tests", prompt="Run the test suite and report results"]
        report    [label="Report", prompt="Summarize the test results"]

        start -> run_tests -> report -> exit
      }
    `;
    const graph = parse(dot);

    const backend = new StubBackend({ defaultResponse: "All tests passed." });
    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toEqual(["start", "run_tests", "report"]);
  });

  test("sets graph.goal in context", async () => {
    const dot = `
      digraph GoalTest {
        graph [goal="My test goal"]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        start -> exit
      }
    `;
    const graph = parse(dot);

    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.context.get("graph.goal")).toBe("My test goal");
  });
});

describe("branching with conditions", () => {
  test("routes to exit on success outcome", async () => {
    const dot = `
      digraph Branch {
        graph [goal="Implement and validate a feature"]
        node [shape=box]

        start     [shape=Mdiamond]
        exit      [shape=Msquare]
        implement [label="Implement", prompt="Implement the plan"]
        validate  [label="Validate", prompt="Run tests"]

        start -> implement -> validate
        validate -> exit      [label="Yes", condition="outcome=success"]
        validate -> implement [label="No", condition="outcome!=success"]
      }
    `;
    const graph = parse(dot);

    const backend = new StubBackend({ defaultResponse: "Done." });
    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("implement");
    expect(result.completedNodes).toContain("validate");
  });

  test("loops back on failure outcome", async () => {
    let validateCallCount = 0;
    const backend = new StubBackend({
      responseFn: (node) => {
        if (node.id === "validate") {
          validateCallCount++;
          // Fail the first time, succeed the second time
          if (validateCallCount === 1) {
            return createOutcome({
              status: StageStatus.FAIL,
              failureReason: "Tests failed",
            });
          }
        }
        return "Done.";
      },
    });

    // Conditions go directly on the validate node's edges so they
    // evaluate against validate's outcome (not a separate gate node's).
    const dot = `
      digraph BranchLoop {
        graph [goal="Implement and validate"]
        node [shape=box]

        start     [shape=Mdiamond]
        exit      [shape=Msquare]
        implement [label="Implement", prompt="Implement"]
        validate  [label="Validate", prompt="Test"]

        start -> implement -> validate
        validate -> exit      [label="Yes", condition="outcome=success"]
        validate -> implement [label="No", condition="outcome!=success"]
      }
    `;
    const graph = parse(dot);

    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    // implement should appear twice (once original, once after loop-back)
    expect(result.completedNodes.filter((n) => n === "implement")).toHaveLength(2);
    expect(validateCallCount).toBe(2);
  });
});

describe("human-in-the-loop gate", () => {
  test("follows the approved edge when human selects approve", async () => {
    const dot = `
      digraph Review {
        start       [shape=Mdiamond]
        exit        [shape=Msquare]
        review_gate [shape=hexagon, label="Review Changes"]
        ship_it     [label="Ship It", prompt="Ship"]
        fixes       [label="Fixes", prompt="Fix"]

        start -> review_gate
        review_gate -> ship_it [label="[A] Approve"]
        review_gate -> fixes   [label="[F] Fix"]
        ship_it -> exit
        fixes -> review_gate
      }
    `;
    const graph = parse(dot);

    // Pre-load the answer: select "Approve"
    const interviewer = new QueueInterviewer([
      createAnswer({ value: "A" }),
    ]);

    const backend = new StubBackend({ defaultResponse: "Shipped." });
    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));
    registry.register("wait.human", new WaitForHumanHandler(interviewer));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("review_gate");
    expect(result.completedNodes).toContain("ship_it");
    expect(result.completedNodes).not.toContain("fixes");
  });

  test("loops back when human selects fix", async () => {
    const dot = `
      digraph ReviewLoop {
        start       [shape=Mdiamond]
        exit        [shape=Msquare]
        review_gate [shape=hexagon, label="Review Changes"]
        ship_it     [label="Ship It", prompt="Ship"]
        fixes       [label="Fixes", prompt="Fix"]

        start -> review_gate
        review_gate -> ship_it [label="[A] Approve"]
        review_gate -> fixes   [label="[F] Fix"]
        ship_it -> exit
        fixes -> review_gate
      }
    `;
    const graph = parse(dot);

    // First time: Fix. Second time: Approve.
    const interviewer = new QueueInterviewer([
      createAnswer({ value: "F" }),
      createAnswer({ value: "A" }),
    ]);

    const backend = new StubBackend({ defaultResponse: "Done." });
    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));
    registry.register("wait.human", new WaitForHumanHandler(interviewer));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("fixes");
    expect(result.completedNodes).toContain("ship_it");
    // review_gate should appear twice
    expect(result.completedNodes.filter((n) => n === "review_gate")).toHaveLength(2);
  });
});

describe("retries and goal gates", () => {
  test("retries when goal gate is unsatisfied at exit", async () => {
    let testCallCount = 0;
    const backend = new StubBackend({
      responseFn: (node) => {
        if (node.id === "test") {
          testCallCount++;
          if (testCallCount === 1) {
            return createOutcome({
              status: StageStatus.FAIL,
              failureReason: "Tests failed",
            });
          }
        }
        return "Done.";
      },
    });

    const dot = `
      digraph GoalGate {
        graph [goal="Deploy with confidence", retry_target="implement"]

        start     [shape=Mdiamond]
        exit      [shape=Msquare]
        implement [label="Implement", prompt="Implement"]
        test      [label="Test", prompt="Run tests", goal_gate=true]

        start -> implement -> test -> exit
      }
    `;
    const graph = parse(dot);

    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    // implement should run twice due to goal gate retry
    expect(result.completedNodes.filter((n) => n === "implement")).toHaveLength(2);
    expect(testCallCount).toBe(2);
  });
});

describe("event streaming", () => {
  test("emits pipeline and stage lifecycle events", async () => {
    const dot = `
      digraph Events {
        graph [goal="Test events"]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        task  [label="Task", prompt="Do something"]
        start -> task -> exit
      }
    `;
    const graph = parse(dot);

    const backend = new StubBackend({ defaultResponse: "Done." });
    const emitter = new PipelineEventEmitter();
    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));

    const collectedEvents: PipelineEvent[] = [];

    // Collect events in the background
    const eventPromise = (async () => {
      for await (const event of emitter.events()) {
        collectedEvents.push(event);
      }
    })();

    const runner = buildRunner({ handlerRegistry: registry, eventEmitter: emitter });
    await runner.run(graph);
    emitter.close();
    await eventPromise;

    const kinds = collectedEvents.map((e) => e.kind);

    expect(kinds).toContain(PipelineEventKind.PIPELINE_STARTED);
    expect(kinds).toContain(PipelineEventKind.PIPELINE_COMPLETED);
    expect(kinds).toContain(PipelineEventKind.STAGE_STARTED);
    expect(kinds).toContain(PipelineEventKind.STAGE_COMPLETED);

    // Verify stage events reference the correct node IDs
    const stageStartedEvents = collectedEvents.filter(
      (e) => e.kind === PipelineEventKind.STAGE_STARTED,
    );
    const stageNodeIds = stageStartedEvents.map((e) => e.data["nodeId"]);
    expect(stageNodeIds).toContain("start");
    expect(stageNodeIds).toContain("task");
  });
});

describe("context flows through pipeline", () => {
  test("handler context updates are visible to subsequent stages", async () => {
    const responses = new Map<string, string>();
    responses.set("step_one", "First result");
    responses.set("step_two", "Second result");

    const backend = new StubBackend({ responses });

    const dot = `
      digraph ContextFlow {
        graph [goal="Test context flow"]
        start    [shape=Mdiamond]
        exit     [shape=Msquare]
        step_one [label="Step One", prompt="First step"]
        step_two [label="Step Two", prompt="Second step"]
        start -> step_one -> step_two -> exit
      }
    `;
    const graph = parse(dot);

    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    // CodergenHandler sets last_stage and last_response in context
    expect(result.context.get("last_stage")).toBe("step_two");
    expect(result.context.get("last_response")).toContain("Second result");
  });
});

describe("tool handler", () => {
  test("executes a shell command and captures output", async () => {
    const dot = `
      digraph ToolTest {
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        echo_task [shape=parallelogram, label="Echo", tool_command="echo hello-from-tool"]
        start -> echo_task -> exit
      }
    `;
    const graph = parse(dot);

    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("tool", new ToolHandler());

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toContain("echo_task");
    expect(result.context.get("tool.output").trim()).toBe("hello-from-tool");
  });
});

describe("auto-approve interviewer", () => {
  test("automatically selects the first option at a human gate", async () => {
    const dot = `
      digraph AutoApprove {
        start  [shape=Mdiamond]
        exit   [shape=Msquare]
        gate   [shape=hexagon, label="Approve?"]
        done   [label="Done", prompt="Finish"]
        reject [label="Reject", prompt="Reject"]

        start -> gate
        gate -> done   [label="[Y] Yes"]
        gate -> reject [label="[N] No"]
        done -> exit
      }
    `;
    const graph = parse(dot);

    const interviewer = new AutoApproveInterviewer();
    const backend = new StubBackend({ defaultResponse: "Done." });
    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler(backend));
    registry.register("wait.human", new WaitForHumanHandler(interviewer));

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    // Auto-approve picks the first option ("Yes" -> done)
    expect(result.completedNodes).toContain("done");
    expect(result.completedNodes).not.toContain("reject");
  });
});

describe("codergen without backend", () => {
  test("uses simulated response when no backend is provided", async () => {
    const dot = `
      digraph NoBacked {
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        task  [label="Simulated", prompt="Do something"]
        start -> task -> exit
      }
    `;
    const graph = parse(dot);

    const registry = createHandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", new CodergenHandler());

    const runner = buildRunner({ handlerRegistry: registry });
    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.context.get("last_response")).toContain("[Simulated]");
  });
});
