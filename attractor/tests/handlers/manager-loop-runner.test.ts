import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManagerLoopHandler } from "../../src/handlers/manager-loop.js";
import type { PipelineRunnerFactory } from "../../src/handlers/manager-loop.js";
import { StageStatus, createOutcome } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr, integerAttr, durationAttr } from "../../src/types/graph.js";
import type { Node, Graph, AttributeValue } from "../../src/types/graph.js";
import type { Handler } from "../../src/types/handler.js";
import { PipelineRunner, createHandlerRegistry } from "../../src/engine/runner.js";

let tmpDir: string;
let dotFilePath: string;

function makeNode(
  id: string,
  attrs: Record<string, AttributeValue> = {},
): Node {
  return { id, attributes: new Map(Object.entries(attrs)) };
}

function makeGraph(attrs: Record<string, AttributeValue> = {}): Graph {
  return {
    name: "parent",
    attributes: new Map(Object.entries(attrs)),
    nodes: new Map(),
    edges: [],
    subgraphs: [],
  };
}

const CHILD_DOT = `digraph child {
  Start [shape=Mdiamond];
  Work [shape=box];
  End [shape=Msquare];
  Start -> Work;
  Work -> End;
}`;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "manager-loop-runner-test-"));
  dotFilePath = join(tmpDir, "child.dot");
  writeFileSync(dotFilePath, CHILD_DOT, "utf-8");
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe("ManagerLoopHandler with runnerFactory", () => {
  it("runs child pipeline in-process via runnerFactory", async () => {
    const startHandler: Handler = {
      execute: async () => createOutcome({ status: StageStatus.SUCCESS }),
    };
    const workHandler: Handler = {
      execute: async (_node, context) => {
        context.set("work.done", "true");
        return createOutcome({ status: StageStatus.SUCCESS });
      },
    };

    const runnerFactory: PipelineRunnerFactory = (_graph, logsRoot) => {
      const registry = createHandlerRegistry();
      registry.register("start", startHandler);
      registry.register("codergen", workHandler);
      return new PipelineRunner({ handlerRegistry: registry, logsRoot });
    };

    const handler = new ManagerLoopHandler({ runnerFactory });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(5),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr(dotFilePath),
    });

    const outcome = await handler.execute(
      node,
      new Context(),
      graph,
      tmpDir,
    );

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.notes).toContain("child completed successfully");
  });

  it("writes checkpoint after child pipeline completes", async () => {
    const startHandler: Handler = {
      execute: async () => createOutcome({ status: StageStatus.SUCCESS }),
    };
    const workHandler: Handler = {
      execute: async () => createOutcome({ status: StageStatus.SUCCESS }),
    };

    const runnerFactory: PipelineRunnerFactory = (_graph, logsRoot) => {
      const registry = createHandlerRegistry();
      registry.register("start", startHandler);
      registry.register("codergen", workHandler);
      return new PipelineRunner({ handlerRegistry: registry, logsRoot });
    };

    const handler = new ManagerLoopHandler({ runnerFactory });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(5),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr(dotFilePath),
    });

    await handler.execute(node, new Context(), graph, tmpDir);

    const checkpointPath = join(tmpDir, "child", "checkpoint.json");
    expect(existsSync(checkpointPath)).toBe(true);
  });

  it("returns FAIL when child pipeline fails", async () => {
    const startHandler: Handler = {
      execute: async () => createOutcome({ status: StageStatus.SUCCESS }),
    };
    const failHandler: Handler = {
      execute: async () =>
        createOutcome({
          status: StageStatus.FAIL,
          failureReason: "child step failed",
        }),
    };

    const runnerFactory: PipelineRunnerFactory = (_graph, logsRoot) => {
      const registry = createHandlerRegistry();
      registry.register("start", startHandler);
      registry.register("codergen", failHandler);
      return new PipelineRunner({ handlerRegistry: registry, logsRoot });
    };

    const handler = new ManagerLoopHandler({ runnerFactory });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(5),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr(dotFilePath),
    });

    const outcome = await handler.execute(
      node,
      new Context(),
      graph,
      tmpDir,
    );

    // Child exits with code 1 (failure) -> manager detects it
    expect(outcome.status).toBe(StageStatus.FAIL);
  });

  it("prefers spawner over runnerFactory when both provided", async () => {
    let spawnerCalled = false;
    const runnerFactoryCalled = { value: false };

    const handler = new ManagerLoopHandler({
      spawner: (_dotFile, logsRoot) => {
        spawnerCalled = true;
        const childLogsRoot = join(logsRoot, "child");
        mkdirSync(childLogsRoot, { recursive: true });
        return {
          childLogsRoot,
          waitForCompletion: () => Promise.resolve({ exitCode: 0 }),
          kill: () => {},
        };
      },
      runnerFactory: (_graph, _logsRoot) => {
        runnerFactoryCalled.value = true;
        const registry = createHandlerRegistry();
        return new PipelineRunner({ handlerRegistry: registry });
      },
    });

    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(2),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr(dotFilePath),
    });

    await handler.execute(node, new Context(), graph, tmpDir);

    expect(spawnerCalled).toBe(true);
    expect(runnerFactoryCalled.value).toBe(false);
  });
});
