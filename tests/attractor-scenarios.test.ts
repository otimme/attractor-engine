/**
 * Advanced E2E scenario tests that combine multiple features per test
 * in realistic workflow patterns.
 *
 * Scenarios 1-4 use a real LLM when ANTHROPIC_API_KEY is present,
 * falling back to StubBackend otherwise. Some nodes (RETRY/FAIL
 * outcomes in Scenario 3) are always stubbed via overrides.
 * Scenario 5 uses a real LLM exclusively (skipped without key).
 */
import { describe, expect, test, afterAll, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import {
  parse,
  PipelineRunner,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  CodergenHandler,
  WaitForHumanHandler,
  ToolHandler,
  ParallelHandler,
  FanInHandler,
  StubBackend,
  SessionBackend,
  CallbackInterviewer,
  RecordingInterviewer,
  QueueInterviewer,
  WebInterviewer,
  PipelineEventEmitter,
  PipelineEventKind,
  StageStatus,
  createAnswer,
  createOutcome,
  loadCheckpoint,
  VariableExpansionTransform,
  StylesheetTransform,
  createServer,
} from "../attractor/src/index.js";
import type {
  CodergenBackend,
  Node,
  Outcome,
  PipelineRunnerConfig,
  PipelineEvent,
  Question,
  NodeExecutor,
  Context,
  Graph,
  AttractorServer,
} from "../attractor/src/index.js";
import { Client, AnthropicAdapter } from "../unified-llm/src/index.js";
import { createAnthropicProfile } from "../coding-agent/src/profiles/anthropic-profile.js";
import { LocalExecutionEnvironment } from "../coding-agent/src/env/local-env.js";

// ---------------------------------------------------------------------------
// .env loading + dual-mode configuration
// ---------------------------------------------------------------------------

const envFile = Bun.file(join(import.meta.dir, "../.env"));
if (await envFile.exists()) {
  const envText = await envFile.text();
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    // Don't overwrite vars already in the environment (allows ANTHROPIC_API_KEY= to force stub mode)
    if (value && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const hasRealLLM = Boolean(anthropicKey);
const TEST_TIMEOUT = hasRealLLM ? 300_000 : 10_000;

const clientsToClose: Client[] = [];

afterAll(async () => {
  await Promise.all(clientsToClose.map((c) => c.close()));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempLogsRoot(): string {
  return join(tmpdir(), "attractor-scenario-" + randomUUID());
}

function buildRunner(
  config: Partial<PipelineRunnerConfig> &
    Pick<PipelineRunnerConfig, "handlerRegistry">,
): PipelineRunner {
  return new PipelineRunner({
    logsRoot: tempLogsRoot(),
    ...config,
  });
}

type OverrideFn = (
  node: Node,
  prompt: string,
  context: Context,
) => string | Outcome | undefined;

function createRealBackend(): CodergenBackend {
  const adapter = new AnthropicAdapter({ apiKey: anthropicKey! });
  const client = new Client({ providers: { anthropic: adapter } });
  clientsToClose.push(client);
  const profile = createAnthropicProfile("claude-sonnet-4-5-20250929");
  const env = new LocalExecutionEnvironment({ workingDir: tmpdir() });
  return new SessionBackend({
    providerProfile: profile,
    executionEnv: env,
    llmClient: client,
  });
}

function makeBackend(options?: {
  overrideFn?: OverrideFn;
  defaultStubResponse?: string;
}): CodergenBackend {
  const { overrideFn, defaultStubResponse = "stub" } = options ?? {};
  const fallback = hasRealLLM
    ? createRealBackend()
    : new StubBackend({ defaultResponse: defaultStubResponse });
  if (!overrideFn) return fallback;
  return {
    async run(node, prompt, context, opts) {
      const result = overrideFn(node, prompt, context);
      if (result !== undefined) return result;
      return fallback.run(node, prompt, context, opts);
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: "Ship a Feature"
// Pipeline: start → plan → implement → run_tests(tool) → [conditions] → human_review → exit
//
// Features exercised:
//   VariableExpansionTransform, ToolHandler, conditional edges, context-based
//   routing (tool.output), CallbackInterviewer, checkpoint verification,
//   edge weights, lifecycle events
// ---------------------------------------------------------------------------
describe("scenario 1: ship a feature", () => {
  test(
    "end-to-end with tool-driven conditions, human gate, checkpoint, and events",
    async () => {
      const logsRoot = tempLogsRoot();

      const dot = `
      digraph ShipFeature {
        graph [goal="Ship the login feature"]

        start        [shape=Mdiamond]
        exit         [shape=Msquare]
        plan         [label="Plan", prompt="Briefly describe in 1-2 sentences how you would $goal. Do not write any code."]
        implement    [label="Implement", prompt="Describe in 1-2 sentences how $goal was implemented. Do not write any code or use any tools."]
        run_tests    [shape=parallelogram, label="Run Tests",
                      tool_command="echo PASS"]
        human_review [shape=hexagon, label="Review Changes"]

        start -> plan -> implement -> run_tests
        run_tests -> human_review [label="Pass", condition="outcome=success", weight=10]
        run_tests -> implement    [label="Retry", condition="outcome!=success", weight=1]
        human_review -> exit      [label="[A] Approve"]
        human_review -> implement [label="[R] Revise"]
      }
    `;
      const graph = parse(dot);

      const backend = makeBackend();

      // CallbackInterviewer: always approve
      const interviewer = new CallbackInterviewer(async (question: Question) => {
        return createAnswer({
          value: question.options[0]?.key ?? "A",
          selectedOption: question.options[0],
          text: question.options[0]?.label ?? "Approve",
        });
      });

      // Collect events
      const emitter = new PipelineEventEmitter();
      const collectedEvents: PipelineEvent[] = [];
      const eventPromise = (async () => {
        for await (const event of emitter.events()) {
          collectedEvents.push(event);
        }
      })();

      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));
      registry.register("tool", new ToolHandler());
      registry.register("wait.human", new WaitForHumanHandler(interviewer));

      const runner = new PipelineRunner({
        handlerRegistry: registry,
        transforms: [new VariableExpansionTransform()],
        eventEmitter: emitter,
        logsRoot,
      });

      const result = await runner.run(graph);
      emitter.close();
      await eventPromise;

      // Pipeline succeeds
      expect(result.outcome.status).toBe(StageStatus.SUCCESS);

      // All expected nodes were visited
      expect(result.completedNodes).toContain("plan");
      expect(result.completedNodes).toContain("implement");
      expect(result.completedNodes).toContain("run_tests");
      expect(result.completedNodes).toContain("human_review");

      // Tool output propagated to context
      expect(result.context.get("tool.output").trim()).toContain("PASS");

      // Human gate selected first option
      expect(result.context.get("human.gate.selected")).toBeTruthy();

      // VariableExpansionTransform: goal was expanded in context
      expect(result.context.get("graph.goal")).toBe("Ship the login feature");

      // Checkpoint exists and has correct structure
      const checkpoint = await loadCheckpoint(join(logsRoot, "checkpoint.json"));
      expect(checkpoint.timestamp).toBeTruthy();
      expect(checkpoint.completedNodes.length).toBeGreaterThan(0);
      expect(checkpoint.contextValues).toBeDefined();
      expect(typeof checkpoint.nodeRetries).toBe("object");

      // Events include full lifecycle
      const kinds = collectedEvents.map((e) => e.kind);
      expect(kinds).toContain(PipelineEventKind.PIPELINE_STARTED);
      expect(kinds).toContain(PipelineEventKind.PIPELINE_COMPLETED);
      expect(kinds).toContain(PipelineEventKind.STAGE_STARTED);
      expect(kinds).toContain(PipelineEventKind.STAGE_COMPLETED);
      expect(kinds).toContain(PipelineEventKind.CHECKPOINT_SAVED);
    },
    TEST_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Scenario 2: "Parallel Expert Review"
// Pipeline: start → write → fan_out(parallel) → [security, style, correctness]
//           → fan_in → human_gate → exit
//
// Features exercised:
//   ParallelHandler with NodeExecutor, FanInHandler, wait_all join,
//   RecordingInterviewer wrapping QueueInterviewer, edge weights,
//   context merging (parallel.results, parallel.fan_in.best_id)
// ---------------------------------------------------------------------------
describe("scenario 2: parallel expert review", () => {
  test(
    "fan-out to 3 reviewers, fan-in merges, human approves",
    async () => {
      const dot = `
      digraph ParallelReview {
        graph [goal="Review the auth module"]

        start       [shape=Mdiamond]
        exit        [shape=Msquare]
        write       [label="Write Code", prompt="Describe in one sentence how you would write the auth module. Do not write any code or use tools."]
        reviewers   [shape=component, label="Expert Reviews"]
        security    [label="Security Review", prompt="In one sentence, note any security concerns. Do not write code or use tools."]
        style       [label="Style Review", prompt="In one sentence, note any style concerns. Do not write code or use tools."]
        correctness [label="Correctness Review", prompt="In one sentence, note any correctness concerns. Do not write code or use tools."]
        merge       [shape=tripleoctagon, label="Merge Reviews"]
        approve     [shape=hexagon, label="Final Approval"]

        start -> write -> reviewers
        reviewers -> security    [weight=3]
        reviewers -> style       [weight=2]
        reviewers -> correctness [weight=1]
        security -> merge
        style -> merge
        correctness -> merge
        merge -> approve
        approve -> exit [label="[A] Approve"]
        approve -> write [label="[R] Revise"]
      }
    `;
      const graph = parse(dot);

      const backend = makeBackend();

      // NodeExecutor: resolve handler from registry, execute
      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));
      registry.register("parallel.fan_in", new FanInHandler());

      const logsRoot = tempLogsRoot();
      const nodeExecutor: NodeExecutor = async (
        nodeId: string,
        ctx: Context,
        g: Graph,
        logs: string,
      ): Promise<Outcome> => {
        const node = g.nodes.get(nodeId);
        if (!node) {
          return createOutcome({
            status: StageStatus.FAIL,
            failureReason: `Node not found: ${nodeId}`,
          });
        }
        const handler = registry.resolve(node);
        if (!handler) {
          return createOutcome({
            status: StageStatus.FAIL,
            failureReason: `No handler for node: ${nodeId}`,
          });
        }
        return handler.execute(node, ctx, g, logs);
      };

      registry.register("parallel", new ParallelHandler(nodeExecutor));

      // RecordingInterviewer wraps QueueInterviewer
      const inner = new QueueInterviewer([createAnswer({ value: "A" })]);
      const recorder = new RecordingInterviewer(inner);
      registry.register("wait.human", new WaitForHumanHandler(recorder));

      const runner = new PipelineRunner({
        handlerRegistry: registry,
        logsRoot,
      });

      const result = await runner.run(graph);

      // Pipeline succeeds
      expect(result.outcome.status).toBe(StageStatus.SUCCESS);

      // All nodes completed
      expect(result.completedNodes).toContain("write");
      expect(result.completedNodes).toContain("reviewers");
      expect(result.completedNodes).toContain("merge");
      expect(result.completedNodes).toContain("approve");

      // Parallel results are stored in context
      const parallelResultsRaw = result.context.get("parallel.results");
      expect(parallelResultsRaw).toBeTruthy();
      const parallelResults = JSON.parse(parallelResultsRaw) as Array<{
        nodeId: string;
        status: string;
      }>;
      const branchNodeIds = parallelResults.map((r) => r.nodeId);
      expect(branchNodeIds).toContain("security");
      expect(branchNodeIds).toContain("style");
      expect(branchNodeIds).toContain("correctness");

      // All branches succeeded
      expect(parallelResults.every((r) => r.status === "success")).toBe(true);

      // Fan-in selected the best branch
      expect(result.context.get("parallel.fan_in.best_id")).toBeTruthy();
      expect(result.context.get("parallel.fan_in.best_outcome")).toBe("success");

      // RecordingInterviewer captured the question and answer
      expect(recorder.recordings.length).toBe(1);
      expect(recorder.recordings[0].question.text).toContain("Final Approval");
      expect(recorder.recordings[0].answer.value).toBe("A");
    },
    TEST_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Scenario 3: "Resilient CI/CD"
// Pipeline: start → build → test(goal_gate, max_retries=2) → deploy(goal_gate) → exit
//
// Features exercised:
//   Node-level retries (max_retries=2), multiple goal gates,
//   graph-level retry_target, loop_restart edge, context reset
// ---------------------------------------------------------------------------
describe("scenario 3: resilient CI/CD", () => {
  test(
    "node retries on RETRY status, then succeeds through goal gates",
    async () => {
      let testCallCount = 0;

      const backend = makeBackend({
        overrideFn: (node) => {
          if (node.id === "test") {
            testCallCount++;
            // Return RETRY for first 2 calls, fall through on the 3rd
            if (testCallCount <= 2) {
              return createOutcome({
                status: StageStatus.RETRY,
                notes: `Test attempt ${testCallCount} needs retry`,
              });
            }
          }
          return undefined; // fall through to real LLM or stub
        },
      });

      const dot = `
      digraph CICD {
        graph [goal="Deploy safely", retry_target="build"]

        start  [shape=Mdiamond]
        exit   [shape=Msquare]
        build  [label="Build", prompt="Say 'Build complete' in one sentence. Do not use tools."]
        test   [label="Test", prompt="Say 'Tests passed' in one sentence. Do not use tools.", goal_gate=true, max_retries=2]
        deploy [label="Deploy", prompt="Say 'Deployed' in one sentence. Do not use tools.", goal_gate=true]

        start -> build -> test -> deploy -> exit
      }
    `;
      const graph = parse(dot);

      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));

      const runner = buildRunner({ handlerRegistry: registry });
      const result = await runner.run(graph);

      // Pipeline succeeds after retries
      expect(result.outcome.status).toBe(StageStatus.SUCCESS);

      // test node was called 3 times (2 RETRY + 1 SUCCESS)
      expect(testCallCount).toBe(3);

      // The retry count context key was set during retries
      expect(result.context.get("internal.retry_count.test")).toBe("2");

      // Both goal gates satisfied
      expect(result.completedNodes).toContain("build");
      expect(result.completedNodes).toContain("test");
      expect(result.completedNodes).toContain("deploy");
    },
    TEST_TIMEOUT,
  );

  test(
    "loop_restart resets context and restarts pipeline",
    async () => {
      let deployCallCount = 0;

      const backend = makeBackend({
        overrideFn: (node) => {
          if (node.id === "deploy") {
            deployCallCount++;
            // Fail the first deploy, fall through on second
            if (deployCallCount === 1) {
              return createOutcome({
                status: StageStatus.FAIL,
                failureReason: "Deploy failed",
              });
            }
          }
          return undefined;
        },
      });

      const dot = `
      digraph LoopRestart {
        graph [goal="Deploy with restart"]

        start  [shape=Mdiamond]
        exit   [shape=Msquare]
        build  [label="Build", prompt="Say 'Build complete' in one sentence. Do not use tools."]
        deploy [label="Deploy", prompt="Say 'Deployed' in one sentence. Do not use tools."]

        start -> build -> deploy
        deploy -> exit  [label="Success", condition="outcome=success"]
        deploy -> build [label="Restart", condition="outcome!=success", loop_restart=true]
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
      expect(deployCallCount).toBe(2);

      // completedNodes should contain the restart separator
      expect(result.completedNodes.some((n) => n.includes("restart"))).toBe(
        true,
      );

      // After loop_restart, context is fresh — stale keys from before restart are gone.
      // The "last_stage" should be from the second pass, not accumulated.
      expect(result.context.get("last_stage")).toBe("deploy");

      // build appears in both passes (before and after restart)
      expect(result.completedNodes.filter((n) => n === "build").length).toBe(2);
    },
    TEST_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Scenario 4: "API-Driven Orchestration"
// Full HTTP server lifecycle with human-in-the-loop.
//
// Features exercised:
//   createServer, POST /pipelines, GET /pipelines/:id (polling),
//   GET /pipelines/:id/questions (wait for pending),
//   POST /pipelines/:id/questions (answer),
//   GET /pipelines/:id/context, POST /pipelines/:id/cancel
// ---------------------------------------------------------------------------
describe("scenario 4: API-driven orchestration", () => {
  let server: AttractorServer | undefined;

  afterEach(() => {
    if (server) {
      server.stop();
      server = undefined;
    }
  });

  test(
    "submit pipeline, answer human gate via API, verify context, then cancel another",
    async () => {
      // Shared WebInterviewer: the handler uses this to block at gates,
      // and we swap it into the server's pipeline record so the API
      // question endpoints operate on the same instance.
      const sharedInterviewer = new WebInterviewer();

      const backend = makeBackend({ defaultStubResponse: "API work done" });
      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));
      registry.register("wait.human", new WaitForHumanHandler(sharedInterviewer));

      server = createServer({
        runnerConfig: { handlerRegistry: registry, logsRoot: tempLogsRoot() },
      });

      const baseUrl = `http://127.0.0.1:${server.port}`;

      // --- Pipeline 1: with a human gate ---
      const dot1 = `
      digraph APITest {
        graph [goal="API orchestration test"]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        work  [label="Work", prompt="Say 'Work done' in one sentence. Do not use tools."]
        gate  [shape=hexagon, label="Approve?"]
        done  [label="Done", prompt="Say 'Finished' in one sentence. Do not use tools."]

        start -> work -> gate
        gate -> done [label="[A] Approve"]
        gate -> work [label="[R] Revise"]
        done -> exit
      }
    `;

      // POST /pipelines
      const createResp = await fetch(`${baseUrl}/pipelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dot: dot1 }),
      });
      expect(createResp.status).toBe(201);
      const createBody = (await createResp.json()) as {
        id: string;
        status: string;
      };
      expect(createBody.status).toBe("running");
      const pipelineId = createBody.id;

      // Wire the server record to use our shared interviewer so
      // GET/POST /questions routes operate on the same instance.
      const record = server.pipelines.get(pipelineId);
      if (record) {
        (record as Record<string, unknown>).interviewer = sharedInterviewer;
      }

      // Poll GET /pipelines/:id/questions until question appears
      let questionValue: string | null = null;
      const maxPolls = hasRealLLM ? 600 : 50;
      let polls = 0;
      while (polls < maxPolls) {
        const qResp = await fetch(
          `${baseUrl}/pipelines/${pipelineId}/questions`,
        );
        const qBody = (await qResp.json()) as {
          question: {
            text: string;
            options: Array<{ key: string }>;
          } | null;
        };
        if (qBody.question) {
          questionValue = qBody.question.options[0]?.key ?? "A";
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
        polls++;
      }
      expect(questionValue).toBeTruthy();

      // POST /pipelines/:id/questions — answer the question
      const answerResp = await fetch(
        `${baseUrl}/pipelines/${pipelineId}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: questionValue }),
        },
      );
      expect(answerResp.status).toBe(200);

      // Poll for completion
      let status = "running";
      polls = 0;
      while (status === "running" && polls < maxPolls) {
        const statusResp = await fetch(`${baseUrl}/pipelines/${pipelineId}`);
        const statusBody = (await statusResp.json()) as { status: string };
        status = statusBody.status;
        if (status === "running") {
          await new Promise((r) => setTimeout(r, 50));
        }
        polls++;
      }
      expect(status).toBe("completed");

      // GET /pipelines/:id/context — verify final context
      const ctxResp = await fetch(
        `${baseUrl}/pipelines/${pipelineId}/context`,
      );
      const ctxBody = (await ctxResp.json()) as {
        context: Record<string, string>;
      };
      expect(ctxBody.context["graph.goal"]).toBe("API orchestration test");
      expect(ctxBody.context["last_stage"]).toBe("done");

      // GET /pipelines/:id/questions — no pending question after completion
      const noQResp = await fetch(
        `${baseUrl}/pipelines/${pipelineId}/questions`,
      );
      const noQBody = (await noQResp.json()) as { question: unknown };
      expect(noQBody.question).toBeNull();

      // --- Pipeline 2: cancel a running pipeline ---
      // Use a gate that will block forever (no answer), so pipeline stays running.
      // Re-use the shared interviewer; the gate will block on ask().
      const dot2 = `
      digraph CancelTest {
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        gate  [shape=hexagon, label="Block forever"]
        start -> gate
        gate -> exit [label="[A] Go"]
      }
    `;

      const create2Resp = await fetch(`${baseUrl}/pipelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dot: dot2 }),
      });
      const create2Body = (await create2Resp.json()) as { id: string };
      const pipeline2Id = create2Body.id;

      // Wait briefly for it to start running
      await new Promise((r) => setTimeout(r, 100));

      // POST /pipelines/:id/cancel
      const cancelResp = await fetch(
        `${baseUrl}/pipelines/${pipeline2Id}/cancel`,
        { method: "POST" },
      );
      expect(cancelResp.status).toBe(200);
      const cancelBody = (await cancelResp.json()) as { status: string };
      expect(cancelBody.status).toBe("cancelled");
    },
    TEST_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Scenario 5: "Multi-Stage Refactoring" (real LLM)
// Pipeline: start → create_file → analyze → refactor → verify(tool) → exit
//
// Features exercised:
//   Real LLM via SessionBackend, cross-stage file persistence,
//   ToolHandler verifying file on disk, StylesheetTransform,
//   VariableExpansionTransform
// ---------------------------------------------------------------------------
describe("scenario 5: multi-stage refactoring (real LLM)", () => {
  let tempDir: string;

  test.skipIf(!anthropicKey)(
    "creates, analyzes, refactors a file with tool verification",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "attractor-scenario5-"));

      const adapter = new AnthropicAdapter({ apiKey: anthropicKey! });
      const client = new Client({ providers: { anthropic: adapter } });
      const profile = createAnthropicProfile("claude-sonnet-4-5-20250929");
      const env = new LocalExecutionEnvironment({ workingDir: tempDir });
      const backend = new SessionBackend({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
      });

      const targetFile = join(tempDir, "refactor-target.ts");

      const stylesheet = ".fast { max_retries: 0 }";
      const dot = `
        digraph Refactor {
          graph [goal="Refactor a TypeScript utility", model_stylesheet="${stylesheet}"]

          start       [shape=Mdiamond]
          exit        [shape=Msquare]
          create_file [label="Create File", class="fast", prompt="Create a TypeScript file at ${targetFile} with a function called calculateTotal that takes an array of numbers and returns their sum. Use a for loop. Export the function."]
          analyze     [label="Analyze", class="fast", prompt="Read the file at ${targetFile} and describe what $goal improvements could be made. Be concise (1-2 sentences)."]
          refactor    [label="Refactor", class="fast", prompt="Refactor the file at ${targetFile}: replace the for loop with Array.reduce(). Keep the same function name and export."]
          verify      [shape=parallelogram, label="Verify", tool_command="test -f ${targetFile} && wc -l ${targetFile}"]

          start -> create_file -> analyze -> refactor -> verify -> exit
        }
      `;
      const graph = parse(dot);

      const logsRoot = join(tempDir, "logs");
      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));
      registry.register("tool", new ToolHandler());

      const runner = new PipelineRunner({
        handlerRegistry: registry,
        transforms: [
          new StylesheetTransform(),
          new VariableExpansionTransform(),
        ],
        logsRoot,
      });

      const result = await runner.run(graph);

      console.log("  [Scenario5] Status:", result.outcome.status);
      console.log("  [Scenario5] Completed:", result.completedNodes);

      expect(result.outcome.status).toBe(StageStatus.SUCCESS);
      expect(result.completedNodes).toContain("create_file");
      expect(result.completedNodes).toContain("analyze");
      expect(result.completedNodes).toContain("refactor");
      expect(result.completedNodes).toContain("verify");

      // Tool handler verified file exists (tool.output has wc -l output)
      expect(result.context.get("tool.output").trim()).toContain(
        targetFile.split("/").pop() ?? "refactor-target.ts",
      );

      // File should exist on disk
      const file = Bun.file(targetFile);
      const exists = await file.exists();
      expect(exists).toBe(true);
      if (exists) {
        const content = await file.text();
        console.log(
          "  [Scenario5] File content:",
          content.slice(0, 200),
        );
        expect(content).toContain("calculateTotal");
      }

      await client.close();
      await rm(tempDir, { recursive: true, force: true });
    },
    120_000,
  );
});
