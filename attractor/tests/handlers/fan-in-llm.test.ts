import { describe, it, expect } from "bun:test";
import { FanInHandler } from "../../src/handlers/fan-in.js";
import { StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr } from "../../src/types/graph.js";
import type { Node, Graph, AttributeValue } from "../../src/types/graph.js";
import type { CodergenBackend } from "../../src/types/handler.js";

function makeNode(id: string, attrs: Record<string, AttributeValue> = {}): Node {
  return { id, attributes: new Map(Object.entries(attrs)) };
}

function makeGraph(): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges: [], subgraphs: [] };
}

function makeResults(entries: Array<{ nodeId: string; status: string; notes?: string }>): string {
  return JSON.stringify(
    entries.map((e) => ({
      nodeId: e.nodeId,
      status: e.status,
      notes: e.notes ?? "",
      contextUpdates: {},
    })),
  );
}

function stubBackend(response: string): CodergenBackend {
  return { run: async () => response };
}

describe("FanInHandler LLM evaluation", () => {
  it("uses LLM selection when prompt attribute is set", async () => {
    const backend = stubBackend("candidate_b");
    const handler = new FanInHandler(backend);
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "candidate_a", status: StageStatus.SUCCESS },
        { nodeId: "candidate_b", status: StageStatus.PARTIAL_SUCCESS },
      ]),
    );

    const node = makeNode("fanin", { prompt: stringAttr("Pick the best") });
    const outcome = await handler.execute(node, context, makeGraph(), "/tmp");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("candidate_b");
    expect(outcome.notes).toContain("LLM selected");
  });

  it("parses candidate ID from first line of LLM response", async () => {
    const backend = stubBackend("candidate_a\nI chose candidate_a because...");
    const handler = new FanInHandler(backend);
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "candidate_a", status: StageStatus.SUCCESS },
        { nodeId: "candidate_b", status: StageStatus.SUCCESS },
      ]),
    );

    const node = makeNode("fanin", { prompt: stringAttr("Evaluate") });
    const outcome = await handler.execute(node, context, makeGraph(), "/tmp");

    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("candidate_a");
  });

  it("scans full response when first line is not a candidate ID", async () => {
    const backend = stubBackend("The best option is candidate_b based on quality.");
    const handler = new FanInHandler(backend);
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "candidate_a", status: StageStatus.SUCCESS },
        { nodeId: "candidate_b", status: StageStatus.SUCCESS },
      ]),
    );

    const node = makeNode("fanin", { prompt: stringAttr("Pick one") });
    const outcome = await handler.execute(node, context, makeGraph(), "/tmp");

    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("candidate_b");
  });

  it("falls back to heuristic when LLM response has no candidate ID", async () => {
    const backend = stubBackend("I cannot decide");
    const handler = new FanInHandler(backend);
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "x", status: StageStatus.PARTIAL_SUCCESS },
        { nodeId: "y", status: StageStatus.SUCCESS },
      ]),
    );

    const node = makeNode("fanin", { prompt: stringAttr("Rank them") });
    const outcome = await handler.execute(node, context, makeGraph(), "/tmp");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("y");
    expect(outcome.notes).toContain("Selected best candidate");
  });

  it("falls back to heuristic when backend throws", async () => {
    const backend: CodergenBackend = {
      run: async () => { throw new Error("LLM unavailable"); },
    };
    const handler = new FanInHandler(backend);
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "a", status: StageStatus.SUCCESS },
        { nodeId: "b", status: StageStatus.FAIL },
      ]),
    );

    const node = makeNode("fanin", { prompt: stringAttr("Evaluate") });
    const outcome = await handler.execute(node, context, makeGraph(), "/tmp");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("a");
    expect(outcome.notes).toContain("Selected best candidate");
  });

  it("uses heuristic when prompt is set but no backend provided", async () => {
    const handler = new FanInHandler();
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "a", status: StageStatus.PARTIAL_SUCCESS },
        { nodeId: "b", status: StageStatus.SUCCESS },
      ]),
    );

    const node = makeNode("fanin", { prompt: stringAttr("Evaluate") });
    const outcome = await handler.execute(node, context, makeGraph(), "/tmp");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("b");
    expect(outcome.notes).toContain("Selected best candidate");
  });

  it("uses heuristic when no prompt attribute is set even with backend", async () => {
    const backend = stubBackend("candidate_a");
    const handler = new FanInHandler(backend);
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "a", status: StageStatus.SUCCESS },
        { nodeId: "b", status: StageStatus.PARTIAL_SUCCESS },
      ]),
    );

    const node = makeNode("fanin");
    const outcome = await handler.execute(node, context, makeGraph(), "/tmp");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("a");
    expect(outcome.notes).toContain("Selected best candidate");
  });
});
