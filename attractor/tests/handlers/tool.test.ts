import { describe, it, expect } from "bun:test";
import { ToolHandler } from "../../src/handlers/tool.js";
import { StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr, durationAttr } from "../../src/types/graph.js";
import type { Node, Graph, AttributeValue } from "../../src/types/graph.js";

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map<string, AttributeValue>();
  for (const [k, v] of Object.entries(attrs)) {
    attributes.set(k, stringAttr(v));
  }
  return { id, attributes };
}

function makeGraph(): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges: [], subgraphs: [] };
}

describe("ToolHandler", () => {
  it("executes a command and captures stdout", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool", { tool_command: "echo hello" });

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
    const output = String(outcome.contextUpdates["tool.output"] ?? "");
    expect(output.trim()).toBe("hello");
  });

  it("fails when no tool_command specified", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool");

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("No tool_command specified");
  });

  it("fails when command exits with non-zero code", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool", { tool_command: "exit 1" });

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("exited with code 1");
  });

  it("includes command in notes on success", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool", { tool_command: "echo ok" });

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.notes).toContain("echo ok");
  });

  it("kills process when timeout expires", async () => {
    const handler = new ToolHandler();
    const attrs = new Map<string, AttributeValue>();
    attrs.set("tool_command", stringAttr("sleep 60"));
    attrs.set("timeout", durationAttr(200, "200ms"));
    const node: Node = { id: "slow", attributes: attrs };

    const start = Date.now();
    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    const elapsed = Date.now() - start;

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(elapsed).toBeLessThan(5000);
  });
});
